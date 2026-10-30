"""Independent durable queue and HTTP client; the resident model lives in sentiment service."""

import logging
import os
import signal
import threading
import time
from uuid import uuid4
import httpx
from psycopg.types.json import Jsonb
from .db import transaction as connect, connect as dedicated_connect, initialize

REVISION = "3216a57f2a0d9c45a2e6c20157c20c49fb4bf9c7"
LABELS = ("negative", "neutral", "positive")
STOP = threading.Event()
log = logging.getLogger("campus.sentiment")


def claim():
    with connect() as c:
        row = c.execute(
            "SELECT * FROM sentiment_jobs WHERE status='pending' AND available_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1"
        ).fetchone()
        if not row:
            return None
        c.execute(
            "UPDATE sentiment_jobs SET status='processing',attempts=attempts+1,lease_until=now()+interval '3 minutes' WHERE id=%s",
            (row["id"],),
        )
        c.execute(
            "UPDATE comments SET sentiment_status='processing',sentiment_error=NULL WHERE id=%s",
            (row["comment_id"],),
        )
        row["attempts"] += 1
        return row


def recover():
    with connect() as c:
        rows = c.execute(
            "SELECT * FROM sentiment_jobs WHERE status='processing' AND lease_until<now() FOR UPDATE SKIP LOCKED"
        ).fetchall()
        for row in rows:
            state = "failed" if row["attempts"] >= 3 else "pending"
            c.execute(
                "UPDATE sentiment_jobs SET status=%s,lease_until=NULL,last_error='Worker interrupted' WHERE id=%s",
                (state, row["id"]),
            )
            c.execute(
                "UPDATE comments SET sentiment_status=%s,sentiment_error='Worker interrupted; retry available' WHERE id=%s",
                (state, row["comment_id"]),
            )
            c.execute(
                "UPDATE sentiment_analyses SET status='failed',finished_at=now(),error='Worker interrupted' WHERE job_id=%s AND status='processing'",
                (row["id"],),
            )
        return len(rows)


def validate_result(result):
    import math

    scores = result["scores"]
    if (
        set(scores) != set(LABELS)
        or any(not math.isfinite(v) or not 0 <= v <= 1 for v in scores.values())
        or abs(sum(scores.values()) - 1) > 1e-5
        or result["label"] != max(scores, key=scores.get)
    ):
        raise ValueError("Invalid sentiment scores")
    return result


def execute(job, client, runtime_id, model_runtime_id):
    aid = uuid4()
    with connect() as c:
        comment = c.execute(
            "SELECT * FROM comments WHERE id=%s", (job["comment_id"],)
        ).fetchone()
        c.execute(
            "INSERT INTO sentiment_analyses(id,comment_id,job_id,runtime_id,model_revision,queue_ms) VALUES (%s,%s,%s,%s,%s,EXTRACT(EPOCH FROM (now()-%s))*1000)",
            (aid, comment["id"], job["id"], runtime_id, REVISION, job["created_at"]),
        )
    try:
        response = client.post("/predict", json={"text": comment["text"]})
        response.raise_for_status()
        result = validate_result(response.json())
        if result["runtime_id"] != model_runtime_id:
            raise RuntimeError("Model runtime changed; reconnect required")
        with connect() as c:
            c.execute(
                "UPDATE sentiment_analyses SET status='completed',finished_at=now(),label=%s,scores=%s,inference_ms=%s,service_queue_ms=%s,token_count=%s,rss_mb=%s WHERE id=%s",
                (
                    result["label"],
                    Jsonb(result["scores"]),
                    result["inference_ms"],
                    result["queue_ms"],
                    result["token_count"],
                    result["rss_mb"],
                    aid,
                ),
            )
            c.execute(
                "UPDATE comments SET sentiment_status='completed',sentiment_error=NULL WHERE id=%s",
                (comment["id"],),
            )
            c.execute(
                "UPDATE sentiment_jobs SET status='completed',lease_until=NULL WHERE id=%s",
                (job["id"],),
            )
        log.info(
            "sentiment_completed comment=%s label=%s inference_ms=%.1f",
            comment["id"],
            result["label"],
            result["inference_ms"],
        )
    except Exception:
        log.exception("sentiment_failed job=%s attempt=%s", job["id"], job["attempts"])
        state = "failed" if job["attempts"] >= 3 else "pending"
        with connect() as c:
            c.execute(
                "UPDATE sentiment_analyses SET status='failed',finished_at=now(),error='Inference unavailable; see logs' WHERE id=%s",
                (aid,),
            )
            c.execute(
                "UPDATE sentiment_jobs SET status=%s,lease_until=NULL,available_at=now()+interval '5 seconds',last_error='Inference unavailable' WHERE id=%s",
                (state, job["id"]),
            )
            c.execute(
                "UPDATE comments SET sentiment_status=%s,sentiment_error='Sentiment is temporarily unavailable. Your post is saved and can be retried.' WHERE id=%s",
                (state, comment["id"]),
            )


def main():
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
    )
    initialize()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: STOP.set())
    with (
        dedicated_connect() as guard,
        httpx.Client(
            base_url=os.getenv("SENTIMENT_URL", "http://sentiment:8000"), timeout=120
        ) as client,
    ):
        guard.autocommit = True
        if not guard.execute(
            "SELECT pg_try_advisory_lock(715804) AS acquired"
        ).fetchone()["acquired"]:
            raise RuntimeError("Another sentiment worker holds singleton lock")
        runtime_id = None
        model_id = None
        tick = 0
        while not STOP.is_set():
            if time.monotonic() - tick > 5:
                guard.execute("SELECT 1")
                recover()
                try:
                    response = client.get("/metadata")
                    response.raise_for_status()
                    metadata = response.json()
                    assert (
                        metadata["revision"] == REVISION and metadata["device"] == "cpu"
                    )
                    if metadata["runtime_id"] != model_id:
                        runtime_id = uuid4()
                        model_id = metadata["runtime_id"]
                        with connect() as c:
                            c.execute(
                                "INSERT INTO sentiment_runtimes(id,metadata) VALUES (%s,%s)",
                                (runtime_id, Jsonb(metadata)),
                            )
                    with connect() as c:
                        c.execute(
                            "UPDATE sentiment_runtimes SET heartbeat=now() WHERE id=%s",
                            (runtime_id,),
                        )
                except Exception:
                    log.exception("sentiment_service_not_ready")
                    STOP.wait(3)
                    continue
                tick = time.monotonic()
            job = claim()
            if job:
                execute(job, client, runtime_id, model_id)
            else:
                STOP.wait(float(os.getenv("WORKER_POLL_SECONDS", "0.05")))


if __name__ == "__main__":
    main()
