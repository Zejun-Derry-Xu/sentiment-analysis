import hashlib
import json
import os
import urllib.request
from pathlib import Path
from .config import (
    ASSET_DIR,
    MODEL_REPO,
    MODEL_REV,
    ORIGINAL_REV,
    DATA_REPO,
    DATA_REV,
    MODEL_SHA,
    DATA_SHA,
    LABELS,
)


def download(url: str, destination: Path, expected: str | None = None):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        digest = hashlib.sha256(destination.read_bytes()).hexdigest()
        if expected is None or digest == expected:
            return {"url": url, "sha256": digest, "bytes": destination.stat().st_size}
        raise RuntimeError(f"Cached asset checksum mismatch: {destination.name}")
    temporary = destination.with_suffix(destination.suffix + f".{os.getpid()}.part")
    try:
        with (
            urllib.request.urlopen(url, timeout=180) as response,
            temporary.open("wb") as out,
        ):
            while chunk := response.read(1024 * 1024):
                out.write(chunk)
        digest = hashlib.sha256(temporary.read_bytes()).hexdigest()
        if expected and digest != expected:
            raise RuntimeError(f"Downloaded checksum mismatch: {destination.name}")
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return {"url": url, "sha256": digest, "bytes": destination.stat().st_size}


def prepare_model():
    manifest = {
        "model_revision": MODEL_REV,
        "model_license": "MIT",
        "original_revision": ORIGINAL_REV,
        "files": {},
    }
    for name in (
        "onnx/model_quantized.onnx",
        "config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "README.md",
    ):
        url = f"https://huggingface.co/{MODEL_REPO}/resolve/{MODEL_REV}/{name}"
        manifest["files"][name] = download(
            url, ASSET_DIR / name, MODEL_SHA if name.endswith(".onnx") else None
        )
    license_url = f"https://huggingface.co/SamLowe/roberta-base-go_emotions/resolve/{ORIGINAL_REV}/LICENSE"
    manifest["files"]["LICENSE.model"] = download(
        license_url, ASSET_DIR / "LICENSE.model"
    )
    config = json.loads((ASSET_DIR / "config.json").read_text())
    if [config["id2label"][str(i)] for i in range(28)] != LABELS:
        raise RuntimeError("Model label mapping mismatch")
    (ASSET_DIR / "model-manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest


def load_test():
    import pyarrow.parquet as pq

    url = f"https://huggingface.co/datasets/{DATA_REPO}/resolve/{DATA_REV}/simplified/test-00000-of-00001.parquet"
    path = ASSET_DIR / "go-emotions-test.parquet"
    entry = download(url, path, DATA_SHA)
    table = pq.read_table(path)
    info = json.loads(table.schema.metadata[b"huggingface"])
    labels = info["info"]["features"]["labels"]["feature"]["names"]
    if len(table) != 5427 or labels != LABELS:
        raise RuntimeError("Official test split size or label mapping mismatch")
    card = f"https://huggingface.co/datasets/{DATA_REPO}/resolve/{DATA_REV}/README.md"
    download(card, ASSET_DIR / "DATASET_CARD.md")
    manifest = {
        "dataset": DATA_REPO,
        "revision": DATA_REV,
        "config": "simplified",
        "split": "test",
        "rows": len(table),
        "license": "Apache-2.0",
        "labels": labels,
        "file": entry,
    }
    (ASSET_DIR / "dataset-manifest.json").write_text(json.dumps(manifest, indent=2))
    return table.to_pylist(), manifest
