import numpy as np
from sklearn.metrics import f1_score, precision_recall_fscore_support, accuracy_score
from .config import LABELS


def calculate_metrics(targets, scores):
    y = np.asarray(targets, dtype=int)
    p = np.asarray(scores, dtype=float) > 0.5
    if y.shape != p.shape or y.ndim != 2 or y.shape[1] != 28 or not len(y):
        raise ValueError("Expected matching nonempty N x 28 arrays")
    precision, recall, f1, support = precision_recall_fscore_support(
        y, p, average=None, zero_division=0
    )
    return {
        "sample_count": len(y),
        "threshold": 0.5,
        "comparison": ">",
        "micro_f1": float(f1_score(y, p, average="micro", zero_division=0)),
        "macro_f1": float(f1_score(y, p, average="macro", zero_division=0)),
        "exact_match_accuracy": float(accuracy_score(y, p)),
        "exact_match_definition": "All 28 binary labels must match for a sample to count as correct.",
        "per_label": [
            {
                "label": label,
                "precision": float(precision[i]),
                "recall": float(recall[i]),
                "f1": float(f1[i]),
                "support": int(support[i]),
            }
            for i, label in enumerate(LABELS)
        ],
    }


def distribution(values):
    return {
        "count": len(values),
        "p50": float(np.percentile(values, 50)),
        "p95": float(np.percentile(values, 95)),
        "mean": float(np.mean(values)),
        "max": float(np.max(values)),
    }
