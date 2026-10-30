import hashlib
import os
import re
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID, uuid4
from fastapi import FastAPI, Request, Response, HTTPException, Depends, Query
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator
from psycopg.types.json import Jsonb
from .db import transaction as connect, initialize, enqueue, enqueue_sentiment
from .config import LABELS, MODEL_REV, MODEL_REPO, DATA_REV, REPORT_DIR


@asynccontextmanager
async def lifespan(app):
    initialize()
    yield


app = FastAPI(
    title="Campus Notes · Emotion Analysis",
    version="0.1.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url="/api/openapi.json",
)


@app.middleware("http")
async def origin_check(request: Request, call_next):
    origins = os.getenv(
        "APP_ORIGINS", "http://localhost:5180,http://127.0.0.1:5180"
    ).split(",")
    if (
        request.method not in ("GET", "HEAD", "OPTIONS")
        and request.headers.get("origin")
        and request.headers["origin"] not in origins
    ):
        return JSONResponse({"detail": "Untrusted request origin"}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(Exception)
async def internal_error(request: Request, exc: Exception):
    import logging

    logging.getLogger("campus.api").exception(
        "request_failed method=%s path=%s",
        request.method,
        request.url.path,
        exc_info=exc,
    )
    return JSONResponse({"detail": "暂时无法完成请求，请稍后重试。"}, status_code=500)


def session_user(request: Request):
    token = request.cookies.get("campus_session", "")
    if not token:
        raise HTTPException(401, "请先输入用户名进入平台。")
    with connect() as c:
        user = c.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=%s AND s.expires_at>now()",
            (hashlib.sha256(token.encode()).hexdigest(),),
        ).fetchone()
    if not user:
        raise HTTPException(401, "会话已过期，请重新进入。")
    return user


def clean_text(v):
    v = v.strip()
    if not v or any(ord(x) < 32 and x not in "\n\t\r" for x in v):
        raise ValueError("请输入有效文本。")
    return v


class Login(BaseModel):
    username: str = Field(min_length=1, max_length=32)

    @field_validator("username")
    @classmethod
    def validate_name(cls, v):
        v = clean_text(v)
        if not re.fullmatch(r"[\w .-]+", v):
            raise ValueError("用户名可包含文字、数字、空格、点、下划线和短横线。")
        return v


class NewComment(BaseModel):
    event_id: str = Field(max_length=50)
    text: str = Field(min_length=1, max_length=2000)
    idempotency_key: UUID

    @field_validator("text")
    @classmethod
    def validate_text(cls, v):
        return clean_text(v)


class Handling(BaseModel):
    status: Literal["unread", "viewed", "processed"]


class Favorite(BaseModel):
    value: bool


class Correction(BaseModel):
    labels: list[str] = Field(max_length=28)
    reason: str = Field(min_length=1, max_length=500)

    @field_validator("labels")
    @classmethod
    def valid_labels(cls, v):
        if len(set(v)) != len(v) or any(x not in LABELS for x in v):
            raise ValueError("标签必须是互不重复的模型标签。")
        return v

    @field_validator("reason")
    @classmethod
    def valid_reason(cls, v):
        return clean_text(v)


SELECT_COMMENT = """SELECT c.*,u.username,e.title AS event_title,
 EXISTS(SELECT 1 FROM favorites f WHERE f.comment_id=c.id AND f.user_id=%s) AS favorite,
 (SELECT row_to_json(s) FROM sentiment_analyses s WHERE s.comment_id=c.id AND s.status='completed' ORDER BY s.started_at DESC LIMIT 1) AS sentiment,
 (SELECT row_to_json(a) FROM analyses a WHERE a.comment_id=c.id AND a.status='completed' ORDER BY a.started_at DESC LIMIT 1) AS analysis,
 (SELECT json_build_object('id',r.id,'labels',r.labels,'reason',r.reason,'created_at',r.created_at,'username',ru.username)
  FROM corrections r JOIN users ru ON ru.id=r.user_id WHERE r.comment_id=c.id ORDER BY r.created_at DESC LIMIT 1) AS correction
 FROM comments c JOIN users u ON u.id=c.user_id JOIN events e ON e.id=c.event_id """


def get_comment(c, comment_id, user_id):
    row = c.execute(SELECT_COMMENT + " WHERE c.id=%s", (user_id, comment_id)).fetchone()
    if not row:
        raise HTTPException(404, "评论不存在。")
    return row


@app.get("/health")
def health():
    return {"status": "ok", "version": "0.1.0"}


@app.get("/ready")
def ready():
    with connect() as c:
        runtime = c.execute(
            "SELECT id FROM runtimes WHERE heartbeat>now()-interval '30 seconds' ORDER BY started_at DESC LIMIT 1"
        ).fetchone()
    if not runtime:
        raise HTTPException(503, "模型 worker 尚未就绪。")
    result = {"database": "ok", "worker": "ready", "runtime_id": runtime["id"]}
    if os.getenv("ENABLE_SENTIMENT", "false").lower() == "true":
        with connect() as c:
            sentiment = c.execute(
                "SELECT id FROM sentiment_runtimes WHERE heartbeat>now()-interval '30 seconds' ORDER BY started_at DESC LIMIT 1"
            ).fetchone()
        if not sentiment:
            raise HTTPException(503, "三分类 worker 尚未就绪。")
        result["sentiment_worker"] = "ready"
        result["sentiment_runtime_id"] = sentiment["id"]
    return result


@app.post("/api/session")
def login(body: Login, request: Request, response: Response):
    try:
        old = session_user(request)
    except HTTPException:
        old = None
    if old and old["username"] == body.username:
        return old
    token = secrets.token_urlsafe(32)
    with connect() as c:
        user = c.execute(
            "INSERT INTO users(id,username) VALUES (%s,%s) RETURNING *",
            (uuid4(), body.username),
        ).fetchone()
        c.execute(
            "INSERT INTO sessions VALUES (%s,%s,now()+interval '30 days')",
            (hashlib.sha256(token.encode()).hexdigest(), user["id"]),
        )
    response.set_cookie(
        "campus_session",
        token,
        httponly=True,
        samesite="lax",
        secure=os.getenv("COOKIE_SECURE", "false").lower() == "true",
        max_age=30 * 86400,
    )
    return user


@app.get("/api/session")
def me(user=Depends(session_user)):
    return user


@app.delete("/api/session", status_code=204)
def logout(request: Request, response: Response):
    token = request.cookies.get("campus_session", "")
    with connect() as c:
        c.execute(
            "DELETE FROM sessions WHERE token_hash=%s",
            (hashlib.sha256(token.encode()).hexdigest(),),
        )
    response.delete_cookie("campus_session")


@app.get("/api/events")
def events():
    with connect() as c:
        return c.execute(
            "SELECT e.*,count(c.id) AS comment_count FROM events e LEFT JOIN comments c ON c.event_id=e.id WHERE NOT e.is_benchmark GROUP BY e.id ORDER BY starts_at"
        ).fetchall()


@app.get("/api/model")
def model_info():
    return {
        "repo": MODEL_REPO,
        "revision": MODEL_REV,
        "dataset_revision": DATA_REV,
        "labels": LABELS,
        "threshold": 0.5,
        "comparison": ">",
        "language": "English",
        "mode": "public_demo",
        "max_tokens": 512,
        "description": "Scores describe emotions expressed in English text, not a person’s mental state. No automatic moderation.",
    }


@app.get("/api/runtime")
def runtime_info():
    with connect() as c:
        return c.execute(
            "SELECT * FROM runtimes ORDER BY started_at DESC LIMIT 1"
        ).fetchone()


@app.get("/api/sentiment/runtime")
def sentiment_runtime_info():
    with connect() as c:
        return c.execute(
            "SELECT * FROM sentiment_runtimes ORDER BY started_at DESC LIMIT 1"
        ).fetchone()


@app.post("/api/comments", status_code=202)
def post_comment(body: NewComment, user=Depends(session_user)):
    with connect() as c:
        if not c.execute(
            "SELECT 1 FROM events WHERE id=%s", (body.event_id,)
        ).fetchone():
            raise HTTPException(404, "活动不存在。")
        # ON CONFLICT also handles a simultaneous duplicate browser submission.
        row = c.execute(
            "INSERT INTO comments(id,event_id,user_id,text,idempotency_key) VALUES (%s,%s,%s,%s,%s) ON CONFLICT(user_id,idempotency_key) DO NOTHING RETURNING id",
            (uuid4(), body.event_id, user["id"], body.text, body.idempotency_key),
        ).fetchone()
        if row:
            enqueue(c, "comment", row["id"])
            enqueue_sentiment(c, row["id"])
        else:
            row = c.execute(
                "SELECT id,event_id,text FROM comments WHERE user_id=%s AND idempotency_key=%s",
                (user["id"], body.idempotency_key),
            ).fetchone()
            if row["event_id"] != body.event_id or row["text"] != body.text:
                raise HTTPException(409, "重复提交标识与原评论不一致。")
        return get_comment(c, row["id"], user["id"])


@app.get("/api/comments")
def comments(
    event_id: str | None = None,
    label: str | None = None,
    sentiment: Literal["negative", "neutral", "positive"] | None = None,
    sentiment_status: Literal["pending", "processing", "completed", "failed"]
    | None = None,
    status: Literal["pending", "processing", "completed", "failed"] | None = None,
    handling: Literal["unread", "viewed", "processed"] | None = None,
    after: datetime | None = None,
    before: datetime | None = None,
    mine: bool = False,
    favorites: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user=Depends(session_user),
):
    conditions = ["NOT e.is_benchmark"]
    params = []
    for col, val in [
        ("c.event_id", event_id),
        ("c.status", status),
        ("c.handling", handling),
    ]:
        if val is not None:
            conditions.append(col + "=%s")
            params.append(val)
    if sentiment_status:
        conditions.append("c.sentiment_status=%s")
        params.append(sentiment_status)
    if sentiment:
        conditions.append(
            "EXISTS(SELECT 1 FROM sentiment_analyses s WHERE s.comment_id=c.id AND s.status='completed' AND s.label=%s)"
        )
        params.append(sentiment)
    if label:
        if label not in LABELS:
            raise HTTPException(422, "未知情绪标签。")
        conditions.append(
            "EXISTS(SELECT 1 FROM analyses a WHERE a.comment_id=c.id AND a.status='completed' AND a.labels @> %s)"
        )
        params.append(Jsonb([label]))
    for value, operator in [(after, ">="), (before, "<=")]:
        if value:
            if value.tzinfo is None:
                raise HTTPException(422, "时间必须带时区。")
            conditions.append("c.created_at " + operator + " %s")
            params.append(value)
    if after and before and after > before:
        raise HTTPException(422, "开始时间不能晚于结束时间。")
    if mine:
        conditions.append("c.user_id=%s")
        params.append(user["id"])
    if favorites:
        conditions.append(
            "EXISTS(SELECT 1 FROM favorites f WHERE f.comment_id=c.id AND f.user_id=%s)"
        )
        params.append(user["id"])
    where = " WHERE " + " AND ".join(conditions)
    with connect() as c:
        total = c.execute(
            "SELECT count(*) AS n FROM comments c JOIN events e ON e.id=c.event_id"
            + where,
            params,
        ).fetchone()["n"]
        items = c.execute(
            SELECT_COMMENT
            + where
            + " ORDER BY c.created_at DESC,c.id DESC LIMIT %s OFFSET %s",
            [user["id"], *params, page_size, (page - 1) * page_size],
        ).fetchall()
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@app.get("/api/stats")
def stats(user=Depends(session_user)):
    with connect() as c:
        result = c.execute(
            """SELECT count(*) AS total,
        count(*) FILTER(WHERE c.status='completed' AND c.sentiment_status='completed') AS completed,
        count(*) FILTER(WHERE c.status IN ('pending','processing') OR c.sentiment_status IN ('pending','processing')) AS waiting,
        count(*) FILTER(WHERE c.status='failed' OR c.sentiment_status='failed') AS failed,
        count(*) FILTER(WHERE c.handling='unread') AS unread,
        count(*) FILTER(WHERE EXISTS(SELECT 1 FROM favorites f WHERE f.comment_id=c.id AND f.user_id=%s)) AS favorites
        FROM comments c JOIN events e ON e.id=c.event_id WHERE NOT e.is_benchmark""",
            (user["id"],),
        ).fetchone()
        counts = c.execute("""SELECT s.label,count(*) AS n FROM comments c JOIN events e ON e.id=c.event_id
        JOIN LATERAL (SELECT label FROM sentiment_analyses WHERE comment_id=c.id AND status='completed' ORDER BY started_at DESC LIMIT 1) s ON true
        WHERE NOT e.is_benchmark GROUP BY s.label""").fetchall()
        result["sentiment"] = {
            label: 0 for label in ("negative", "neutral", "positive")
        }
        result["sentiment"].update({r["label"]: r["n"] for r in counts})
        result["sentiment_completed"] = sum(result["sentiment"].values())
        result["emotions"] = (
            c.execute("""SELECT label,count(*) AS count FROM comments c JOIN events e ON e.id=c.event_id
        JOIN LATERAL (SELECT labels FROM analyses WHERE comment_id=c.id AND status='completed' ORDER BY started_at DESC LIMIT 1) a ON true
        CROSS JOIN LATERAL jsonb_array_elements_text(a.labels) AS label WHERE NOT e.is_benchmark GROUP BY label ORDER BY count(*) DESC,label""").fetchall()
        )
        return result


@app.post("/api/comments/{comment_id}/sentiment/retry", status_code=202)
def retry_sentiment(comment_id: UUID, user=Depends(session_user)):
    with connect() as c:
        row = c.execute(
            "SELECT * FROM comments WHERE id=%s FOR UPDATE", (comment_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, "评论不存在。")
        if row["sentiment_status"] != "failed":
            raise HTTPException(409, "仅失败的三分类任务可以重试。")
        c.execute(
            "UPDATE comments SET sentiment_status='pending',sentiment_error=NULL WHERE id=%s",
            (comment_id,),
        )
        enqueue_sentiment(c, comment_id)
        return get_comment(c, comment_id, user["id"])


@app.get("/api/comments/{comment_id}")
def comment_detail(comment_id: UUID, user=Depends(session_user)):
    with connect() as c:
        row = get_comment(c, comment_id, user["id"])
        row["correction_history"] = c.execute(
            "SELECT r.*,u.username FROM corrections r JOIN users u ON u.id=r.user_id WHERE comment_id=%s ORDER BY created_at DESC",
            (comment_id,),
        ).fetchall()
        row["handling_history"] = c.execute(
            "SELECT h.*,u.username FROM handling_history h JOIN users u ON u.id=h.user_id WHERE comment_id=%s ORDER BY created_at DESC",
            (comment_id,),
        ).fetchall()
        row["attempts"] = c.execute(
            "SELECT id,status,started_at,finished_at,error FROM analyses WHERE comment_id=%s ORDER BY started_at",
            (comment_id,),
        ).fetchall()
        row["sentiment_attempts"] = c.execute(
            "SELECT id,status,started_at,finished_at,error FROM sentiment_analyses WHERE comment_id=%s ORDER BY started_at",
            (comment_id,),
        ).fetchall()
        return row


@app.post("/api/comments/{comment_id}/retry", status_code=202)
def retry(comment_id: UUID, user=Depends(session_user)):
    with connect() as c:
        row = c.execute(
            "SELECT * FROM comments WHERE id=%s FOR UPDATE", (comment_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, "评论不存在。")
        if row["status"] != "failed":
            raise HTTPException(409, "仅失败的评论可以重试。")
        c.execute(
            "UPDATE comments SET status='pending',last_error=NULL WHERE id=%s",
            (comment_id,),
        )
        enqueue(c, "comment", comment_id)
        return get_comment(c, comment_id, user["id"])


@app.put("/api/comments/{comment_id}/favorite")
def favorite(comment_id: UUID, body: Favorite, user=Depends(session_user)):
    with connect() as c:
        get_comment(c, comment_id, user["id"])
        if body.value:
            c.execute(
                "INSERT INTO favorites(user_id,comment_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                (user["id"], comment_id),
            )
        else:
            c.execute(
                "DELETE FROM favorites WHERE user_id=%s AND comment_id=%s",
                (user["id"], comment_id),
            )
    return {"favorite": body.value}


@app.put("/api/comments/{comment_id}/handling")
def handle(comment_id: UUID, body: Handling, user=Depends(session_user)):
    with connect() as c:
        row = c.execute(
            "SELECT handling FROM comments WHERE id=%s FOR UPDATE", (comment_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, "评论不存在。")
        c.execute(
            "UPDATE comments SET handling=%s WHERE id=%s", (body.status, comment_id)
        )
        c.execute(
            "INSERT INTO handling_history(id,comment_id,user_id,previous_status,new_status) VALUES (%s,%s,%s,%s,%s)",
            (uuid4(), comment_id, user["id"], row["handling"], body.status),
        )
    return {"handling": body.status}


@app.post("/api/comments/{comment_id}/corrections", status_code=201)
def correct(comment_id: UUID, body: Correction, user=Depends(session_user)):
    with connect() as c:
        row = get_comment(c, comment_id, user["id"])
        if row["status"] != "completed":
            raise HTTPException(409, "分析完成后才可追加人工纠正。")
        return c.execute(
            "INSERT INTO corrections(id,comment_id,user_id,labels,reason) VALUES (%s,%s,%s,%s,%s) RETURNING *",
            (uuid4(), comment_id, user["id"], Jsonb(body.labels), body.reason),
        ).fetchone()


@app.get("/api/evaluations")
def evaluations():
    with connect() as c:
        return c.execute(
            "SELECT * FROM evaluations ORDER BY created_at DESC LIMIT 50"
        ).fetchall()


@app.get("/api/evaluations/{run_id}")
def evaluation(run_id: UUID):
    with connect() as c:
        row = c.execute("SELECT * FROM evaluations WHERE id=%s", (run_id,)).fetchone()
    if not row:
        raise HTTPException(404, "评测不存在。")
    return row


@app.get("/api/evaluations/{run_id}/files/{filename}")
def evaluation_file(
    run_id: UUID,
    filename: Literal["metrics.json", "predictions.jsonl", "metadata.json"],
):
    run = evaluation(run_id)
    path = REPORT_DIR / "evaluations" / str(run_id) / filename
    if run["status"] != "completed" or not path.is_file():
        raise HTTPException(404, "评测文件尚未生成。")
    return FileResponse(path, filename=f"{run_id}-{filename}")


@app.get("/api/benchmarks")
def benchmarks():
    with connect() as c:
        return c.execute(
            "SELECT * FROM benchmarks ORDER BY created_at DESC LIMIT 20"
        ).fetchall()
