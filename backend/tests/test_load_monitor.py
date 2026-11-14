from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from fastapi.testclient import TestClient

from app.db import connect
from app.load_monitor import clear_pending_runs
from app.main import app
from app.worker import claim, execute
from test_platform import GoodEngine

RUNS = "/api/admin/load-runs"
CODE = {"X-Load-Demo-Code": "test-load-code"}


def test_topic_creation_and_date_scope(client, new_comment):
    created = client.post(
        "/api/events",
        json={"title": "New campus event", "description": "Share your feedback."},
    )
    assert created.status_code == 201
    topic = created.json()["id"]
    assert (
        client.get("/api/stats?include_topics=true").json()["topics"][topic]["total"]
        == 0
    )
    assert (
        client.post(
            "/api/comments",
            json={
                "event_id": topic,
                "text": "Great! 🎉",
                "idempotency_key": str(uuid4()),
            },
        ).status_code
        == 202
    )
    stats = client.get("/api/stats?include_topics=true").json()
    assert stats["total"] == 2 and stats["topics"][topic]["total"] == 1
    assert client.get("/api/stats", params={"event_id": topic}).json()["total"] == 1
    assert (
        client.get("/api/stats?before=2000-01-01T00:00:00Z&include_topics=true").json()[
            "topics"
        ][topic]["total"]
        == 0
    )


def test_load_run_limits_trace_and_scoped_cleanup(client, new_comment, runtime):
    with TestClient(app) as student:
        student.post("/api/register", json={"username": "Viewer", "password": "1"})
        assert student.get(RUNS).status_code == 403
        assert student.post(RUNS, headers=CODE).status_code == 403
    assert client.post(RUNS, headers={"X-Load-Demo-Code": "wrong"}).status_code == 403
    with ThreadPoolExecutor(max_workers=2) as pool:
        starts = list(pool.map(lambda _: client.post(RUNS, headers=CODE), range(2)))
    assert sorted(s.status_code for s in starts) == [201, 409]
    run = next(s.json() for s in starts if s.status_code == 201)
    endpoint = RUNS + "/" + run["id"]
    submit = endpoint + "/samples/1"
    with ThreadPoolExecutor(max_workers=2) as pool:
        submissions = list(
            pool.map(lambda _: client.post(submit, headers=CODE), range(2))
        )
    assert all(r.status_code == 202 for r in submissions)
    cid = submissions[0].json()["comment_id"]
    assert submissions[1].json()["comment_id"] == cid
    assert client.post(endpoint + "/samples/101", headers=CODE).status_code == 422
    assert client.get("/api/comments/" + cid).status_code == 404
    assert client.get("/api/comments?mine=true").json()["total"] == 1
    assert client.get("/api/stats").json()["total"] == 1
    assert (
        client.put(
            endpoint + "/measurements",
            headers=CODE,
            json=[
                {"sample": 1, "http_ms": 12},
                {"sample": 2, "http_ms": 10000, "error": "timeout"},
            ],
        ).status_code
        == 200
    )
    assert client.get(endpoint).json()["samples"][1]["submit_error"] == "timeout"
    assert client.post(endpoint + "/samples/3", headers=CODE).status_code == 202

    with connect() as c:
        c.execute("UPDATE load_runs SET expires_at=now()-interval '1 second'")
    assert client.post(endpoint + "/samples/4", headers=CODE).status_code == 409
    execute(claim(), GoodEngine(), runtime)
    in_flight = claim()
    assert str(in_flight["comment_id"]) == cid
    assert client.delete(endpoint).status_code == 403
    assert client.delete(endpoint, headers=CODE).status_code == 202
    clear_pending_runs()
    assert client.get(endpoint).json()["phase"] == "clearing"
    execute(in_flight, GoodEngine(), runtime)
    assert (
        client.get(endpoint).json()["samples"][0]["emotion"][0]["status"] == "completed"
    )
    clear_pending_runs()
    cleared = client.get(endpoint).json()
    assert cleared["phase"] == "cleared" and not cleared["samples"]
    assert client.delete(endpoint, headers=CODE).json()["phase"] == "cleared"
    assert client.get("/api/comments/" + new_comment["id"]).status_code == 200
    assert client.post(RUNS, headers=CODE).status_code == 409
