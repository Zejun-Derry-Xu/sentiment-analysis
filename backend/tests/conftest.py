import os
from uuid import uuid4
import psycopg
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from psycopg import sql
import pytest

test_url = os.getenv("TEST_DATABASE_URL", "")
if not test_url:
    raise RuntimeError(
        "Tests require TEST_DATABASE_URL pointing to a dedicated *_test database"
    )
params = conninfo_to_dict(test_url)
if not params["dbname"].endswith("_test"):
    raise RuntimeError("Refusing to use a non-test database")
dbname = params["dbname"]
params["dbname"] = "postgres"
with psycopg.connect(make_conninfo(**params), autocommit=True) as admin:
    if not admin.execute(
        "SELECT 1 FROM pg_database WHERE datname=%s", (dbname,)
    ).fetchone():
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(dbname)))
os.environ["DATABASE_URL"] = test_url
from app.db import initialize, connect
from app.main import app
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def reset():
    initialize()
    with connect() as c:
        c.execute("TRUNCATE users,runtimes,evaluations,benchmarks CASCADE")
    yield


@pytest.fixture
def client():
    with TestClient(app) as client:
        assert client.post("/api/session", json={"username": "Alex"}).status_code == 200
        yield client


@pytest.fixture
def runtime():
    rid = uuid4()
    with connect() as c:
        c.execute("INSERT INTO runtimes(id,metadata) VALUES (%s,'{}')", (rid,))
    return rid


@pytest.fixture
def new_comment(client):
    r = client.post(
        "/api/comments",
        json={
            "event_id": "spring-sounds",
            "text": "I loved the music!",
            "idempotency_key": str(uuid4()),
        },
    )
    assert r.status_code == 202
    return r.json()
