# Cardiff 三分类本地 CPU 验证

本次为本地重新运行作者模型得到的结果，不是作者附带预测文件的重新计分，也不是 Jetstream2 实测。原 28 类平台继续运行在 5180，新试验台为 5181。没有训练、微调、阈值搜索或挑选测试样本。

## 分类结果

固定 TweetEval sentiment/test 全部 **12,284 条**，单标签三分类。

| 指标 | 本机结果 |
| --- | ---: |
| Accuracy | 72.18% |
| Micro-F1 | 72.18% |
| Macro-F1 | 72.40% |
| Macro-Recall（官方 sentiment 指标） | 73.49% |

单标签三分类中整组标签完全匹配等于 Accuracy。不能将这里的 Accuracy 与 GoEmotions 28 类多标签 exact-match / Micro-F1 直接作同任务比较。

| 类别 | Precision | Recall | F1 | Support |
| --- | ---: | ---: | ---: | ---: |
| negative | 68.95% | 80.66% | 74.35% | 3972 |
| neutral | 75.66% | 65.76% | 70.36% | 5937 |
| positive | 71.01% | 74.06% | 72.51% | 2375 |

neutral 的召回较低（65.76%）；其中 1,372 条真实中性被预测为负面。这说明它仍会将部分普通事实或含负面词的表达判为负面，不能自动据此处理用户。校园评论领域的实际可靠性仍需独立带标签数据检验。

## 本地性能

硬件标签：**Apple M5 / macOS Docker Desktop / local trial, not Jetstream2**；Docker Linux/aarch64，容器限制 2 CPU / 4 GiB。PyTorch 2.7.1+cpu、Transformers 4.53.3，CPU FP32，单模型进程，intra-op 2 / inter-op 1，batch size 1。旧平台保持启动，测试时无主动交互流量。

缓存权重加载（含 Torch/Transformers 导入与分词器）：**2.266 秒**；预热前首次推理 42.53 ms。模块入口至 20 次预热完成 3.078 秒，不含容器创建及此前模块导入。下载和哈希校验另计。

性能样本为官方 test 原顺序前 100 条，额外预热 20 次；文本长度 p50/p95 88/135.15 字符，token 长度 p50/p95 25/39.05，最大 68 tokens。

| 场景 | 延迟 p50 | 延迟 p95 | 吞吐量 |
| --- | ---: | ---: | ---: |
| 直接推理（含分词和后处理） | 62.04 ms | 136.31 ms | 13.72 条/s |
| HTTP 并发 1 | 78.37 ms | 117.93 ms | 12.50 条/s |
| HTTP 并发 4 | 229.75 ms | 301.64 ms | 16.83 条/s |

| HTTP 并发 | 模型锁等待 p50 / p95 | 推理 p50 / p95 |
| --- | ---: | ---: |
| 1 | 0.00 / 0.00 ms | 76.59 / 116.56 ms |
| 4 | 171.11 / 229.77 ms | 57.53 / 83.68 ms |

直接测试采样的进程 RSS 最大 **1003.09 MiB**；进程 CPU 平均 194.98%（100% 表示一个核）。RSS 含映射页面，不能与 Docker cgroup 内存统计直接混同；它是每次预测后的采样值，不是加载时或系统瞬时峰值。CPU 时间短区间采样受计时精度影响，个别值可超过容器限额。

HTTP 是独立同步推理服务，只有一个常驻模型，由锁串行执行。等待时间不包含原平台 PostgreSQL 评论保存和后台任务排队，不能视为整个平台端到端性能。并发阶段各使用 100 个请求，样本量小；不同阶段缓存、系统调度和文本顺序造成速度波动，不能据此断言并发会加速单次推理。

全量分类推理运行耗时 752.41 秒；质量指标来自全部 12,284 条，性能摘要来自上述独立固定 100 条。

## 功能与复核

真实 CPU 检查通过：作者预处理、分类头完整加载、三个英文示例、softmax/argmax、短文本动态分词、输入拒绝、512-token 截断。手写示例仅验证功能，不用于计算准确率。全部 12,284 条保存预测经独立脚本重新计算，与原报告逐项完全一致。见 [检查记录](results/cardiff-cpu-local/checks.json) 和 [重算记录](results/cardiff-cpu-local/rescore.json)。最终镜像重启后复用已下载的固定模型与原有评测卷，浏览器可正常试用；快照中的 runtime.json 保留正式评测当时的运行标识。

## 复现与来源

- 模型：[cardiffnlp/twitter-roberta-base-sentiment-latest](https://huggingface.co/cardiffnlp/twitter-roberta-base-sentiment-latest/tree/3216a57f2a0d9c45a2e6c20157c20c49fb4bf9c7)，revision `3216a57f2a0d9c45a2e6c20157c20c49fb4bf9c7`。模型卡声明 CC BY 4.0，作者原始 501 MB FP32 权重，不量化、不转换。
- 数据：固定 [TweetEval sentiment/test](https://huggingface.co/datasets/cardiffnlp/tweet_eval/tree/b3a375baf0f409c77e6bc7aa35102b7b3534f8be/sentiment)，revision `b3a375baf0f409c77e6bc7aa35102b7b3534f8be`。
- 作者预处理：用户名和链接占位；最长 512 tokens；logits 经过一次 softmax 后 argmax。无人工修改标签。
- 模型和数据文件的 SHA-256、字节数、标签映射见 [来源快照](results/cardiff-cpu-local/model-manifest.json) 和 [数据快照](results/cardiff-cpu-local/dataset-manifest.json)。
- [完整分类报告](results/cardiff-cpu-local/evaluation.json)、[性能报告](results/cardiff-cpu-local/benchmark.json)、[运行配置](results/cardiff-cpu-local/runtime.json)、[全部预测](results/cardiff-cpu-local/predictions.jsonl)。预测只保存文本哈希和行号，不重新分发原始推文。
- [运行、功能检查与独立重算步骤](../experiments/cardiff-cpu/README.md)。

**许可边界：**模型许可明确，但 TweetEval 聚合数据卡标注 unknown，原仓库要求遵循子任务原始来源条款。本次保留为本地学术验证，数据不打包发布。正式替换课程默认方案前仍需完成 sentiment 原始数据条款核查。旧 MIT 模型 / Apache-2.0 数据方案保留。

**部署边界：**当前仅验证 Apple M5 上 Docker Linux ARM64。依赖同时锁定官方 Linux x86_64 CPU wheel，尚未在新 Jetstream2 x86_64 上运行；实例准备后按相同固定配置重新测量，不将本机结果写成云端结果。
