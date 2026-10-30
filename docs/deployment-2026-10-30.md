# Resumed VM deployment — 2026-10-30

Live URL: **http://149.165.155.184/**. The same sentiment-analysis instance was unshelved with a new public address; the old 149.165.172.181 address is no longer the application endpoint.

Deployed application version: `7dc464f` (includes recorded sentiment results and animated emotion stickers). Existing 16-vCPU cloud profile and fixed model revisions are unchanged.

- Confirmed instance identity through its existing Exosphere page and connected to the new IP using existing credentials; no public key or access permissions were added.
- Backed up PostgreSQL outside Git at `/home/exouser/sentiment-analysis-backups/before-evaluation-emoji.dump`.
- Updated private request-origin settings to the actual new public address; `.env` and credentials are not committed.
- Rebuilt/restarted only this Compose project and passed **16 tests** against a separate test database.
- Compared pre/post original post associations and text, all completed emotion/sentiment rows, human reviews and retained inactive legacy data. All original hashes matched; see [preservation evidence](results/deployment-2026-10-30/preservation.json).
- Public browser verification: sign in, load Evaluation and its three-class report, publish an English Halloween post, receive both real model outputs, display its automatic emoji, and long-press the post to open its predicted-emotion tray.
- Sentiment scores remain the saved 12,284-sample local evaluation (Apple M5), explicitly separated from cloud serving and live comments. No new classification score, training, threshold tuning, or performance claim was introduced.

After future shelve/unshelve operations, check the instance's actual IP and update request origins and the published URL before verification. Do not reuse a former address without checking instance identity.
