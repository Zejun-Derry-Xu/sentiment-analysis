import json
import os
from pathlib import Path
import httpx
from shared import LABELS, preprocess

assert preprocess("Hi @someone see https://example.org now") == "Hi @user see http now"
assert (
    preprocess("person@example.org HTTP://example.org")
    == "person@example.org HTTP://example.org"
)
results = []
with httpx.Client(
    base_url=os.getenv("BASE_URL", "http://inference:8000"), timeout=120
) as client:
    meta = client.get("/metadata").json()
    assert meta["device"] == "cpu" and meta["precision"] == "float32"
    assert (
        meta["packages"]["torch"].endswith("+cpu") and meta["cuda_available"] is False
    )
    assert meta["threads"] == 2 and meta["interop_threads"] == 1
    assert (
        not meta["loading_info"]["missing_keys"]
        and not meta["loading_info"]["mismatched_keys"]
    )
    for text, expected in [
        ("The event was wonderful! I loved every minute of it.", "positive"),
        ("The event was terrible and a complete waste of time.", "negative"),
        ("The event is scheduled for six o'clock in room 102.", "neutral"),
    ]:
        r = client.post("/predict", json={"text": text})
        r.raise_for_status()
        d = r.json()
        assert (
            set(d["scores"]) == set(LABELS)
            and abs(sum(d["scores"].values()) - 1) < 1e-5
        )
        assert d["label"] == max(d["scores"], key=d["scores"].get) == expected
        assert 0 < d["token_count"] < 128
        results.append({"text": text, **d})
    assert client.post("/predict", json={"text": "   "}).status_code == 422
    assert client.post("/predict", json={"text": "x" * 2001}).status_code == 422
    r = client.post("/predict", json={"text": "!? " * 660})
    r.raise_for_status()
    assert r.json()["token_count"] == 512
report = {
    "passed": True,
    "model_revision": meta["revision"],
    "checks": [
        "author preprocessing",
        "CPU-only runtime",
        "complete classifier weights",
        "three semantic smoke examples",
        "softmax normalization and argmax",
        "short-text tokenization",
        "input validation",
        "512-token truncation",
    ],
    "examples": results,
    "note": "These are hand-written functional smoke examples, not an accuracy dataset. Official scores use all 12,284 separate test samples.",
}
Path("/reports/checks.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
