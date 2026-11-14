"""Bounded load runs on the live comment and inference pipeline."""

import asyncio
import logging
import os
import secrets
from datetime import datetime, timezone
from time import perf_counter
from uuid import UUID, uuid4, uuid5

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .db import transaction

log = logging.getLogger(__name__)
SIZE = 100
TEXTS = (
    "The performances were wonderful! Thank you for organizing the campus concert.",
    "I was disappointed by the long line, but the student actors were amazing.",
    "The campus event starts at six in the student union.",
    "The volunteers were helpful, but the confusing signs made us miss the first session.",
)


def check_code(code):
    expected = os.getenv("LOAD_DEMO_CODE", "")
    if not expected:
        raise HTTPException(503, "Load demo is disabled on this deployment.")
    if not secrets.compare_digest((code or "").encode(), expected.encode()):
        raise HTTPException(403, "Incorrect load demo code.")


def demo_enabled():
    return os.getenv("LOAD_DEMO_ENABLED", "true").lower() == "true"


def require_demo_enabled():
    if not demo_enabled():
        raise HTTPException(503, "Load demo is disabled on this deployment.")


def clear_pending_runs():
    with transaction() as c:
        runs = c.execute(
            "SELECT id FROM load_runs WHERE phase='clearing' FOR UPDATE SKIP LOCKED"
        ).fetchall()
        for run in runs:
            params = (run["id"],)
            for table in ("jobs", "sentiment_jobs"):
                c.execute(
                    f"""
                    UPDATE {table} SET status='failed',lease_until=NULL
                    WHERE status='pending' AND comment_id IN
                      (SELECT id FROM comments WHERE load_run_id=%s)
                """,
                    params,
                )
            active = any(
                c.execute(
                    f"""
                    SELECT 1 FROM {table} j JOIN comments c ON c.id=j.comment_id
                    WHERE c.load_run_id=%s AND j.status IN ('pending','processing') LIMIT 1
                """,
                    params,
                ).fetchone()
                for table in ("jobs", "sentiment_jobs")
            )
            if active:
                continue
            for table in (
                "load_samples",
                "analyses",
                "sentiment_analyses",
                "jobs",
                "sentiment_jobs",
            ):
                field = "run_id" if table == "load_samples" else "comment_id"
                scope = (
                    "%s"
                    if table == "load_samples"
                    else "SELECT id FROM comments WHERE load_run_id=%s"
                )
                c.execute(f"DELETE FROM {table} WHERE {field} IN ({scope})", params)
            c.execute("DELETE FROM comments WHERE load_run_id=%s", params)
            c.execute(
                "UPDATE load_runs SET phase='cleared',cleared_at=now() WHERE id=%s",
                params,
            )


async def cleanup_loop():
    while True:
        await asyncio.sleep(2)
        try:
            await asyncio.to_thread(clear_pending_runs)
        except Exception:
            log.exception("load_demo_cleanup_failed")


class HttpSample(BaseModel):
    sample: int = Field(ge=1, le=SIZE)
    http_ms: float = Field(ge=0, le=120_000)
    error: str | None = Field(default=None, pattern="^(timeout|request_failed)$")


def routes(admin_user, save_comment):
    router = APIRouter(
        prefix="/api/admin/load-runs", dependencies=[Depends(admin_user)]
    )

    @router.get("")
    def list_runs():
        with transaction() as c:
            runs = c.execute("""
                SELECT id,created_at,expires_at,phase FROM load_runs
                WHERE phase<>'cleared' ORDER BY created_at DESC LIMIT 20
            """).fetchall()
            cooldown = c.execute("""
                SELECT max(created_at + interval '2 minutes') AS until FROM load_runs
                WHERE created_at > clock_timestamp()-interval '2 minutes'
            """).fetchone()["until"]
        return {"enabled": demo_enabled(), "cooldown_until": cooldown, "runs": runs}

    @router.post("", status_code=201)
    def start():
        require_demo_enabled()
        with transaction() as c:
            c.execute("SELECT pg_advisory_xact_lock(715805)")
            if c.execute("""
                SELECT 1 FROM load_runs r WHERE
                    r.created_at > clock_timestamp()-interval '2 minutes'
                    OR r.phase='clearing'
                    OR (r.phase='open' AND EXISTS (
                        SELECT 1 FROM comments c WHERE c.load_run_id=r.id AND
                        (c.status IN ('pending','processing') OR c.sentiment_status IN ('pending','processing'))
                    ))
                LIMIT 1
            """).fetchone():
                raise HTTPException(
                    409,
                    "A run is active or cooling down. Wait two minutes before starting another.",
                )
            c.execute(
                "DELETE FROM load_runs WHERE phase='cleared' AND cleared_at < now()-interval '1 day'"
            )
            return c.execute(
                "INSERT INTO load_runs(id) VALUES (%s) RETURNING *", (uuid4(),)
            ).fetchone()

    def get_run(c, run_id, lock=""):
        row = c.execute(
            "SELECT * FROM load_runs WHERE id=%s" + lock, (run_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Load run not found.")
        return row

    @router.post("/{run_id}/samples/{sample}", status_code=202)
    def submit_sample(
        run_id: UUID,
        sample: int,
        user=Depends(admin_user),
    ):
        require_demo_enabled()
        if not 1 <= sample <= SIZE:
            raise HTTPException(422, "Sample must be between 1 and 100.")
        started = perf_counter()
        with transaction() as c:
            run = get_run(c, run_id, lock=" FOR SHARE")
            if run["phase"] != "open" or run["expires_at"] <= datetime.now(
                timezone.utc
            ):
                raise HTTPException(409, "This run no longer accepts samples.")
            c.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                (f"{run_id}:{sample}",),
            )
            existing = c.execute(
                "SELECT comment_id FROM load_samples WHERE run_id=%s AND sample=%s",
                (run_id, sample),
            ).fetchone()
            if existing and existing["comment_id"]:
                return {"sample": sample, "comment_id": existing["comment_id"]}
            cid = save_comment(
                c,
                "benchmark",
                user["id"],
                TEXTS[(sample - 1) % len(TEXTS)],
                uuid5(run_id, str(sample)),
                run_id,
            )
            c.execute(
                """
                INSERT INTO load_samples(run_id,sample,comment_id) VALUES (%s,%s,%s)
                ON CONFLICT(run_id,sample) DO UPDATE SET comment_id=excluded.comment_id
            """,
                (run_id, sample, cid),
            )
        return {
            "sample": sample,
            "comment_id": cid,
            "server_submit_ms": (perf_counter() - started) * 1000,
        }

    @router.put("/{run_id}/measurements")
    def record(
        run_id: UUID,
        samples: list[HttpSample],
    ):
        require_demo_enabled()
        if len(samples) > SIZE:
            raise HTTPException(422, "Too many measurements.")
        with transaction() as c:
            run = get_run(c, run_id, lock=" FOR SHARE")
            if run["phase"] != "open" or run["expires_at"] <= datetime.now(
                timezone.utc
            ):
                raise HTTPException(409, "This run no longer accepts measurements.")
            for item in samples:
                c.execute(
                    """
                    INSERT INTO load_samples(run_id,sample,http_ms,submit_error) VALUES (%s,%s,%s,%s)
                    ON CONFLICT(run_id,sample) DO UPDATE SET http_ms=excluded.http_ms,submit_error=excluded.submit_error
                """,
                    (run_id, item.sample, item.http_ms, item.error),
                )
        return {"recorded": len(samples)}

    @router.get("/{run_id}")
    def detail(run_id: UUID):
        with transaction() as c:
            run = get_run(c, run_id)
            rows = c.execute(
                """
                SELECT s.sample,s.http_ms,s.submit_error,c.id AS comment_id,c.created_at,
                       c.status AS emotion_status,c.sentiment_status,e.attempts AS emotion,t.attempts AS sentiment,
                       CASE WHEN e.finished IS NOT NULL AND t.finished IS NOT NULL THEN
                        EXTRACT(EPOCH FROM (GREATEST(e.finished,t.finished)-c.created_at))*1000
                       END::double precision AS completion_ms
                FROM load_samples s LEFT JOIN comments c ON c.id=s.comment_id
                LEFT JOIN LATERAL (
                    SELECT json_agg(a ORDER BY a.started_at) AS attempts,
                        max(finished_at) FILTER(WHERE status='completed') AS finished FROM
                    (SELECT started_at,finished_at,status,queue_ms,inference_ms FROM analyses
                     WHERE comment_id=c.id) a
                ) e ON true
                LEFT JOIN LATERAL (
                    SELECT json_agg(a ORDER BY a.started_at) AS attempts,
                        max(finished_at) FILTER(WHERE status='completed') AS finished FROM
                    (SELECT started_at,finished_at,status,queue_ms,inference_ms,service_queue_ms FROM sentiment_analyses
                     WHERE comment_id=c.id) a
                ) t ON true
                WHERE s.run_id=%s ORDER BY s.sample
            """,
                (run_id,),
            ).fetchall()
        return {**run, "samples": rows, "target": SIZE}

    @router.delete("/{run_id}", status_code=202)
    def clear(run_id: UUID):
        with transaction() as c:
            run = get_run(c, run_id, lock=" FOR UPDATE")
            if run["phase"] == "open":
                c.execute(
                    "UPDATE load_runs SET phase='clearing' WHERE id=%s", (run_id,)
                )
                return {"phase": "clearing"}
            return {"phase": run["phase"]}

    return router
