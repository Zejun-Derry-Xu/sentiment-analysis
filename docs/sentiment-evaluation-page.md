# Sentiment results in Evaluation

The English Evaluation page now displays the recorded three-class sentiment report above the existing emotion evaluation. The model reports remain separate because the tasks and official test datasets differ.

- Accuracy: **72.18%**; macro-F1: **72.40%**; macro-recall: **73.49%** (TweetEval sentiment official metric).
- All **12,284** samples and all three classes are retained, including per-class precision, recall, F1, support, and a labeled confusion matrix.
- Recorded environment: **Apple M5 / Docker Linux ARM64, CPU FP32, batch 1, threads 2/1**. The page explicitly identifies this as the saved local evaluation, separate from current serving hardware and live forum distributions.
- Expanding reproducibility shows model/data revisions and evaluation run ID. JSON download preserves the original complete report; the saved prediction link points to the original versioned repository artifact.
- No training, inference rerun, model change, threshold change, database migration, or live-post accuracy calculation was performed for this presentation change.

The API image bundles an immutable report at `backend/app/data/sentiment-evaluation.json`. It is byte-for-byte identical to `docs/results/cardiff-cpu-local/evaluation.json`; SHA-256 `658051fc0447cc4bdf48074cae042139798c2be80cbd29429a35a131fc3f4fab`. The report is not replaced with a score inferred from current comments.

Endpoints:

- `GET /api/sentiment/evaluation`: complete recorded JSON.
- `GET /api/sentiment/evaluation/download`: downloadable JSON attachment.

Local validation: React/TypeScript build passed, **16 tests passed**, API report/download provenance checked, and browser inspection confirmed all summary metrics, class rows, confusion matrix, and reproducibility details. Existing emotion results remain available below the new section.

Deployment status for this change: **local only**, per the user's instruction while the Jetstream2 instance is powered off. Publish the completed update together after the instance is available and its current identity/address is verified.
