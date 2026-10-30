import os
import platform
import time
import importlib.metadata
from pathlib import Path
import numpy as np
import onnxruntime as ort
import psutil
from tokenizers import Tokenizer
from .assets import prepare_model
from .config import ASSET_DIR, LABELS, MODEL_REV, THRESHOLD


def score_logits(logits):
    a = np.asarray(logits, dtype=np.float64)
    if a.shape != (28,) or not np.all(np.isfinite(a)):
        raise ValueError("Expected 28 finite logits")
    scores = np.exp(-np.logaddexp(0, -a))
    top = int(np.argmax(scores))
    return {
        "scores": {label: float(scores[i]) for i, label in enumerate(LABELS)},
        "labels": [label for i, label in enumerate(LABELS) if scores[i] > THRESHOLD],
        "top_label": LABELS[top],
        "top_score": float(scores[top]),
    }


def load_tokenizers(path):
    tokenizer = Tokenizer.from_file(str(path))
    # Published tokenizer.json has fixed padding AND truncation at 128.
    # Match the author/HF single-example path: dynamic padding, explicit 512 cap.
    params = tokenizer.padding or {"pad_id": 1, "pad_token": "<pad>"}
    tokenizer.enable_padding(**{**params, "length": None})
    tokenizer.enable_truncation(max_length=512)
    unbounded = Tokenizer.from_file(str(path))
    unbounded.no_padding()
    unbounded.no_truncation()
    return tokenizer, unbounded


class Engine:
    def __init__(self):
        started = time.perf_counter()
        self.manifest = prepare_model()
        download_ms = (time.perf_counter() - started) * 1000
        started = time.perf_counter()
        self.tokenizer, self.unbounded_tokenizer = load_tokenizers(
            ASSET_DIR / "tokenizer.json"
        )
        options = ort.SessionOptions()
        options.intra_op_num_threads = int(os.getenv("ORT_INTRA_THREADS", "2"))
        options.inter_op_num_threads = int(os.getenv("ORT_INTER_THREADS", "1"))
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        self.session = ort.InferenceSession(
            str(ASSET_DIR / "onnx/model_quantized.onnx"),
            sess_options=options,
            providers=["CPUExecutionProvider"],
        )
        if [x.name for x in self.session.get_inputs()] != [
            "input_ids",
            "attention_mask",
        ] or self.session.get_outputs()[0].name != "logits":
            raise RuntimeError("Unexpected ONNX interface")
        load_ms = (time.perf_counter() - started) * 1000
        self.process = psutil.Process()
        self.metadata = {
            "model_revision": MODEL_REV,
            "provider": self.session.get_providers(),
            "batch_size": 1,
            "intra_threads": options.intra_op_num_threads,
            "inter_threads": options.inter_op_num_threads,
            "asset_preparation_ms": download_ms,
            "model_load_ms": load_ms,
            "platform": platform.platform(),
            "architecture": platform.machine(),
            "cpu_count": os.cpu_count(),
            "cpu_model": platform.processor(),
            "memory_total_mb": psutil.virtual_memory().total / 1024**2,
            "packages": {
                p: importlib.metadata.version(p)
                for p in ("onnxruntime", "tokenizers", "numpy", "scikit-learn")
            },
            "cpu_limit": read_system("/sys/fs/cgroup/cpu.max"),
            "memory_limit": read_system("/sys/fs/cgroup/memory.max"),
            "manifest": self.manifest,
        }
        self.metadata["first_inference_ms"] = self.predict(
            "The campus concert was wonderful."
        )["inference_ms"]
        for _ in range(19):
            self.predict("The campus concert was wonderful.")
        self.metadata["warmup_count"] = 20

    def predict(self, text):
        started = time.perf_counter()
        cpu_before = sum(self.process.cpu_times()[:2])
        encoded = self.tokenizer.encode(text)
        count = len(self.unbounded_tokenizer.encode(text).ids)
        ids = encoded.ids
        logits = self.session.run(
            ["logits"],
            {
                "input_ids": np.asarray([ids], dtype=np.int64),
                "attention_mask": np.asarray([encoded.attention_mask], dtype=np.int64),
            },
        )[0][0]
        result = score_logits(logits)
        elapsed = time.perf_counter() - started
        result.update(
            {
                "inference_ms": elapsed * 1000,
                "token_count": len(ids),
                "original_token_count": count,
                "truncated": count > 512,
                "rss_mb": self.process.memory_info().rss / 1024**2,
                "cpu_percent": (sum(self.process.cpu_times()[:2]) - cpu_before)
                / elapsed
                * 100,
            }
        )
        return result


def read_system(path):
    try:
        return Path(path).read_text().strip()
    except OSError:
        return None
