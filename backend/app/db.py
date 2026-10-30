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
                "Spring Sounds · 草坪音乐夜",
                "音乐 / MUSIC",
                "学生乐队、落日与草坪。分享你对表演、音响和现场组织的体验。",
                "North Lawn",
                "2027-04-16T18:00:00Z",
                False,
            ),
            (
                "campus-makers",
                "Campus Makers · 创意市集",
                "创意 / COMMUNITY",
                "逛逛学生的手作、插画和小发明，留下你的真实活动体验。",
                "Student Union",
                "2027-04-20T15:00:00Z",
                False,
            ),
            (
                "night-run",
                "After Hours · 校园夜跑",
                "运动 / WELLNESS",
                "一起跑过熟悉的校园。告诉我们路线、补给与组织体验如何。",
                "University Track",
                "2027-04-23T23:00:00Z",
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
