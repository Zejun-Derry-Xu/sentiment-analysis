import importlib.metadata
import json
import os
import platform
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, field_validator
import psutil
from shared import (
    MODEL,
    REVISION,
    LABELS,
    ASSETS,
    REPORTS,
    model_assets,
    preprocess,
    read_system,
)

BOOT_START = time.perf_counter()
engine = None
lock = threading.Lock()
experiment_active = False


class Engine:
    def __init__(self):
        start = time.perf_counter()
        manifest = model_assets()
        preparation_ms = (time.perf_counter() - start) * 1000
        start = time.perf_counter()
        import torch
        from transformers import AutoTokenizer, AutoModelForSequenceClassification

        torch.set_num_threads(int(os.getenv("TORCH_THREADS", "2")))
        torch.set_num_interop_threads(int(os.getenv("TORCH_INTER_THREADS", "1")))
        self.torch = torch
        self.process = psutil.Process()
        self.tokenizer = AutoTokenizer.from_pretrained(
            str(ASSETS / "model"), local_files_only=True, trust_remote_code=False
        )
        self.model, loading_info = AutoModelForSequenceClassification.from_pretrained(
            str(ASSETS / "model"),
            local_files_only=True,
            trust_remote_code=False,
            use_safetensors=False,
            weights_only=True,
            torch_dtype=torch.float32,
            output_loading_info=True,
        )
        assert (
            not loading_info.get("missing_keys")
            and not loading_info.get("mismatched_keys")
            and not loading_info.get("error_msgs")
        ), str(loading_info)
        assert set(loading_info.get("unexpected_keys", [])) <= {
            "roberta.pooler.dense.bias",
            "roberta.pooler.dense.weight",
        }, str(loading_info)
        self.model = self.model.to("cpu").eval()
        mapping = [self.model.config.id2label[i].lower() for i in range(3)]
        assert mapping == LABELS and all(
            p.device.type == "cpu" for p in self.model.parameters()
        )
        load_ms = (time.perf_counter() - start) * 1000
        self.metadata = {
            "model": MODEL,
            "revision": REVISION,
            "runtime_id": str(uuid4()),
            "device": "cpu",
            "precision": "float32",
            "batch_size": 1,
            "threads": torch.get_num_threads(),
            "interop_threads": torch.get_num_interop_threads(),
            "model_load_ms": load_ms,
            "asset_preparation_ms": preparation_ms,
            "platform": platform.platform(),
            "architecture": platform.machine(),
            "cpu_count": os.cpu_count(),
            "cpu_description": platform.processor() or platform.machine(),
            "host_label": os.getenv("HOST_LABEL", "unspecified-host"),
            "cpu_limit": read_system("/sys/fs/cgroup/cpu.max"),
            "memory_limit": read_system("/sys/fs/cgroup/memory.max"),
            "loading_info": loading_info,
            "parameter_count": sum(p.numel() for p in self.model.parameters()),
            "cuda_available": torch.cuda.is_available(),
            "packages": {
                p: importlib.metadata.version(p)
                for p in ("torch", "transformers", "tokenizers", "numpy")
            },
            "manifest": manifest,
        }
        first = self.predict("The campus concert was wonderful.")
        self.metadata["first_inference_ms"] = first["inference_ms"]
        for _ in range(19):
            self.predict("The campus concert was wonderful.")
        self.metadata["startup_warmup_count"] = 20
        self.metadata["module_entry_to_ready_ms"] = (
            time.perf_counter() - BOOT_START
        ) * 1000
        self.metadata["cold_start_definition"] = (
            "Model load includes torch/transformers imports, tokenizer and weights; first inference is before warmup. Module-entry-to-ready includes asset preparation and 20 warmups, but not preceding module imports/container creation."
        )
        (REPORTS / "runtime.json").write_text(json.dumps(self.metadata, indent=2))

    def predict(self, text):
        start = time.perf_counter()
        cpu0 = sum(self.process.cpu_times()[:2])
        text = preprocess(text)
        inputs = self.tokenizer(
            text, return_tensors="pt", truncation=True, max_length=512, padding=False
        )
        with self.torch.inference_mode():
            logits = self.model(**inputs).logits
            scores = self.torch.softmax(logits, dim=-1)[0].tolist()
        index = max(range(3), key=lambda i: scores[i])
        elapsed = time.perf_counter() - start
        return {
            "label": LABELS[index],
            "scores": dict(zip(LABELS, scores)),
            "inference_ms": elapsed * 1000,
            "token_count": int(inputs["attention_mask"].sum()),
            "input_characters": len(text),
            "rss_mb": self.process.memory_info().rss / 1024**2,
            "cpu_percent": (sum(self.process.cpu_times()[:2]) - cpu0) / elapsed * 100,
        }


@asynccontextmanager
async def lifespan(app):
    global engine
    engine = Engine()
    print(
        "CPU_MODEL_READY "
        + json.dumps(
            {
                k: engine.metadata[k]
                for k in (
                    "model",
                    "revision",
                    "device",
                    "precision",
                    "model_load_ms",
                    "first_inference_ms",
                    "module_entry_to_ready_ms",
                )
            }
        ),
        flush=True,
    )
    yield


app = FastAPI(
    title="Cardiff CPU Trial", lifespan=lifespan, docs_url=None, redoc_url=None
)


class Text(BaseModel):
    text: str = Field(min_length=1, max_length=2000)

    @field_validator("text")
    @classmethod
    def nonempty(cls, v):
        if not v.strip():
            raise ValueError("Enter an English post.")
        return v.strip()


@app.get("/", response_class=HTMLResponse)
def index():
    return Path("index.html").read_text()


@app.get("/health")
def health():
    return {"ready": engine is not None, "model": MODEL, "device": "cpu"}


@app.get("/metadata")
def metadata():
    return engine.metadata


@app.post("/predict")
def predict(body: Text):
    if experiment_active:
        raise HTTPException(409, "A fixed CPU benchmark is running. Please try again later.")
    entered = time.perf_counter()
    with lock:
        if experiment_active:
            raise HTTPException(409, "A fixed CPU benchmark is running. Please try again later.")
        queue_ms = (time.perf_counter() - entered) * 1000
        result = engine.predict(body.text)
    return {
        **result,
        "queue_ms": queue_ms,
        "handler_completion_ms": (time.perf_counter() - entered) * 1000,
        "runtime_id": engine.metadata["runtime_id"],
    }


class Evaluate(BaseModel):
    limit: int = Field(default=12284, ge=1, le=12284)


@app.post("/evaluate")
def evaluate(body: Evaluate):
    global experiment_active
    from shared import dataset, distribution
    import numpy as np
    from sklearn.metrics import (
        accuracy_score,
        f1_score,
        recall_score,
        classification_report,
        confusion_matrix,
    )

    if not lock.acquire(blocking=False):
        raise HTTPException(409, "Inference busy")
    experiment_active = True
    try:
        rows, manifest = dataset()
        rows = rows[: body.limit]
        run_id = str(uuid4())
        folder = REPORTS / "evaluations" / run_id
        folder.mkdir(parents=True)
        y = []
        pred = []
        timings = []
        token_lengths = []
        start = time.perf_counter()
        with (folder / "predictions.jsonl.part").open("w") as out:
            for i, row in enumerate(rows):
                result = engine.predict(row["text"])
                y.append(row["label"])
                pred.append(LABELS.index(result["label"]))
                timings.append(result["inference_ms"])
                token_lengths.append(result["token_count"])
                import hashlib

                out.write(
                    json.dumps(
                        {
                            "row_index": i,
                            "text_sha256": hashlib.sha256(
                                row["text"].encode()
                            ).hexdigest(),
                            "true_label": LABELS[row["label"]],
                            **result,
                        }
                    )
                    + "\n"
                )
                if (i + 1) % 500 == 0:
                    print(
                        f"EVALUATION_PROGRESS {run_id} {i + 1}/{len(rows)}", flush=True
                    )
                    (folder / "progress.json").write_text(
                        json.dumps({"processed": i + 1, "total": len(rows)})
                    )
        metrics = {
            "samples": len(rows),
            "official_full_test": body.limit == 12284,
            "accuracy": float(accuracy_score(y, pred)),
            "micro_f1": float(f1_score(y, pred, average="micro")),
            "macro_f1": float(f1_score(y, pred, average="macro")),
            "macro_recall": float(recall_score(y, pred, average="macro")),
            "tweeteval_official_metric": "macro_recall",
            "classification_report": classification_report(
                y,
                pred,
                labels=[0, 1, 2],
                target_names=LABELS,
                output_dict=True,
                zero_division=0,
            ),
            "confusion_matrix": confusion_matrix(y, pred, labels=[0, 1, 2]).tolist(),
        }
        report = {
            "run_id": run_id,
            "runtime": engine.metadata,
            "dataset": manifest,
            "metrics": metrics,
            "evaluation_wall_seconds": time.perf_counter() - start,
            "inference_ms": distribution(timings),
            "text_characters": distribution([len(r["text"]) for r in rows]),
            "token_lengths": distribution(token_lengths),
            "protocol": "Entire fixed test split, original order, one forward pass per sample; author preprocessing; softmax argmax; no training/tuning or test selection.",
        }
        (folder / "predictions.jsonl.part").replace(folder / "predictions.jsonl")
        (folder / "report.json").write_text(json.dumps(report, indent=2))
        (REPORTS / "latest-evaluation.json").write_text(json.dumps(report, indent=2))
        return report
    finally:
        experiment_active = False
        lock.release()


class Benchmark(BaseModel):
    samples: int = Field(default=100, ge=1, le=100)


@app.post("/benchmark")
def benchmark(body: Benchmark):
    global experiment_active
    from shared import dataset, distribution

    if not lock.acquire(blocking=False):
        raise HTTPException(409, "Inference busy")
    experiment_active = True
    try:
        rows, manifest = dataset()
        rows = rows[: body.samples]
        for _ in range(20):
            engine.predict(rows[0]["text"])
        start = time.perf_counter()
        results = [engine.predict(r["text"]) for r in rows]
        elapsed = time.perf_counter() - start
        return {
            "runtime": engine.metadata,
            "dataset": manifest,
            "samples": len(rows),
            "warmup": 20,
            "batch_size": 1,
            "inference_ms": distribution([r["inference_ms"] for r in results]),
            "throughput_per_second": len(rows) / elapsed,
            "rss_mb": distribution([r["rss_mb"] for r in results]),
            "process_cpu_percent": distribution([r["cpu_percent"] for r in results]),
            "cpu_definition": "Process CPU time / wall time x100; 100% = one core. RSS sampled after every prediction, not true peak.",
            "text_characters": distribution([len(r["text"]) for r in rows]),
            "token_lengths": distribution([r["token_count"] for r in results]),
        }
    finally:
        experiment_active = False
        lock.release()


@app.get("/results")
def results():
    return {
        name: json.loads((REPORTS / name).read_text())
        if (REPORTS / name).exists()
        else None
        for name in ("latest-evaluation.json", "latest-benchmark.json")
    }
