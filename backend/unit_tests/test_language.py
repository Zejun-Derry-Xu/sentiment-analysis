"""Run without PostgreSQL: PYTHONPATH=backend pytest backend/unit_tests."""

from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from app.language import requires_english
from app.main import NewComment
from app import main


@pytest.mark.parametrize("text", [
    "La comida del comedor estuvo horrible hoy, muy decepcionante.",
    "La comida estaba deliciosa, pero tuve que esperar cuarenta minutos y eso fue frustrante.",
    "Merci beaucoup pour ce repas délicieux.",
    "Das Essen in der Mensa war heute wirklich schlecht.",
    "今天食堂的饭菜很难吃。",
    "La comida del comedor estuvo horrible hoy, muy decepcionante. https://georgetown.edu/food",
    "La co\u200bmida del comedor estuvo horrible hoy, muy decepcionante.",
])
def test_detects_unsupported_language(text):
    assert requires_english(text)


@pytest.mark.parametrize("text", [
    "The dining hall food was horrible today, very disappointing.",
    "Need more protein here",
    "I loved the music!",
    "The café serves delicious croissants.",
    "Hoyas love Georgetown!",
    "Great, another cold meal after waiting 40 minutes. Exactly what I needed.",
    "I love the food! 😄",
    "Good",
    "DSAN",
])
def test_english_and_ambiguous_short_text_are_not_rejected(text):
    assert NewComment(event_id="campus-makers", text=text, idempotency_key=uuid4()).text == text


def test_spanish_submission_is_rejected_before_database_or_queue_access(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("Rejected posts must not access storage or inference queues")

    monkeypatch.setattr(main, "connect", forbidden)
    monkeypatch.setattr(main, "enqueue", forbidden)
    monkeypatch.setattr(main, "enqueue_sentiment", forbidden)
    main.app.dependency_overrides[main.session_user] = lambda: {
        "id": str(uuid4()), "username": "Student", "role": "student",
    }
    try:
        # No context manager: intentionally skip the database startup lifespan.
        with_client = TestClient(main.app)
        response = with_client.post("/api/comments", json={
            "event_id": "campus-makers",
            "text": "La comida del comedor estuvo horrible hoy, muy decepcionante.",
            "idempotency_key": str(uuid4()),
        })
        with_client.close()
        assert response.status_code == 422
        message = response.json()["detail"][0]["msg"]
        assert "English only" in message
        assert "Your draft has been kept" in message
    finally:
        main.app.dependency_overrides.pop(main.session_user, None)
