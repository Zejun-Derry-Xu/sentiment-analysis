"""Real PostgreSQL comment path, wait for both independently completed models."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import json
from pathlib import Path
import time
from uuid import uuid4
import httpx

TEXTS = [
    "The performances were wonderful! Thank you for organizing the concert.",
    "I was disappointed by the long wait, but I loved the performances.",
    "The event starts at six in the student union.",
    "The volunteers were helpful, but the signs were confusing and I waited for an hour.",
]


def dist(values):
    values = sorted(values)

    def q(v):
        i = (len(values) - 1) * v
        lo = int(i)
        hi = min(lo + 1, len(values) - 1)
        return values[lo] + (values[hi] - values[lo]) * (i - lo)

    return {
        "n": len(values),
        "p50": q(0.5),
        "p95": q(0.95),
        "mean": sum(values) / len(values),
        "max": max(values),
    }


def run(base, samples):
    with httpx.Client(base_url=base, timeout=120) as c:
        c.get("/ready").raise_for_status()
        c.post(
            "/api/session", json={"username": "Dual CPU benchmark"}
        ).raise_for_status()
        report = {
            "samples_per_case": samples,
            "texts": TEXTS,
            "batch_size": 1,
            "warmup": 8,
            "runtime": c.get("/api/runtime").json(),
            "sentiment_runtime": c.get("/api/sentiment/runtime").json(),
            "protocol": "Fixed four campus sentences, real PostgreSQL jobs, both models required. Server completion: DB created_at to last model finished_at. Observed completion: HTTP plus 15ms polling. Fixture excluded from product statistics. Not an accuracy test.",
        }

        def one(i):
            start = time.perf_counter()
            r = c.post(
                "/api/comments",
                json={
                    "event_id": "benchmark",
                    "text": TEXTS[i % 4],
                    "idempotency_key": str(uuid4()),
                },
            )
            r.raise_for_status()
            cid = r.json()["id"]
            while time.perf_counter() - start < 120:
                r = c.get("/api/comments/" + cid)
                r.raise_for_status()
                d = r.json()
                if d["status"] == "completed" and d["sentiment_status"] == "completed":
                    break
                if d["status"] == "failed" or d["sentiment_status"] == "failed":
                    raise RuntimeError("Model job failed")
                time.sleep(0.015)
            else:
                raise TimeoutError("Both jobs did not complete")
            a = d["analysis"]
            s = d["sentiment"]
            finish = max(
                datetime.fromisoformat(a["finished_at"]),
                datetime.fromisoformat(s["finished_at"]),
            )
            return {
                "comment_id": cid,
                "server_completion_ms": (
                    finish - datetime.fromisoformat(d["created_at"])
                ).total_seconds()
                * 1000,
                "observed_completion_ms": (time.perf_counter() - start) * 1000,
                "emotion_queue_ms": a["queue_ms"],
                "emotion_inference_ms": a["inference_ms"],
                "sentiment_queue_ms": s["queue_ms"],
                "sentiment_service_queue_ms": s["service_queue_ms"],
                "sentiment_inference_ms": s["inference_ms"],
                "emotion_rss_mib": a["rss_mb"],
                "sentiment_rss_mib": s["rss_mb"],
            }

        for i in range(8):
            one(i)
        cases = []
        for concurrency in (1, 4, 8):
            start = time.perf_counter()
            with ThreadPoolExecutor(max_workers=concurrency) as pool:
                rows = list(pool.map(one, range(samples)))
            case = {
                "concurrency": concurrency,
                "samples": samples,
                "throughput_per_second": samples / (time.perf_counter() - start),
                "rows": rows,
            }
            for key in rows[0]:
                if key != "comment_id":
                    case[key] = dist([r[key] for r in rows])
            cases.append(case)
        report["cases"] = cases
        return report


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--base", default="http://localhost:5180")
    p.add_argument("--samples", type=int, default=40)
    p.add_argument("--output", default="/tmp/dual-benchmark.json")
    a = p.parse_args()
    assert 4 <= a.samples <= 200
    result = run(a.base, a.samples)
    Path(a.output).write_text(json.dumps(result, indent=2))
    print(
        json.dumps(
            {
                "cases": [
                    {k: v for k, v in case.items() if k != "rows"}
                    for case in result["cases"]
                ]
            },
            indent=2,
        )
    )
