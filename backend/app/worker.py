import json
import logging
import signal
import threading
import time
from datetime import datetime, timezone
from uuid import uuid4
import numpy as np
from psycopg.types.json import Jsonb
from .db import connect, initialize
from .config import MODEL_REV, DATA_REV, LABELS, REPORT_DIR
from .assets import load_test
from .metrics import calculate_metrics, distribution

log = logging.getLogger("campus.worker")
STOP = threading.Event()


def claim(kind=None):
    with connect() as c:
        condition = "AND kind=%s" if kind else ""
        row = c.execute(
            """SELECT * FROM jobs WHERE status='pending' AND available_at<=now() """
            + condition
            + """
            ORDER BY CASE kind WHEN 'comment' THEN 0 WHEN 'benchmark' THEN 1 ELSE 2 END,created_at
            FOR UPDATE SKIP LOCKED LIMIT 1""",
            (kind,) if kind else (),
        ).fetchone()
        if not row:
            return None
        c.execute(
            "UPDATE jobs SET status='processing',attempts=attempts+1,lease_until=now()+interval '5 minutes' WHERE id=%s",
            (row["id"],),
        )
        row["attempts"] += 1
        if row["comment_id"]:
            c.execute(
                "UPDATE comments SET status='processing',last_error=NULL WHERE id=%s",
                (row["comment_id"],),
            )
        return row


def recover():
    with connect() as c:
        rows = c.execute(
            "SELECT * FROM jobs WHERE status='processing' AND lease_until<now() FOR UPDATE SKIP LOCKED"
        ).fetchall()
        for row in rows:
            status = "failed" if row["attempts"] >= 3 else "pending"
            c.execute(
                "UPDATE jobs SET status=%s,lease_until=NULL,last_error=%s WHERE id=%s",
                (status, "Worker interrupted; lease expired", row["id"]),
            )
            c.execute(
                "UPDATE analyses SET status='failed',finished_at=now(),error='Worker interrupted; lease expired' WHERE job_id=%s AND status='processing'",
                (row["id"],),
            )
            if row["comment_id"]:
                c.execute(
                    "UPDATE comments SET status=%s,last_error=%s WHERE id=%s",
                    (
                        status,
                        "Worker interrupted; retry queued"
                        if status == "pending"
                        else "Worker interrupted; retry manually",
                        row["comment_id"],
                    ),
                )
            if row["kind"] in ("evaluation", "benchmark"):
                table = "evaluations" if row["kind"] == "evaluation" else "benchmarks"
                c.execute(
                    f"UPDATE {table} SET status=%s,error=%s WHERE id=%s",
                    (
                        status,
                        "Worker interrupted; lease expired",
                        row["payload"]["run_id"],
                    ),
                )
        return len(rows)


def run_comment(job, engine, runtime_id):
    aid = uuid4()
    with connect() as c:
        comment = c.execute(
            "SELECT * FROM comments WHERE id=%s", (job["comment_id"],)
        ).fetchone()
        row = c.execute(
            "INSERT INTO analyses(id,comment_id,job_id,runtime_id,model_revision,queue_ms) VALUES (%s,%s,%s,%s,%s,EXTRACT(EPOCH FROM (now()-%s))*1000) RETURNING queue_ms",
            (
                aid,
                comment["id"],
                job["id"],
                runtime_id,
                MODEL_REV,
                comment["created_at"],
            ),
        ).fetchone()
    try:
        result = engine.predict(comment["text"])
        with connect() as c:
            c.execute(
                """UPDATE analyses SET status='completed',finished_at=now(),scores=%s,labels=%s,top_label=%s,
            top_score=%s,inference_ms=%s,token_count=%s,truncated=%s,rss_mb=%s,cpu_percent=%s WHERE id=%s""",
                (
                    Jsonb(result["scores"]),
                    Jsonb(result["labels"]),
                    result["top_label"],
                    result["top_score"],
                    result["inference_ms"],
                    result["token_count"],
                    result["truncated"],
                    result["rss_mb"],
                    result["cpu_percent"],
                    aid,
                ),
            )
            c.execute(
                "UPDATE comments SET status='completed',completed_at=now(),last_error=NULL WHERE id=%s",
                (comment["id"],),
            )
            c.execute(
                "UPDATE jobs SET status='completed',lease_until=NULL WHERE id=%s",
                (job["id"],),
            )
        log.info(
            "analysis_completed comment=%s job=%s inference_ms=%.1f queue_ms=%.1f",
            comment["id"],
            job["id"],
            result["inference_ms"],
            row["queue_ms"],
        )
    except Exception:
        with connect() as c:
            c.execute(
                "UPDATE analyses SET status='failed',finished_at=now(),error='Inference failed; see worker logs' WHERE id=%s",
                (aid,),
            )
        raise


def refresh_lease(job):
    with connect() as c:
        c.execute(
            "UPDATE jobs SET lease_until=now()+interval '5 minutes' WHERE id=%s",
            (job["id"],),
        )


def run_evaluation(job, engine, runtime_id):
    run_id = job["payload"]["run_id"]
    samples, manifest = load_test()
    limit = job["payload"]["limit"]
    samples = samples[:limit]
    folder = REPORT_DIR / "evaluations" / run_id
    folder.mkdir(parents=True, exist_ok=True)
    with connect() as c:
        c.execute(
            "UPDATE evaluations SET status='processing',started_at=now(),processed=0,error=NULL WHERE id=%s",
            (run_id,),
        )
    targets, scores, timings, lengths, tokens = [], [], [], [], []
    started = time.perf_counter()
    with (folder / "predictions.jsonl.part").open("w") as out:
        for i, sample in enumerate(samples):
            if STOP.is_set():
                raise InterruptedError("Worker shutdown requested")
            result = engine.predict(sample["text"])
            target = [int(j in sample["labels"]) for j in range(28)]
            targets.append(target)
            scores.append([result["scores"][l] for l in LABELS])
            timings.append(result["inference_ms"])
            lengths.append(len(sample["text"]))
            tokens.append(result["token_count"])
            out.write(
                json.dumps(
                    {
                        "id": sample["id"],
                        "text": sample["text"],
                        "true_label_ids": sample["labels"],
                        "true_labels": [LABELS[j] for j in sample["labels"]],
                        **result,
                    }
                )
                + "\n"
            )
            if (i + 1) % 16 == 0 or i + 1 == len(samples):
                out.flush()
                refresh_lease(job)
                with connect() as c:
                    c.execute(
                        "UPDATE evaluations SET processed=%s WHERE id=%s",
                        (i + 1, run_id),
                    )
                # One resident model serves both paths; comments get a slot every 16 eval samples.
                child = claim("comment")
                if child:
                    execute(child, engine, runtime_id)
    metrics = calculate_metrics(targets, scores)
    metadata = {
        "runtime_id": str(runtime_id),
        "runtime": engine.metadata,
        "dataset": manifest,
        "official": limit == 5427,
        "batch_size": 1,
        "threshold": 0.5,
        "comparison": ">",
        "evaluation_wall_seconds": time.perf_counter() - started,
        "inference_ms": distribution(timings),
        "text_characters": distribution(lengths),
        "token_lengths": distribution(tokens),
        "note": "Evaluation wall time may include interleaved comment processing. Use the dedicated benchmark for performance.",
    }
    (folder / "predictions.jsonl.part").replace(folder / "predictions.jsonl")
    for name, value in [("metrics.json", metrics), ("metadata.json", metadata)]:
        (folder / name).write_text(json.dumps(value, indent=2))
    with connect() as c:
        c.execute(
            "UPDATE evaluations SET status='completed',finished_at=now(),processed=%s,metrics=%s,metadata=%s WHERE id=%s",
            (len(samples), Jsonb(metrics), Jsonb(metadata), run_id),
        )
        c.execute(
            "UPDATE jobs SET status='completed',lease_until=NULL WHERE id=%s",
            (job["id"],),
        )
    log.info(
        "evaluation_completed run=%s samples=%s micro_f1=%.4f",
        run_id,
        len(samples),
        metrics["micro_f1"],
    )


def run_benchmark(job, engine, runtime_id):
    run_id = job["payload"]["run_id"]
    samples, _ = load_test()
    samples = samples[: job["payload"]["samples"]]
    with connect() as c:
        c.execute(
            "UPDATE benchmarks SET status='processing',error=NULL WHERE id=%s",
            (run_id,),
        )
    for _ in range(20):
        engine.predict(samples[0]["text"])
    started = time.perf_counter()
    results = []
    for i, sample in enumerate(samples):
        if STOP.is_set():
            raise InterruptedError("Worker shutdown requested")
        results.append(engine.predict(sample["text"]))
        if (i + 1) % 16 == 0:
            refresh_lease(job)
    duration = time.perf_counter() - started
    report = {
        "runtime_id": str(runtime_id),
        "runtime": engine.metadata,
        "samples": len(samples),
        "warmup": 20,
        "batch_size": 1,
        "corpus": "First N rows of pinned official test split, original order; no threshold/model selection.",
        "text_characters": distribution([len(s["text"]) for s in samples]),
        "token_lengths": distribution([r["token_count"] for r in results]),
        "model_inference_ms": distribution([r["inference_ms"] for r in results]),
        "model_throughput_per_second": len(results) / duration,
        "rss_mb": distribution([r["rss_mb"] for r in results]),
        "process_cpu_percent": distribution([r["cpu_percent"] for r in results]),
        "cpu_definition": "Process CPU time / wall time x 100; 100% means one fully used core; sampled per inference.",
    }
    with connect() as c:
        c.execute(
            "UPDATE benchmarks SET report=%s WHERE id=%s", (Jsonb(report), run_id)
        )
        c.execute(
            "UPDATE jobs SET status='completed',lease_until=NULL WHERE id=%s",
            (job["id"],),
        )


def execute(job, engine, runtime_id):
    try:
        if job["kind"] == "comment":
            run_comment(job, engine, runtime_id)
        elif job["kind"] == "evaluation":
            run_evaluation(job, engine, runtime_id)
        else:
            run_benchmark(job, engine, runtime_id)
    except Exception:
        log.exception(
            "job_failed id=%s kind=%s attempt=%s",
            job["id"],
            job["kind"],
            job["attempts"],
        )
        state = "failed" if job["attempts"] >= 3 else "pending"
        message = "Processing failed; see worker logs. Retry available."
        with connect() as c:
            c.execute(
                "UPDATE jobs SET status=%s,lease_until=NULL,available_at=now()+interval '5 seconds',last_error=%s WHERE id=%s",
                (state, message, job["id"]),
            )
            if job["comment_id"]:
                c.execute(
                    "UPDATE comments SET status=%s,last_error=%s WHERE id=%s",
                    (state, message, job["comment_id"]),
                )
            elif job["kind"] in ("evaluation", "benchmark"):
                table = "evaluations" if job["kind"] == "evaluation" else "benchmarks"
                c.execute(
                    f"UPDATE {table} SET status=%s,error=%s WHERE id=%s",
                    (state, message, job["payload"]["run_id"]),
                )


def main():
    from .model import Engine

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
    )
    initialize()
    with connect() as lock:
        lock.autocommit = True
        if not lock.execute(
            "SELECT pg_try_advisory_lock(715803) AS acquired"
        ).fetchone()["acquired"]:
            raise RuntimeError("Another model worker already holds the singleton lock")
        engine = Engine()
        runtime_id = uuid4()
        with connect() as c:
            c.execute(
                "INSERT INTO runtimes(id,metadata) VALUES (%s,%s)",
                (runtime_id, Jsonb(engine.metadata)),
            )
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda *_: STOP.set())

        def heartbeat():
            while not STOP.wait(5):
                try:
                    with connect() as c:
                        c.execute(
                            "UPDATE runtimes SET heartbeat=now() WHERE id=%s",
                            (runtime_id,),
                        )
                except Exception:
                    log.exception("heartbeat_failed")

        threading.Thread(target=heartbeat, daemon=True).start()
        log.info(
            "model_ready runtime=%s load_ms=%.1f first_inference_ms=%.1f",
            runtime_id,
            engine.metadata["model_load_ms"],
            engine.metadata["first_inference_ms"],
        )
        tick = 0
        while not STOP.is_set():
            if time.monotonic() - tick > 5:
                lock.execute("SELECT 1")
                recover()
                tick = time.monotonic()
            job = claim()
            if job:
                execute(job, engine, runtime_id)
            else:
                STOP.wait(0.2)


if __name__ == "__main__":
    main()
