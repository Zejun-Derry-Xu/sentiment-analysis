from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
import httpx
import pytest
from psycopg.types.json import Jsonb
from app.db import connect, initialize
from app import sentiment_worker as sw
from app.worker import claim as claim_emotion, execute as emotion_execute
from test_platform import GoodEngine


def service(fail=False):
    def respond(request):
        if fail:
            return httpx.Response(503, json={"detail": "Unavailable"})
        return httpx.Response(
            200,
            json={
                "label": "positive",
                "scores": {"negative": 0.05, "neutral": 0.15, "positive": 0.8},
                "inference_ms": 22.0,
                "queue_ms": 0.1,
                "token_count": 8,
                "rss_mb": 800,
                "runtime_id": "model-test",
            },
        )

    return httpx.Client(
        base_url="http://sentiment", transport=httpx.MockTransport(respond)
    )


def sentiment_runtime():
    rid = uuid4()
    with connect() as c:
        c.execute(
            "INSERT INTO sentiment_runtimes(id,metadata) VALUES (%s,'{}')", (rid,)
        )
    return rid


def test_dual_independent_results_stats_and_filters(client, new_comment, runtime):
    rid = sentiment_runtime()
    cid = new_comment["id"]
    with connect() as c:
        assert (
            c.execute("SELECT count(*) AS n FROM sentiment_jobs").fetchone()["n"] == 1
        )
    # Sentiment finishing first must not falsely mark emotion complete.
    sw.execute(sw.claim(), service(), rid, "model-test")
    note = client.get("/api/comments/" + cid).json()
    assert note["sentiment_status"] == "completed" and note["status"] == "pending"
    assert note["analysis"] is None and note["sentiment"]["label"] == "positive"
    assert client.get("/api/stats").json()["completed"] == 0
    emotion_execute(claim_emotion(), GoodEngine(), runtime)
    stats = client.get("/api/stats").json()
    assert stats["completed"] == 1 and stats["waiting"] == 0
    assert stats["sentiment"] == {"negative": 0, "neutral": 0, "positive": 1}
    assert {r["label"]: r["count"] for r in stats["emotions"]} == {
        "gratitude": 1,
        "joy": 1,
    }
    assert client.get("/api/comments?sentiment=positive&label=joy").json()["total"] == 1
    assert client.get("/api/comments?sentiment=negative").json()["total"] == 0
    assert client.get("/api/comments?sentiment=invalid").status_code == 422
    assert client.get("/api/comments?sentiment_status=completed").json()["total"] == 1
    before = client.get("/api/comments/" + cid).json()
    client.post(
        f"/api/comments/{cid}/corrections",
        json={"labels": [], "reason": "Independent human record"},
    )
    after = client.get("/api/comments/" + cid).json()
    assert (
        before["analysis"] == after["analysis"]
        and before["sentiment"] == after["sentiment"]
    )
    assert len(after["sentiment_attempts"]) == 1
    # Initialization never duplicates jobs, changes outputs or destroys persisted results.
    initialize()
    initialize()
    assert client.get("/api/comments/" + cid).json()["sentiment"] == before["sentiment"]
    with connect() as c:
        assert (
            c.execute("SELECT count(*) AS n FROM sentiment_jobs").fetchone()["n"] == 1
        )


def test_sentiment_failure_retry_preserves_emotion(client, new_comment, runtime):
    rid = sentiment_runtime()
    cid = new_comment["id"]
    emotion_execute(claim_emotion(), GoodEngine(), runtime)
    original = client.get("/api/comments/" + cid).json()["analysis"]
    for _ in range(3):
        sw.execute(sw.claim(), service(True), rid, "model-test")
        with connect() as c:
            c.execute(
                "UPDATE sentiment_jobs SET available_at=now() WHERE status='pending'"
            )
    note = client.get("/api/comments/" + cid).json()
    assert (
        note["status"] == "completed"
        and note["analysis"] == original
        and note["sentiment_status"] == "failed"
    )
    assert len(note["sentiment_attempts"]) == 3
    assert client.post(f"/api/comments/{cid}/sentiment/retry").status_code == 202
    assert client.post(f"/api/comments/{cid}/sentiment/retry").status_code == 409
    sw.execute(sw.claim(), service(), rid, "model-test")
    note = client.get("/api/comments/" + cid).json()
    assert (
        note["sentiment_status"] == "completed"
        and note["analysis"] == original
        and len(note["sentiment_attempts"]) == 4
    )


def test_sentiment_claim_and_recovery(client, new_comment):
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = list(pool.map(lambda _: sw.claim(), range(2)))
    assert len([j for j in jobs if j]) == 1
    with connect() as c:
        c.execute("UPDATE sentiment_jobs SET lease_until=now()-interval '1 second'")
    assert sw.recover() == 1
    assert (
        client.get("/api/comments/" + new_comment["id"]).json()["sentiment_status"]
        == "pending"
    )
    job = sw.claim()
    with connect() as c:
        c.execute(
            "UPDATE sentiment_jobs SET lease_until=now()-interval '1 second',attempts=3"
        )
    sw.recover()
    assert (
        client.get("/api/comments/" + new_comment["id"]).json()["sentiment_status"]
        == "failed"
    )


def test_dual_readiness_and_service_output_validation(client, runtime, monkeypatch):
    monkeypatch.setenv("ENABLE_SENTIMENT", "true")
    assert client.get("/ready").status_code == 503
    sentiment_runtime()
    assert client.get("/ready").json()["sentiment_worker"] == "ready"
    good = {
        "label": "positive",
        "scores": {"negative": 0.05, "neutral": 0.15, "positive": 0.8},
    }
    assert sw.validate_result(good) == good
    for bad in (
        {**good, "label": "neutral"},
        {**good, "scores": {"positive": 1}},
        {**good, "scores": {"positive": float("nan"), "neutral": 0.2, "negative": 0.3}},
    ):
        with pytest.raises(ValueError):
            sw.validate_result(bad)


def test_forum_migration_preserves_existing_analysis(client, new_comment, runtime):
    cid = new_comment["id"]
    emotion_execute(claim_emotion(), GoodEngine(), runtime)
    sw.execute(sw.claim(), service(), sentiment_runtime(), "model-test")
    before = client.get("/api/comments/" + cid).json()
    with connect() as c:
        c.execute("DELETE FROM schema_migrations WHERE version=3")
        c.execute("UPDATE events SET title='Legacy title' WHERE NOT is_benchmark")
    initialize()
    initialize()
    after = client.get("/api/comments/" + cid).json()
    assert (
        before["analysis"] == after["analysis"]
        and before["sentiment"] == after["sentiment"]
    )
    assert after["text"] == before["text"] and after["id"] == cid
    events = client.get("/api/events").json()
    assert [e["title"] for e in events] == [
        "Halloween Haunted House",
        "Campus Food",
        "DSAN Feedback",
    ]
    assert all(
        not any(
            "\u4e00" <= ch <= "\u9fff"
            for ch in e["title"] + e["description"] + e["category"]
        )
        for e in events
    )
    assert all("favorite" not in c for c in client.get("/api/comments").json()["items"])


def test_forum_demo_seeds_both_queues_idempotently(client):
    from app.cli import seed_demo

    seed_demo()
    with connect() as c:
        assert c.execute("SELECT count(*) AS n FROM comments").fetchone()["n"] == 6
        assert (
            c.execute("SELECT count(*) AS n FROM jobs WHERE kind='comment'").fetchone()[
                "n"
            ]
            == 6
        )
        assert (
            c.execute("SELECT count(*) AS n FROM sentiment_jobs").fetchone()["n"] == 6
        )
    seed_demo()
    assert client.get("/api/comments").json()["total"] == 6
