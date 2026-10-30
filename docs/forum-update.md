# English forum update

Implementation: `1c6a291`. Applied locally and on the existing Jetstream2 instance without replacing the database or fixed model weights.

## Product changes

- Retired favorites navigation, view, post actions, API endpoint, query filter, and response/statistics fields. The inactive historical database table is preserved rather than deleting existing records.
- Moved the dashboard entry to **Switch to Admin**, immediately before the avatar/display name in the top-right user area. **Switch to Student** returns to discussion. Handling and human-review controls appear in admin mode. This remains the previously agreed public demo access model, not a protected administrator login.
- Replaced the three board titles/content with **Halloween Haunted House**, **Campus Food**, and **DSAN Feedback**. Board IDs remain compatible; old posts and their original analyses/reviews are retained.
- Converted application text, accessibility labels, dates, validation/error messages, board descriptions, evaluation/history/review pages, metadata, and the optional standalone trial to English. User-authored historical content is not translated or modified.
- Updated board-specific posting prompts and optional demo posts. Demo seeding now idempotently queues both real models.

## Validation

- **15 local and 15 cloud tests passed**, using dedicated test databases.
- Regression coverage includes retired favorite endpoints/fields, migration 3 preserving existing post text and both model outputs, and idempotent dual-model demo seeding.
- Built the React/TypeScript application and audited product UI/server/board sources for remaining CJK copy.
- Published an English Halloween post locally and a DSAN Feedback post through the public cloud interface; both resident CPU models completed and returned independent results.
- Verified the admin switch's rendered position is before the display name, the favorites navigation is absent, and the rendered dashboard is English. Checked student/admin controls and dashboard distributions.
- Restored the pre-update database backup into an isolated temporary test database and compared original post associations/text, all completed emotion/sentiment output records, reviews, and inactive favorite records. All original hashes matched the updated production database. The temporary verification database was removed afterward; the private backup remains outside the checkout.

Raw checks: [UI and functionality](results/forum-update/checks.json), [data preservation](results/forum-update/preservation.json).

## Demonstration

Open http://149.165.172.181/, enter a display name, select a forum board, publish an English post, inspect both results, then click **Switch to Admin** beside your name to review distributions, filter, handle posts, and append a separate human emotion review. Use **Switch to Student** to return.
