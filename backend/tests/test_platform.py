from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb
import numpy as np
import pytest
from app.main import app
from app.db import connect
from app.worker import claim, execute, recover
from app.model import score_logits
from app.metrics import calculate_metrics
from app.config import LABELS


class GoodEngine:
    def predict(self, text):
        logits = np.full(28, -10.0)
        logits[LABELS.index("joy")] = 2
        logits[LABELS.index("gratitude")] = 1
        return {
            **score_logits(logits),
            "inference_ms": 12.5,
            "token_count": 10,
            "truncated": False,
            "rss_mb": 400.0,
            "cpu_percent": 110.0,
        }


class BrokenEngine:
    def predict(self, text):
        raise RuntimeError("simulated inference failure")


def test_session_and_validation(client):
    assert client.get("/api/session").json()["username"] == "Alex"
    assert client.post("/api/session", json={"username": "   "}).status_code == 422
    assert client.post("/api/session", json={"username": "x" * 33}).status_code == 422
    assert (
        client.post(
            "/api/comments",
            json={
                "event_id": "spring-sounds",
                "text": " ",
                "idempotency_key": str(uuid4()),
            },
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/comments",
            json={
                "event_id": "spring-sounds",
                "text": "x" * 2001,
                "idempotency_key": str(uuid4()),
            },
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/comments",
            json={
                "event_id": "missing",
                "text": "Good",
                "idempotency_key": str(uuid4()),
            },
        ).status_code
        == 404
    )
    assert client.get("/api/comments/not-a-uuid").status_code == 422
    assert client.get("/api/comments?label=missing").status_code == 422
    assert client.get("/api/comments?after=2026-01-01T00:00:00").status_code == 422
    assert (
        client.post(
            "/api/comments", json={}, headers={"Origin": "https://evil.example"}
        ).status_code
        == 403
    )
    assert client.delete("/api/session").status_code == 204
    assert client.get("/api/comments?mine=true").status_code == 401


def test_save_idempotency_and_browser_identity(client):
    body = {
        "event_id": "spring-sounds",
        "text": "Great concert!",
        "idempotency_key": str(uuid4()),
    }
    one = client.post("/api/comments", json=body).json()
    assert one["status"] == "pending" and one["analysis"] is None
    assert client.post("/api/comments", json=body).json()["id"] == one["id"]
    assert (
        client.post("/api/comments", json={**body, "text": "Different"}).status_code
        == 409
    )
    with TestClient(app) as other:
        other.post("/api/session", json={"username": "Alex"})
        assert other.get("/api/comments?mine=true").json()["total"] == 0
        assert other.get("/api/comments").json()["total"] == 1
        assert (
            other.put(
                f"/api/comments/{one['id']}/handling", json={"status": "viewed"}
            ).status_code
            == 200
        )
    assert client.get("/api/comments?mine=true").json()["total"] == 1


def test_analysis_review_filters_and_immutability(client, new_comment, runtime):
    job = claim()
    execute(job, GoodEngine(), runtime)
    cid = new_comment["id"]
    original = client.get("/api/comments/" + cid).json()
    assert original["status"] == "completed"
    assert original["analysis"]["labels"] == ["gratitude", "joy"]
    assert client.get("/api/comments?label=joy&status=completed").json()["total"] == 1
    assert client.get("/api/comments?event_id=night-run").json()["total"] == 0
    assert (
        client.put(f"/api/comments/{cid}/favorite", json={"value": True}).status_code
        == 200
    )
    assert client.get("/api/comments?favorites=true").json()["total"] == 1
    assert (
        client.put(
            f"/api/comments/{cid}/handling", json={"status": "processed"}
        ).status_code
        == 200
    )
    assert client.get("/api/comments?handling=processed").json()["total"] == 1
    assert (
        client.post(
            f"/api/comments/{cid}/corrections",
            json={"labels": ["approval"], "reason": "Human review"},
        ).status_code
        == 201
    )
    assert (
        client.post(
            f"/api/comments/{cid}/corrections",
            json={"labels": [], "reason": "No emotion expressed"},
        ).status_code
        == 201
    )
    detail = client.get("/api/comments/" + cid).json()
    assert detail["analysis"] == original["analysis"]
    assert (
        len(detail["correction_history"]) == 2 and detail["correction"]["labels"] == []
    )
    assert len(detail["handling_history"]) == 1
    assert (
        client.post(
            f"/api/comments/{cid}/corrections",
            json={"labels": ["fake"], "reason": "Invalid"},
        ).status_code
        == 422
    )
    assert client.post(f"/api/comments/{cid}/retry").status_code == 409
    with TestClient(app) as other:
        other.post("/api/session", json={"username": "Jordan"})
        assert other.get("/api/comments?favorites=true").json()["total"] == 0
        # Public demo intentionally allows dashboard actions for all sessions.
        assert (
            other.post(
                f"/api/comments/{cid}/corrections",
                json={"labels": ["joy"], "reason": "Another public review"},
            ).status_code
            == 201
        )


def test_failure_preserves_comment_and_retry_history(client, new_comment, runtime):
    cid = new_comment["id"]
    assert (
        client.post(
            f"/api/comments/{cid}/corrections",
            json={"labels": [], "reason": "Too early"},
        ).status_code
        == 409
    )
    for _ in range(3):
        job = claim()
        assert job is not None
        execute(job, BrokenEngine(), runtime)
        with connect() as c:
            c.execute("UPDATE jobs SET available_at=now() WHERE status='pending'")
    failed = client.get("/api/comments/" + cid).json()
    assert failed["status"] == "failed" and failed["text"] == new_comment["text"]
    assert len(failed["attempts"]) == 3
    assert client.post(f"/api/comments/{cid}/retry").status_code == 202
    assert client.post(f"/api/comments/{cid}/retry").status_code == 409
    execute(claim(), GoodEngine(), runtime)
    final = client.get("/api/comments/" + cid).json()
    assert final["status"] == "completed" and len(final["attempts"]) == 4


def test_exclusive_claim_and_lease_recovery(client, new_comment, runtime):
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = list(pool.map(lambda _: claim(), range(2)))
    claimed = [j for j in jobs if j]
    assert len(claimed) == 1
    with connect() as c:
        c.execute("UPDATE jobs SET lease_until=now()-interval '1 second'")
    assert recover() == 1
    assert (
        client.get("/api/comments/" + new_comment["id"]).json()["status"] == "pending"
    )
    job = claim()
    with connect() as c:
        c.execute("UPDATE jobs SET lease_until=now()-interval '1 second',attempts=3")
    recover()
    assert client.get("/api/comments/" + new_comment["id"]).json()["status"] == "failed"


def test_sigmoid_once_strict_threshold_and_multilabel():
    r = score_logits(np.zeros(28))
    assert r["labels"] == [] and r["top_score"] == 0.5
    x = np.full(28, -10.0)
    x[0] = 2.0
    x[1] = 1.0
    r = score_logits(x)
    assert r["scores"]["admiration"] == pytest.approx(0.88079707798)
    assert r["labels"] == ["admiration", "amusement"]
    assert "neutral" not in r["labels"]
    with pytest.raises(ValueError):
        score_logits([1, 2])
    with pytest.raises(ValueError):
        score_logits([float("nan")] * 28)


def test_metrics_include_all_28_classes_and_exact_match():
    y = np.zeros((2, 28), int)
    p = np.zeros((2, 28), float)
    y[0, 15] = y[0, 17] = y[1, 27] = 1
    p[0, 17] = p[1, 27] = 0.9
    m = calculate_metrics(y, p)
    assert m["micro_f1"] == pytest.approx(0.8)
    assert m["macro_f1"] == pytest.approx(2 / 28)
    assert m["exact_match_accuracy"] == 0.5
    assert len(m["per_label"]) == 28 and m["per_label"][16]["support"] == 0
    assert m["per_label"][16]["f1"] == 0


def test_benchmark_isolation_and_readiness(client, runtime):
    assert len(client.get("/api/events").json()) == 3
    r = client.post(
        "/api/comments",
        json={
            "event_id": "benchmark",
            "text": "Thanks!",
            "idempotency_key": str(uuid4()),
        },
    )
    assert r.status_code == 202
    assert client.get("/api/comments").json()["total"] == 0
    assert client.get("/api/stats").json()["total"] == 0
    assert client.get("/ready").status_code == 200
    with connect() as c:
        c.execute("UPDATE runtimes SET heartbeat=now()-interval '1 minute'")
    assert client.get("/ready").status_code == 503


def test_published_fixed_128_padding_and_truncation_are_overridden(tmp_path):
    from tokenizers import Tokenizer, models, pre_tokenizers, processors
    from app.model import load_tokenizers

    t = Tokenizer(
        models.WordLevel(
            {"[UNK]": 0, "<pad>": 1, "<s>": 2, "</s>": 3, "hello": 4}, unk_token="[UNK]"
        )
    )
    t.pre_tokenizer = pre_tokenizers.Whitespace()
    t.post_processor = processors.TemplateProcessing(
        single="<s> $A </s>", special_tokens=[("<s>", 2), ("</s>", 3)]
    )
    t.enable_padding(length=128, pad_id=1, pad_token="<pad>")
    t.enable_truncation(max_length=128)
    path = tmp_path / "tokenizer.json"
    t.save(str(path))
    configured, unbounded = load_tokenizers(path)
    short = configured.encode("hello")
    assert len(short.ids) == 3 and short.attention_mask == [1, 1, 1]
    middle = configured.encode(" ".join(["hello"] * 150))
    assert len(middle.ids) == 152
    long = configured.encode(" ".join(["hello"] * 600))
    assert len(long.ids) == 512 and long.ids[-1] == 3
    assert len(unbounded.encode(" ".join(["hello"] * 600)).ids) == 602
