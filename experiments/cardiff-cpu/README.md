# Cardiff 三分类 CPU 独立试验

本目录在原 Campus Notes 之外提供一个可重复的英文 sentiment CPU 试验。旧平台仍为 `http://localhost:5180`；新试验台默认 `http://localhost:5181`。没有修改原有 28 类模型、数据库、评测或评论流程。

## 启动与交互

需要 Docker / Compose 与用于生成本机硬件标签的 Python 3。

```sh
# 从项目根目录执行，首次下载约 501 MB 的作者原始权重
sh experiments/cardiff-cpu/start.sh
# 浏览器打开 http://localhost:5181
```

新项目名为 `dml-cardiff-cpu-bench`，有独立的模型缓存和报告卷。只发布本机 5181 端口；`.env` 自动生成，不提交 Git。首次启动下载和检查固定权重，之后只从本地目录加载。旧模型进程仍可并行运行。

使用 [cardiffnlp/twitter-roberta-base-sentiment-latest](https://huggingface.co/cardiffnlp/twitter-roberta-base-sentiment-latest)，固定 revision `3216a57f2a0d9c45a2e6c20157c20c49fb4bf9c7`。直接加载作者 FP32 PyTorch 权重，SHA-256 `4d24a3e32a88ed1c4e5b789fc6644e2e767500554e954b27dccf52a8e762cbae`。不训练、不微调、不自行量化或转换格式。

模型在 CPU 上运行，显式禁止自动设备选择。仅一个常驻模型进程，PyTorch CPU-only 2.7.1，intra-op 2 / inter-op 1，容器限制 2 CPU / 4 GB RAM。依赖锁支持 Linux ARM64 和 Linux x86_64 的官方 CPU wheels，不安装 CUDA 包。

遵循作者用户名/链接预处理（`@someone → @user`，`http... → http`），单条动态长度输入，最大 512 tokens。输出 logits 只经过一次 softmax，再 argmax 得到互斥标签 `negative / neutral / positive`。这些是模型得分，不是校准后的心理测量。

作者权重带有分类路径不用的两个 `roberta.pooler` 参数。加载时检查分类模型没有 missing/mismatched keys，只允许这两个额外 pooler keys，防止漏载分类头后使用随机参数。

## 完整实测

```sh
# 全部官方分类测试 + 性能测试
sh experiments/cardiff-cpu/bench.sh all
# 只跑分类：默认全部 12,284 条
sh experiments/cardiff-cpu/bench.sh evaluate
# 部分样本仅用于运行冒烟检查，报告会标明非官方完整测试
sh experiments/cardiff-cpu/bench.sh evaluate --limit 8
# 只跑性能：默认 100 条，20 次额外预热，并发 1 / 4
sh experiments/cardiff-cpu/bench.sh benchmark
# 仅测试一条，不加入任何分类成绩
sh experiments/cardiff-cpu/bench.sh predict --text 'The event was great!'
```

分类测试使用 [cardiffnlp/tweet_eval](https://huggingface.co/datasets/cardiffnlp/tweet_eval) 的 `sentiment/test`，固定 revision `b3a375baf0f409c77e6bc7aa35102b7b3534f8be`，实际 12,284 条。文件 SHA-256 `f73aea52d43879223019e733b944780f7e9203ee32459ea006f554011379fcdf`；加载时检查真实行数和标签映射。保留全部样本，不做阈值搜索或样本挑选。

输出 Accuracy、Micro-F1、Macro-F1、全部三类 Precision/Recall/F1/support、混淆矩阵，以及 TweetEval sentiment 官方使用的 **Macro-Recall**。排行榜的 sentiment 分数不能直接叫准确率。当前使用的是 `sentiment-latest` 的本机重新推理，不是重复计分仓库自带的旧版模型预测。

性能测试按固定 test 原顺序前 100 条进行：

- 单例 batch 1，额外预热 20 次；记录分词、推理、softmax/argmax 合计延迟 p50/p95 和吞吐量。
- HTTP 并发 1、4，各 100 条。单模型串行锁，记录锁等待、handler 完成时间、真实 HTTP 往返时间和完成吞吐量。
- API 测量仅包含这个独立推理服务；**不包含原平台评论保存、数据库和后台任务队列**，不可直接与旧平台端到端指标混为同一测试。
- CPU 是进程 CPU 时间 / 墙钟时间，100% 表示一个核；RSS 是每次预测后采样，不代表系统瞬时峰值。
- 冷启动分别记录权重准备/校验、模型加载（含 torch/transformers 导入）、预热前首次推理，以及模块入口到 20 次预热完成。下载时间与缓存加载分开。
- 报告包含硬件标签、Linux 架构、容器 CPU/内存限制、包版本、线程数、文本/token 长度分布和模型 revision。

完整评测和直接性能阶段独占模型，交互请求会返回“稍后再试”，避免混入其他流量。HTTP 并发阶段请不要同时操作试验台，以免污染结果。原平台可继续使用。

## 报告和复核

报告存在本项目独立 reports 命名卷：

- `/reports/latest-evaluation.json`：最新分类报告。
- `/reports/evaluations/<run-id>/report.json` 与 `predictions.jsonl`：对应运行和逐条得分；预测文件保留原始行号、文本 SHA-256、真实标签和预测，不重新发布原始推文文本。
- `/reports/latest-benchmark.json`：直接推理和 HTTP 性能。
- `/reports/runtime.json`：固定运行配置。

```sh
cd experiments/cardiff-cpu
# 功能检查，完整评测结束后执行
docker compose --env-file .env --profile tools run --rm client python check.py
# 用保存的预测独立重算并断言与原报告完全一致
docker compose --env-file .env --profile tools run --rm client python rescore.py /reports/evaluations/RUN_ID/predictions.jsonl
# 导出报告；本地 reports 目录已忽略提交
mkdir -p reports
docker compose --env-file .env cp inference:/reports/. ./reports/
```

本地实测汇总见 [验证记录](../../docs/cardiff-cpu-validation.md)，完整快照保存在 `docs/results/cardiff-cpu-local/`。它们是 Mac 上 Docker Linux/ARM64 的结果，**不是 Jetstream2 实测**。

## 许可与后续部署

模型卡声明 CC BY 4.0，保留模型来源和归属。TweetEval 总数据卡标注 `unknown`，原仓库要求遵循子任务及原始数据来源条款。因此本次用于独立本地学术评测，不在仓库中捆绑原始测试推文；正式替换项目默认模型或分发数据前仍须完成原始 sentiment 子任务条款核查。现有 MIT / Apache-2.0 的旧方案保持原样。

新 Jetstream2 CPU 实例准备好后，克隆同一仓库、执行相同 start/bench 命令。不要复制本机 `.env`，让脚本在新机器生成硬件标签；默认经 SSH 隧道访问试验台。先检查实际资源、端口与运行服务，再与旧分类器并行部署。没有 GPU 需求。
