from pathlib import Path
import hashlib
import json
import os
import urllib.request

MODEL = "cardiffnlp/twitter-roberta-base-sentiment-latest"
REVISION = "3216a57f2a0d9c45a2e6c20157c20c49fb4bf9c7"
WEIGHT_SHA = "4d24a3e32a88ed1c4e5b789fc6644e2e767500554e954b27dccf52a8e762cbae"
DATA_REVISION = "b3a375baf0f409c77e6bc7aa35102b7b3534f8be"
DATA_SHA = "f73aea52d43879223019e733b944780f7e9203ee32459ea006f554011379fcdf"
LABELS = ["negative", "neutral", "positive"]
ASSETS = Path("/assets")
REPORTS = Path("/reports")


def checksum(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url, path, expected=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        tmp = path.with_suffix(path.suffix + f".{os.getpid()}.part")
        try:
            print(f"Downloading {path.name}", flush=True)
            with (
                urllib.request.urlopen(url, timeout=180) as response,
                tmp.open("wb") as output,
            ):
                while chunk := response.read(1024 * 1024):
                    output.write(chunk)
            digest = checksum(tmp)
            if expected and digest != expected:
                raise RuntimeError("Checksum mismatch: " + path.name)
            tmp.replace(path)
        finally:
            tmp.unlink(missing_ok=True)
    digest = checksum(path)
    if expected and digest != expected:
        raise RuntimeError("Cached checksum mismatch: " + path.name)
    return {"url": url, "bytes": path.stat().st_size, "sha256": digest}


def model_assets():
    files = {}
    for name in (
        "config.json",
        "merges.txt",
        "vocab.json",
        "special_tokens_map.json",
        "README.md",
        "pytorch_model.bin",
    ):
        files[name] = download(
            f"https://huggingface.co/{MODEL}/resolve/{REVISION}/{name}",
            ASSETS / "model" / name,
            WEIGHT_SHA if name.endswith(".bin") else None,
        )
    manifest = {
        "repository": MODEL,
        "revision": REVISION,
        "license": "CC-BY-4.0 as declared in model card",
        "weights": "Author-published float32 PyTorch; no training, conversion or quantization",
        "files": files,
    }
    (ASSETS / "model-manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest


def dataset():
    import pyarrow.parquet as pq

    path = ASSETS / "sentiment-test.parquet"
    entry = download(
        f"https://huggingface.co/datasets/cardiffnlp/tweet_eval/resolve/{DATA_REVISION}/sentiment/test-00000-of-00001.parquet",
        path,
        DATA_SHA,
    )
    table = pq.read_table(path)
    features = json.loads(table.schema.metadata[b"huggingface"])["info"]["features"]
    assert len(table) == 12284 and features["label"]["names"] == LABELS, (
        "Unexpected test split or label mapping"
    )
    manifest = {
        "repository": "cardiffnlp/tweet_eval",
        "revision": DATA_REVISION,
        "configuration": "sentiment",
        "split": "test",
        "rows": 12284,
        "labels": LABELS,
        "file": entry,
        "license_status": "HF aggregate dataset card says unknown; original task terms require separate verification. Raw test text is not bundled in the repository or exported prediction report.",
    }
    (ASSETS / "dataset-manifest.json").write_text(json.dumps(manifest, indent=2))
    return table.to_pylist(), manifest


def preprocess(text):
    # Exact preprocessing used by the model author: space split, user/link placeholders.
    words = []
    for token in text.split(" "):
        token = "@user" if token.startswith("@") and len(token) > 1 else token
        token = "http" if token.startswith("http") else token
        words.append(token)
    return " ".join(words)


def distribution(values):
    import numpy as np

    return {
        "n": len(values),
        "p50": float(np.percentile(values, 50)),
        "p95": float(np.percentile(values, 95)),
        "mean": float(np.mean(values)),
        "max": float(np.max(values)),
    }


def read_system(path):
    try:
        return Path(path).read_text().strip()
    except OSError:
        return None
