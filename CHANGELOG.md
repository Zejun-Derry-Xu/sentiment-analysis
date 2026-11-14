# Campus Forum changelog

## 2026-11-14 — Accounts, monitoring, and automatic topic summaries

Application revision deployed to Jetstream2: [`295357f`](https://github.com/Zejun-Derry-Xu/sentiment-analysis/commit/295357f7c3415e6b9724d2b9f3d26941ccad9496).

### Fixes from peer testing

- Reject posts made entirely of whitespace or invisible format characters before they reach the analysis queues. The sentiment card now warns when it reaches the 512-token limit. [#3](https://github.com/Zejun-Derry-Xu/sentiment-analysis/issues/3)
- Give each topic a shareable URL and restore it after a refresh or sign-in. Save drafts by account and topic, and ask before replacing a draft with an example prompt. [#2](https://github.com/Zejun-Derry-Xu/sentiment-analysis/issues/2) · [#4](https://github.com/Zejun-Derry-Xu/sentiment-analysis/issues/4)
- Add overall and per-topic dashboard statistics with date filters. Topic cards compare negative, neutral, and positive counts in an emoji bar chart. The evaluation page explains that GoEmotions and TweetEval scores come from labeled test sets. [#1](https://github.com/Zejun-Derry-Xu/sentiment-analysis/issues/1) · [#3](https://github.com/Zejun-Derry-Xu/sentiment-analysis/issues/3) · [#5](https://github.com/Zejun-Derry-Xu/sentiment-analysis/issues/5)

### Accounts and permissions

- Add registration and password sign-in for unique usernames. Account owners can recover their post history from another browser. Passwords are stored as salted scrypt hashes.
- Enforce administrator permissions on the server for topic creation, moderation, and performance controls. Preserve existing anonymous posts and analyses while ending the old anonymous sessions. [#2](https://github.com/Zejun-Derry-Xu/sentiment-analysis/issues/2) · [#5](https://github.com/Zejun-Derry-Xu/sentiment-analysis/issues/5)

### Logs, traces, and performance

- **Post Classifiers** runs 100 synthetic posts through the normal database and both inference queues. It shows throughput, errors, ranked p50/p95/p99 charts, separate queue and inference tables for each classifier, and request-level events and traces. Clearing the run removes its test data.
- **LLM Summary** has its own eight-request load test, recent cache and failure counts, and a chart with queue, model load, prompt processing, and generation timings. Its results can be cleared independently.

### Automatic discussion summaries

- Opening a topic automatically produces up to three short bullets with emoji using Qwen3.5 4B through Ollama. The database stores a shared summary and reuses it until the topic’s posts change. Larger topics show the number of recent posts covered by the summary.

### Jetstream2 validation

- The deployed VM has 16 AMD EPYC Milan vCPUs and 58 GiB RAM. Qwen3.5 4B used six inference threads in a six-vCPU container. Ollama reported 100% CPU. Sampled container memory during testing was about 3.9 GiB.
- The first completed summary of 10 posts took 18.4 seconds after thread tuning. A repeat request from another account used the cache and returned in about 117 ms over HTTPS.
- All eight LLM test samples completed. Including queue time, p50 was 9.99 seconds and p95/p99 were both 15.00 seconds. With eight samples, both tail percentiles select the slowest request. The test bypassed the application summary cache, while Ollama could reuse model and prompt state.
- All 100 classifier test posts completed with an end-to-end p95 of 4.23 seconds. Deployment preserved 717 existing posts, both sets of analysis records, and the evaluation run. The test posts were cleared after verification.
