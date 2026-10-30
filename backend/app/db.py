import atexit
import threading
from pathlib import Path
from uuid import uuid4
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from .config import DATABASE_URL


def connect():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)


def initialize():
    with connect() as c:
        c.execute("SELECT pg_advisory_xact_lock(715802)")
        c.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz DEFAULT now())"
        )
        if not c.execute("SELECT 1 FROM schema_migrations WHERE version=1").fetchone():
            c.execute(Path(__file__).with_name("schema.sql").read_text())
            c.execute("INSERT INTO schema_migrations(version) VALUES (1)")
        if not c.execute("SELECT 1 FROM schema_migrations WHERE version=2").fetchone():
            c.execute(Path(__file__).with_name("sentiment.sql").read_text())
            # Backfill only the new model; never change original emotion results.
            for row in c.execute("SELECT id FROM comments").fetchall():
                enqueue_sentiment(c, row["id"])
            c.execute("INSERT INTO schema_migrations(version) VALUES (2)")
        events = [
            (
                "spring-sounds",
                "Halloween Haunted House",
                "CAMPUS LIFE / HALLOWEEN",
                "Brave the student-run haunted house. Share spooky moments, costume ideas, queue experiences, and feedback for the organizers.",
                "Campus Haunted House",
                "2026-10-31T23:00:00Z",
                False,
            ),
            (
                "campus-makers",
                "Campus Food",
                "FOOD / COMMUNITY",
                "Find your next campus favorite. Discuss dining halls, food stalls, dietary options, prices, and the best places to eat.",
                "Across Campus",
                "2026-11-01T17:00:00Z",
                False,
            ),
            (
                "night-run",
                "DSAN Feedback",
                "ACADEMICS / DSAN",
                "Talk about DSAN courses, assignments, projects, and classroom experiences. Share constructive feedback and suggestions.",
                "DSAN Community",
                "2026-11-02T18:00:00Z",
                False,
            ),
            (
                "benchmark",
                "Performance fixture",
                "INTERNAL",
                "Isolated API performance traffic",
                "Local",
                "2027-01-01T00:00:00Z",
                True,
            ),
        ]
        for e in events:
            c.execute(
                "INSERT INTO events VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING",
                e,
            )
        if not c.execute("SELECT 1 FROM schema_migrations WHERE version=3").fetchone():
            for e in events:
                if not e[6]:
                    c.execute(
                        "UPDATE events SET title=%s,category=%s,description=%s,location=%s,starts_at=%s WHERE id=%s",
                        (*e[1:6], e[0]),
                    )
            c.execute("INSERT INTO schema_migrations(version) VALUES (3)")


def enqueue(c, kind, comment_id=None, payload=None):
    jid = uuid4()
    c.execute(
        "INSERT INTO jobs(id,kind,comment_id,payload) VALUES (%s,%s,%s,%s)",
        (jid, kind, comment_id, Jsonb(payload or {})),
    )
    return jid


def enqueue_sentiment(c, comment_id):
    jid = uuid4()
    c.execute(
        "INSERT INTO sentiment_jobs(id,comment_id) VALUES (%s,%s)", (jid, comment_id)
    )
    return jid


_pool = None
_pool_lock = threading.Lock()


def transaction():
    """Bounded per-process pool; context commits/rolls back and returns connection."""
    global _pool
    with _pool_lock:
        if _pool is None:
            from psycopg_pool import ConnectionPool

            _pool = ConnectionPool(
                DATABASE_URL,
                kwargs={"row_factory": dict_row},
                min_size=1,
                max_size=8,
                timeout=10,
                open=True,
                check=ConnectionPool.check_connection,
            )
            atexit.register(_pool.close)
    return _pool.connection()
