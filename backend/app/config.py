import os
from pathlib import Path

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://campus:campus@localhost:5432/campus"
)
ASSET_DIR = Path(os.getenv("ASSET_DIR", "/assets"))
REPORT_DIR = Path(os.getenv("REPORT_DIR", "/reports"))
MODEL_REPO = "SamLowe/roberta-base-go_emotions-onnx"
MODEL_REV = "90ee0c1c4796d370e68968687b8ba51fc11224f4"
ORIGINAL_REV = "d75048347613a25d77de8cf6412eaae9fa7b26be"
DATA_REPO = "google-research-datasets/go_emotions"
DATA_REV = "add492243ff905527e67aeb8b80c082af02207c3"
MODEL_SHA = "0c1981c5b479674747911c8e2228f0c4ec90bf47bf66e830f7d4fc62be082958"
DATA_SHA = "fd0953e535ba2569edc6a1daaa1133f8e4b9071691d540c9bab812fda132bc26"
THRESHOLD = 0.5
LABELS = [
    "admiration",
    "amusement",
    "anger",
    "annoyance",
    "approval",
    "caring",
    "confusion",
    "curiosity",
    "desire",
    "disappointment",
    "disapproval",
    "disgust",
    "embarrassment",
    "excitement",
    "fear",
    "gratitude",
    "grief",
    "joy",
    "love",
    "nervousness",
    "optimism",
    "pride",
    "realization",
    "relief",
    "remorse",
    "sadness",
    "surprise",
    "neutral",
]
