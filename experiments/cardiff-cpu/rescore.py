import json
from pathlib import Path
import sys
import numpy as np
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    recall_score,
    classification_report,
)
from shared import LABELS

path = Path(sys.argv[1])
rows = [json.loads(x) for x in path.read_text().splitlines() if x.strip()]
assert rows and [r["row_index"] for r in rows] == list(range(len(rows)))
y = [LABELS.index(r["true_label"]) for r in rows]
p = []
for r in rows:
    assert set(r["scores"]) == set(LABELS)
    scores = np.array([r["scores"][l] for l in LABELS])
    assert (
        np.all(np.isfinite(scores))
        and np.all(scores >= 0)
        and abs(scores.sum() - 1) < 1e-5
    )
    prediction = int(np.argmax(scores))
    assert LABELS[prediction] == r["label"]
    p.append(prediction)
metrics = {
    "samples": len(rows),
    "accuracy": float(accuracy_score(y, p)),
    "micro_f1": float(f1_score(y, p, average="micro")),
    "macro_f1": float(f1_score(y, p, average="macro")),
    "macro_recall": float(recall_score(y, p, average="macro")),
    "classification_report": classification_report(
        y, p, labels=[0, 1, 2], target_names=LABELS, output_dict=True, zero_division=0
    ),
}
report = json.loads(path.with_name("report.json").read_text())
for name, value in metrics.items():
    assert report["metrics"][name] == value, name
print(json.dumps({"passed": True, "independent_rescore": metrics}, indent=2))
