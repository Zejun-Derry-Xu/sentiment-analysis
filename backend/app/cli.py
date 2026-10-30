import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import time
from uuid import uuid4
from pathlib import Path
from psycopg.types.json import Jsonb
from .config import MODEL_REV, DATA_REV, REPORT_DIR, LABELS
from .db import connect, initialize, enqueue, enqueue_sentiment
from .assets import load_test, prepare_model
from .metrics import distribution, calculate_metrics


def wait_run(table, run_id, timeout=3600, field="status"):
    started = time.monotonic()
    previous = None
    while time.monotonic() - started < timeout:
        with connect() as c:
            row = c.execute(f"SELECT * FROM {table} WHERE id=%s", (run_id,)).fetchone()
        state = (row["status"], row.get("processed"))
        if state != previous:
            print(
                json.dumps(
                    {"run_id": str(run_id), "status": state[0], "processed": state[1]}
                ),
                flush=True,
            )
            previous = state
        if row["status"] == "failed":
            raise RuntimeError(row["error"])
        if row[field] is not None and (
            row[field] == "completed" if field == "status" else True
        ):
            return row
        time.sleep(1)
    raise TimeoutError("Timed out; the persisted job remains available to the worker")


def evaluate(limit):
    run_id = uuid4()
    with connect() as c:
        c.execute(
            "INSERT INTO evaluations(id,model_revision,dataset_revision,total,official) VALUES (%s,%s,%s,%s,%s)",
            (run_id, MODEL_REV, DATA_REV, limit, limit == 5427),
        )
        enqueue(c, "evaluation", payload={"run_id": str(run_id), "limit": limit})
    row = wait_run("evaluations", run_id)
    print(json.dumps(row["metrics"], indent=2))
    print(f"Report: {REPORT_DIR}/evaluations/{run_id}")


def benchmark(samples, base_url):
    import httpx

    run_id = uuid4()
    with connect() as c:
        if c.execute(
            "SELECT 1 FROM jobs WHERE status IN ('pending','processing')"
        ).fetchone():
            raise RuntimeError(
                "Wait for current jobs to finish before an isolated benchmark"
            )
        c.execute(
            "INSERT INTO benchmarks(id,samples) VALUES (%s,%s)", (run_id, samples)
        )
        enqueue(c, "benchmark", payload={"run_id": str(run_id), "samples": samples})
    try:
        report = wait_run("benchmarks", run_id, field="report")["report"]
        corpus, _ = load_test()
        corpus = corpus[:samples]
        cases = []
        with httpx.Client(base_url=base_url, timeout=30) as client:
            response = client.post(
                "/api/session", json={"username": "benchmark-" + str(run_id)[:8]}
            )
            response.raise_for_status()
            for concurrency in (1, 4):

                def submit(sample):
                    begin = time.perf_counter()
                    r = client.post(
                        "/api/comments",
                        json={
                            "event_id": "benchmark",
                            "text": sample["text"],
                            "idempotency_key": str(uuid4()),
                        },
                    )
                    r.raise_for_status()
                    item = r.json()
                    cid = item["id"]
                    accepted = time.perf_counter()
                    deadline = time.monotonic() + 180
                    while item["status"] != "completed":
                        if item["status"] == "failed":
                            raise RuntimeError(f"Benchmark comment failed: {cid}")
                        if time.monotonic() > deadline:
                            raise TimeoutError(f"Benchmark comment timeout: {cid}")
                        time.sleep(0.1)
                        r = client.get("/api/comments/" + cid)
                        r.raise_for_status()
                        item = r.json()
                    from datetime import datetime

                    server_ms = (
                        datetime.fromisoformat(item["completed_at"])
                        - datetime.fromisoformat(item["created_at"])
                    ).total_seconds() * 1000
                    return {
                        "comment_id": cid,
                        "client_completion_ms": (time.perf_counter() - begin) * 1000,
                        "acceptance_ms": (accepted - begin) * 1000,
                        "server_completion_ms": server_ms,
                        "queue_ms": item["analysis"]["queue_ms"],
                        "inference_ms": item["analysis"]["inference_ms"],
                        "runtime_id": item["analysis"]["runtime_id"],
                    }

                begin = time.perf_counter()
                with ThreadPoolExecutor(max_workers=concurrency) as pool:
                    results = list(pool.map(submit, corpus))
                duration = time.perf_counter() - begin
                case = {
                    "concurrency": concurrency,
                    "samples": samples,
                    "throughput_per_second": samples / duration,
                    "poll_interval_ms": 100,
                    "results": results,
                }
                for name in (
                    "acceptance_ms",
                    "client_completion_ms",
                    "server_completion_ms",
                    "queue_ms",
                    "inference_ms",
                ):
                    case[name] = distribution([r[name] for r in results])
                cases.append(case)
                print(
                    json.dumps(
                        {k: v for k, v in case.items() if k != "results"}, indent=2
                    ),
                    flush=True,
                )
        report["api_cases"] = cases
        report["isolated_namespace"] = (
            "benchmark event; excluded from user pages, dashboard and official classification scores"
        )
        folder = REPORT_DIR / "benchmarks" / str(run_id)
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "report.json").write_text(json.dumps(report, indent=2))
        with connect() as c:
            c.execute(
                "UPDATE benchmarks SET status='completed',finished_at=now(),report=%s WHERE id=%s",
                (Jsonb(report), run_id),
            )
        print(f"Benchmark report: {folder}/report.json")
    except Exception as exc:
        with connect() as c:
            c.execute(
                "UPDATE benchmarks SET status='failed',error=%s WHERE id=%s",
                (str(exc), run_id),
            )
        raise


def rescore(path):
    rows = [json.loads(x) for x in Path(path).read_text().splitlines() if x.strip()]
    targets = [[int(l in r["true_labels"]) for l in LABELS] for r in rows]
    scores = [[r["scores"][l] for l in LABELS] for r in rows]
    print(json.dumps(calculate_metrics(targets, scores), indent=2))


def seed_demo():
    from uuid import uuid5, NAMESPACE_URL

    examples = [
        (
            "Taylor",
            "spring-sounds",
            "The haunted house was incredible. I loved the costumes and spooky decorations!",
        ),
        (
            "Jordan",
            "spring-sounds",
            "I was disappointed by the long haunted house queue. Please improve the organization.",
        ),
        (
            "Sam",
            "campus-makers",
            "The campus food festival was delicious! Thank you to the friendly kitchen staff.",
        ),
        (
            "Riley",
            "campus-makers",
            "I am curious about the new campus food stalls. Will there be more vegetarian options?",
        ),
        (
            "Morgan",
            "night-run",
            "I am nervous about the DSAN project, but excited to learn new data science skills.",
        ),
        (
            "Casey",
            "night-run",
            "The DSAN assignment instructions were confusing, but the teaching assistants were helpful.",
        ),
    ]
    count = 0
    with connect() as c:
        for username, event, text in examples:
            uid = uuid5(NAMESPACE_URL, "campus-notes-demo-user:" + username)
            cid = uuid5(NAMESPACE_URL, "campus-notes-demo-comment:" + event + text)
            c.execute(
                "INSERT INTO users(id,username) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                (uid, username),
            )
            row = c.execute(
                "INSERT INTO comments(id,event_id,user_id,text,idempotency_key) VALUES (%s,%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING RETURNING id",
                (cid, event, uid, text, cid),
            ).fetchone()
            if row:
                enqueue(c, "comment", cid)
                enqueue_sentiment(c, cid)
                count += 1
    print(
        f"Queued {count} fictional demo comments for real model inference; no ground-truth labels are assigned."
    )


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init")
    commands.add_parser("prepare")
    commands.add_parser("seed-demo")
    e = commands.add_parser("evaluate")
    e.add_argument(
        "--limit", type=int, default=5427, choices=range(1, 5428), metavar="1..5427"
    )
    b = commands.add_parser("benchmark")
    b.add_argument(
        "--samples", type=int, default=100, choices=range(1, 101), metavar="1..100"
    )
    b.add_argument("--base-url", default="http://web")
    r = commands.add_parser("rescore")
    r.add_argument("predictions")
    args = parser.parse_args()
    if args.command == "rescore":
        rescore(args.predictions)
        return
    initialize()
    if args.command == "seed-demo":
        seed_demo()
    elif args.command == "prepare":
        print(json.dumps(prepare_model(), indent=2))
        load_test()
    elif args.command == "evaluate":
        evaluate(args.limit)
    elif args.command == "benchmark":
        benchmark(args.samples, args.base_url)
    else:
        print("Database initialized and demo events seeded.")


if __name__ == "__main__":
    main()
