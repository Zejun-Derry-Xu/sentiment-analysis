import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
import time
from uuid import uuid4
import httpx
from shared import REPORTS, LABELS, dataset, distribution

BASE = os.getenv("BASE_URL", "http://inference:8000")


def benchmark(client, samples):
    response = client.post("/benchmark", json={"samples": samples})
    response.raise_for_status()
    report = response.json()
    rows, _ = dataset()
    rows = rows[:samples]
    cases = []
    for concurrency in (1, 4):

        def predict(row):
            begin = time.perf_counter()
            r = client.post("/predict", json={"text": row["text"]})
            r.raise_for_status()
            return {
                **r.json(),
                "http_roundtrip_ms": (time.perf_counter() - begin) * 1000,
            }

        begin = time.perf_counter()
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            results = list(pool.map(predict, rows))
        elapsed = time.perf_counter() - begin
        assert all(
            r["runtime_id"] == report["runtime"]["runtime_id"] for r in results
        ), "Model restarted during benchmark"
        case = {
            "concurrency": concurrency,
            "samples": samples,
            "throughput_per_second": samples / elapsed,
            "results": results,
        }
        for field in (
            "inference_ms",
            "queue_ms",
            "handler_completion_ms",
            "http_roundtrip_ms",
        ):
            case[field] = distribution([r[field] for r in results])
        cases.append(case)
        print(
            json.dumps({k: v for k, v in case.items() if k != "results"}, indent=2),
            flush=True,
        )
    report["api_cases"] = cases
    report["definition"] = (
        "Isolated synchronous inference HTTP service; one resident CPU model protected by a serial lock. Does not include Campus Notes comment/database/job workflow."
    )
    report["run_id"] = str(uuid4())
    (REPORTS / "latest-benchmark.json").write_text(json.dumps(report, indent=2))
    print("Report: /reports/latest-benchmark.json")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "command",
        choices=["all", "evaluate", "benchmark", "predict"],
        default="all",
        nargs="?",
    )
    parser.add_argument("--limit", type=int, default=12284)
    parser.add_argument("--samples", type=int, default=100)
    parser.add_argument("--text", default="The event was wonderful!")
    args = parser.parse_args()
    with httpx.Client(base_url=BASE, timeout=httpx.Timeout(7200, connect=30)) as client:
        if args.command == "predict":
            r = client.post("/predict", json={"text": args.text})
            r.raise_for_status()
            print(json.dumps(r.json(), indent=2))
            return
        if args.command in ("evaluate", "all"):
            r = client.post("/evaluate", json={"limit": args.limit})
            r.raise_for_status()
            report = r.json()
            print(
                json.dumps(
                    {
                        "run_id": report["run_id"],
                        "metrics": report["metrics"],
                        "elapsed_seconds": report["evaluation_wall_seconds"],
                    },
                    indent=2,
                ),
                flush=True,
            )
        if args.command in ("benchmark", "all"):
            benchmark(client, args.samples)


if __name__ == "__main__":
    main()
