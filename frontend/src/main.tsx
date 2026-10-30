import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type User = { id: string; username: string };
type Event = {
  id: string;
  title: string;
  category: string;
  description: string;
  location: string;
  starts_at: string;
  comment_count: number;
};
type Analysis = {
  id: string;
  top_label: string;
  top_score: number;
  scores: Record<string, number>;
  labels: string[];
  inference_ms: number;
  queue_ms: number;
  token_count: number;
  truncated: boolean;
};
type Sentiment = {
  label: string;
  scores: Record<string, number>;
  inference_ms: number;
  queue_ms: number;
  model_revision: string;
};
const sentiments: Record<string, string> = {
  negative: "负面",
  neutral: "中性",
  positive: "正面",
};
type Correction = {
  labels: string[];
  reason: string;
  username: string;
  created_at: string;
};
type Note = {
  id: string;
  event_id: string;
  event_title: string;
  username: string;
  text: string;
  status: string;
  handling: string;
  created_at: string;
  completed_at: string | null;
  favorite: boolean;
  analysis: Analysis | null;
  sentiment: Sentiment | null;
  sentiment_status: string;
  sentiment_error: string | null;
  sentiment_attempts?: { status: string; started_at: string }[];
  correction: Correction | null;
  last_error: string | null;
  correction_history?: Correction[];
  attempts?: { status: string; started_at: string }[];
};
type Stats = {
  total: number;
  completed: number;
  waiting: number;
  unread: number;
  favorites: number;
  sentiment?: Record<string, number>;
  sentiment_completed?: number;
  emotions?: { label: string; count: number }[];
};
type Metric = {
  label: string;
  precision: number;
  recall: number;
  f1: number;
  support: number;
};
type Evaluation = {
  id: string;
  status: string;
  total: number;
  processed: number;
  official: boolean;
  created_at: string;
  metrics: null | {
    micro_f1: number;
    macro_f1: number;
    exact_match_accuracy: number;
    per_label: Metric[];
  };
  metadata: null | {
    runtime: {
      platform: string;
      architecture: string;
      intra_threads: number;
      inter_threads: number;
    };
    inference_ms: { p50: number; p95: number };
  };
};
type Distribution = { p50: number; p95: number; max: number; mean: number };
type Bench = {
  id: string;
  status: string;
  report: null | {
    samples: number;
    model_inference_ms: Distribution;
    rss_mb: Distribution;
    process_cpu_percent: Distribution;
    model_throughput_per_second: number;
    runtime: {
      architecture: string;
      platform: string;
      model_load_ms: number;
      first_inference_ms: number;
      cpu_limit: string;
      intra_threads: number;
      inter_threads: number;
    };
    api_cases: {
      concurrency: number;
      throughput_per_second: number;
      server_completion_ms: Distribution;
      queue_ms: Distribution;
      inference_ms: Distribution;
    }[];
  };
};
type View = "events" | "event" | "mine" | "board" | "favorites" | "evaluation";
const chinese = [
  "赞赏",
  "愉悦",
  "愤怒",
  "烦恼",
  "认同",
  "关爱",
  "困惑",
  "好奇",
  "渴望",
  "失望",
  "不认同",
  "厌恶",
  "尴尬",
  "兴奋",
  "恐惧",
  "感谢",
  "悲痛",
  "喜悦",
  "喜爱",
  "紧张",
  "乐观",
  "自豪",
  "领悟",
  "释然",
  "懊悔",
  "悲伤",
  "惊讶",
  "中性",
];
const labels = [
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
];
const labelName = (v: string) => `${chinese[labels.indexOf(v)] || v} · ${v}`;
const statusName: Record<string, string> = {
  pending: "等待分析",
  processing: "分析中",
  completed: "分析完成",
  failed: "分析失败",
  unread: "未查看",
  viewed: "已查看",
  processed: "已处理",
};
const date = (v: string) =>
  new Date(v).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const percent = (v: number) => `${(v * 100).toFixed(1)}%`;
const ms = (v: number) => `${v.toFixed(0)} ms`;
async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const r = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!r.ok) {
    let msg = `请求失败 (${r.status})`;
    try {
      const e = await r.json();
      msg =
        typeof e.detail === "string"
          ? e.detail
          : e.detail?.map((x: { msg: string }) => x.msg).join("；") || msg;
    } catch {}
    throw new Error(msg);
  }
  return (r.status === 204 ? undefined : await r.json()) as T;
}
function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={"mark " + (small ? "small" : "")} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
function App() {
  const [user, setUser] = useState<User | null>(null),
    [checking, setChecking] = useState(true),
    [username, setUsername] = useState(""),
    [loginBusy, setLoginBusy] = useState(false);
  const [view, setView] = useState<View>("events"),
    [events, setEvents] = useState<Event[]>([]),
    [selected, setSelected] = useState<Event | null>(null);
  const [stats, setStats] = useState<Stats>({
      total: 0,
      completed: 0,
      waiting: 0,
      unread: 0,
      favorites: 0,
    }),
    [notes, setNotes] = useState<Note[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1);
  const [filterEvent, setFilterEvent] = useState(""),
    [filterLabel, setFilterLabel] = useState(""),
    [filterSentiment, setFilterSentiment] = useState(""),
    [filterSentimentStatus, setFilterSentimentStatus] = useState(""),
    [filterStatus, setFilterStatus] = useState(""),
    [filterHandling, setFilterHandling] = useState(""),
    [after, setAfter] = useState(""),
    [before, setBefore] = useState("");
  const [text, setText] = useState(""),
    [sending, setSending] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0),
    [ready, setReady] = useState(false);
  const [correcting, setCorrecting] = useState<Note | null>(null),
    [corrected, setCorrected] = useState<string[]>([]),
    [reason, setReason] = useState(""),
    [saving, setSaving] = useState(false),
    [history, setHistory] = useState<Note | null>(null);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]),
    [evaluationId, setEvaluationId] = useState(""),
    [benches, setBenches] = useState<Bench[]>([]);
  const uuid = () =>
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
          (
            Number(c) ^
            (crypto.getRandomValues(new Uint8Array(1))[0] &
              (15 >> (Number(c) / 4)))
          ).toString(16),
        );
  const draftKey = useRef(uuid());
  useEffect(() => {
    api<User>("/api/session")
      .then(setUser)
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    setPage(1);
  }, [
    view,
    selected?.id,
    filterEvent,
    filterLabel,
    filterSentiment,
    filterSentimentStatus,
    filterStatus,
    filterHandling,
    after,
    before,
  ]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    async function refresh() {
      try {
        const [es, ss] = await Promise.all([
          api<Event[]>("/api/events"),
          api<Stats>("/api/stats"),
        ]);
        if (!active) return;
        setEvents(es);
        setStats(ss);
        if (view === "evaluation") {
          const [ev, bb] = await Promise.all([
            api<Evaluation[]>("/api/evaluations"),
            api<Bench[]>("/api/benchmarks"),
          ]);
          if (active) {
            setEvaluations(ev);
            setBenches(bb);
          }
        } else if (view !== "events") {
          const q = new URLSearchParams({
            page: String(page),
            page_size: "12",
          });
          if (view === "event" && selected) q.set("event_id", selected.id);
          if (view === "mine") q.set("mine", "true");
          if (view === "favorites") q.set("favorites", "true");
          if (["board", "favorites", "mine"].includes(view)) {
            if (filterEvent) q.set("event_id", filterEvent);
            if (filterLabel) q.set("label", filterLabel);
            if (filterSentiment) q.set("sentiment", filterSentiment);
            if (filterSentimentStatus)
              q.set("sentiment_status", filterSentimentStatus);
            if (filterStatus) q.set("status", filterStatus);
            if (filterHandling) q.set("handling", filterHandling);
            if (after)
              q.set("after", new Date(after + "T00:00:00").toISOString());
            if (before)
              q.set("before", new Date(before + "T23:59:59.999").toISOString());
          }
          const result = await api<{ items: Note[]; total: number }>(
            "/api/comments?" + q,
          );
          if (active) {
            setNotes(result.items);
            setTotal(result.total);
          }
        }
        const health = await fetch("/ready");
        if (active) setReady(health.ok);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    }
    void refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [
    user,
    view,
    selected?.id,
    page,
    filterEvent,
    filterLabel,
    filterSentiment,
    filterSentimentStatus,
    filterStatus,
    filterHandling,
    after,
    before,
    revision,
  ]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  function navigate(v: View) {
    setView(v);
    setError("");
    setNotes([]);
    setTotal(0);
    setFilterEvent("");
    setFilterLabel("");
    setFilterSentiment("");
    setFilterSentimentStatus("");
    setFilterStatus("");
    setFilterHandling("");
    setAfter("");
    setBefore("");
    setPage(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoginBusy(true);
    setError("");
    try {
      setUser(
        await api<User>("/api/session", {
          method: "POST",
          body: JSON.stringify({ username }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoginBusy(false);
    }
  }
  async function act(path: string, method: string, body?: unknown) {
    setError("");
    try {
      await api(path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      setRevision((x) => x + 1);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSending(true);
    if (
      await act("/api/comments", "POST", {
        event_id: selected.id,
        text,
        idempotency_key: draftKey.current,
      })
    ) {
      setText("");
      draftKey.current = uuid();
      setNotice("评论已保存，正在等待分析。");
      setPage(1);
    }
    setSending(false);
  }
  function editText(value: string) {
    setText(value);
    draftKey.current = uuid();
  }
  function openCorrection(n: Note) {
    setCorrecting(n);
    setCorrected(n.correction?.labels || n.analysis?.labels || []);
    setReason("");
  }
  async function saveCorrection(e: React.FormEvent) {
    e.preventDefault();
    if (!correcting) return;
    setSaving(true);
    if (
      await act(`/api/comments/${correcting.id}/corrections`, "POST", {
        labels: corrected,
        reason,
      })
    ) {
      setCorrecting(null);
      setNotice("人工纠正已追加保存，原始模型结果保持不变。");
    }
    setSaving(false);
  }
  async function showHistory(n: Note) {
    try {
      setHistory(await api<Note>("/api/comments/" + n.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const activeEvaluation =
    evaluations.find((x) => x.id === evaluationId) ||
    evaluations.find((x) => x.official && x.status === "completed") ||
    evaluations[0];
  const benchmark = benches.find((x) => x.status === "completed")?.report;
  const hasCjk = /[\u3400-\u9fff]/.test(text);
  function noteCard(n: Note) {
    return (
      <article className="note" key={n.id}>
        <div className="note-top">
          <div className="avatar">{n.username.slice(0, 1).toUpperCase()}</div>
          <div>
            <strong>{n.username}</strong>
            <span className="muted note-context">
              {date(n.created_at)}
              {view !== "event" ? " · " + n.event_title.split(" · ")[0] : ""}
            </span>
          </div>
          <span className={"status " + n.status}>
            <i />
            {statusName[n.status]}
          </span>
        </div>
        <p className="comment-text" lang="en">
          {n.text}
        </p>
        {n.analysis ? (
          <div className="analysis">
            <div className="analysis-heading">
              <span className="eyebrow">TEXT EMOTION</span>
              <span className="muted">
                {ms(n.analysis.inference_ms)} · {n.analysis.token_count} tokens
                {n.analysis.truncated ? " · 已截断至 512 tokens" : ""}
              </span>
            </div>
            <div className="top-emotion">
              <span>最高分标签</span>
              <strong>{labelName(n.analysis.top_label)}</strong>
              <span className="score" title="模型得分未经校准">
                模型得分 {n.analysis.top_score.toFixed(3)}
              </span>
            </div>
            <div className="label-row">
              <span className="muted">超过 0.5 的标签</span>
              {n.analysis.labels.length ? (
                n.analysis.labels.map((l) => (
                  <span className={"tag emotion-" + l} key={l}>
                    {labelName(l)}
                  </span>
                ))
              ) : (
                <span className="tag">无标签超过阈值</span>
              )}
            </div>
            <details>
              <summary>查看全部 28 项模型得分</summary>
              <div className="score-grid">
                {Object.entries(n.analysis.scores)
                  .sort((a, b) => b[1] - a[1])
                  .map(([l, s]) => (
                    <div key={l}>
                      <span>{labelName(l)}</span>
                      <b>{s.toFixed(4)}</b>
                      <progress max="1" value={s} />
                    </div>
                  ))}
              </div>
              <p className="muted fineprint">
                模型得分未经心理测量校准；标签判定严格使用 score &gt; 0.5。
              </p>
            </details>
          </div>
        ) : (
          <div className={"analysis pending-message " + n.status}>
            {n.status === "failed" ? (
              <>
                <strong>分析暂未完成</strong>
                <span>评论已安全保存。可以重试，历史尝试会保留。</span>
              </>
            ) : (
              <>
                <span className="pulse" />
                <span>
                  {n.status === "processing"
                    ? "模型正在分析文本表达的情绪…"
                    : "评论已保存，等待后台分析。"}
                </span>
              </>
            )}
          </div>
        )}
        <div className="analysis sentiment-analysis">
          <div className="analysis-heading">
            <span className="eyebrow">TEXT SENTIMENT · 三分类</span>
            <span className={"status " + n.sentiment_status}>
              {statusName[n.sentiment_status]}
            </span>
          </div>
          {n.sentiment ? (
            <>
              <div
                className={"sentiment-winner sentiment-" + n.sentiment.label}
              >
                {sentiments[n.sentiment.label]} · {n.sentiment.label}
              </div>
              <div className="sentiment-scores">
                {Object.entries(sentiments).map(([label, name]) => (
                  <div key={label}>
                    <span>{name}</span>
                    <progress max="1" value={n.sentiment!.scores[label]} />
                    <b>{n.sentiment!.scores[label].toFixed(4)}</b>
                  </div>
                ))}
              </div>
              <p className="fineprint muted">
                模型得分 · 单标签三分类；与上方多标签情绪独立。推理{" "}
                {ms(n.sentiment.inference_ms)} · 排队 {ms(n.sentiment.queue_ms)}
              </p>
            </>
          ) : (
            <p className="muted">
              {n.sentiment_status === "failed"
                ? n.sentiment_error || "三分类暂时失败，评论已保存。"
                : "评论已保存，后台正在分析正面／中性／负面倾向。"}
            </p>
          )}
          {n.sentiment_status === "failed" && (
            <button
              className="text-button"
              onClick={() =>
                void act(`/api/comments/${n.id}/sentiment/retry`, "POST")
              }
            >
              重试三分类 ↻
            </button>
          )}
        </div>
        {n.correction && (
          <div className="correction">
            <span className="eyebrow">人工纠正 · 独立记录</span>
            <p>
              {n.correction.labels.length
                ? n.correction.labels.map(labelName).join(" / ")
                : "空标签集合"}
            </p>
            <span className="muted">
              {n.correction.reason} · {n.correction.username}
            </span>
          </div>
        )}
        <div className="note-actions">
          <button
            className={"text-button " + (n.favorite ? "is-favorite" : "")}
            onClick={() =>
              void act(`/api/comments/${n.id}/favorite`, "PUT", {
                value: !n.favorite,
              })
            }
            aria-label={n.favorite ? "取消收藏" : "收藏评论"}
          >
            {n.favorite ? "★ 已收藏" : "☆ 收藏"}
          </button>
          <label className="handling-label">
            处理状态
            <select
              aria-label="评论处理状态"
              value={n.handling}
              onChange={(e) =>
                void act(`/api/comments/${n.id}/handling`, "PUT", {
                  status: e.target.value,
                })
              }
            >
              {["unread", "viewed", "processed"].map((x) => (
                <option value={x} key={x}>
                  {statusName[x]}
                </option>
              ))}
            </select>
          </label>
          <div className="action-spacer" />
          {n.status === "failed" && (
            <button
              className="text-button"
              onClick={() => void act(`/api/comments/${n.id}/retry`, "POST")}
            >
              重试分析 ↻
            </button>
          )}
          {n.analysis && (
            <button className="text-button" onClick={() => openCorrection(n)}>
              人工纠正
            </button>
          )}
          <button className="text-button" onClick={() => void showHistory(n)}>
            记录 ↗
          </button>
        </div>
      </article>
    );
  }
  if (checking)
    return (
      <div className="loading">
        <Mark />
        <p>正在打开校园回声…</p>
      </div>
    );
  if (!user)
    return (
      <main className="welcome">
        <section className="welcome-art">
          <div className="wordmark">
            <Mark />
            <span>CAMPUS NOTES</span>
          </div>
          <div className="welcome-copy">
            <span className="eyebrow">LISTEN TO YOUR CAMPUS</span>
            <h1>
              每一种声音，
              <br />
              都值得被听见<span>。</span>
            </h1>
            <p>
              记录校园活动里的真实体验，
              <br />
              一起发现文字中的情绪。
            </p>
          </div>
          <div className="welcome-decoration">
            <div className="floating-note one">
              <span>SPRING SOUNDS</span>
              <p>
                “The music was incredible.
                <br />I loved every minute!”
              </p>
              <small>joy · admiration · love</small>
            </div>
            <div className="floating-note two">
              <span>A LITTLE FEEDBACK GOES A LONG WAY</span>
              <div className="sound-bars">▂ ▅ ▃ █ ▆ ▃ ▅ ▂</div>
            </div>
          </div>
          <span className="welcome-bottom">A SMALL CAMPUS. A LOT TO SAY.</span>
        </section>
        <section className="login-panel">
          <span className="edition">DML COURSE PROJECT / 01</span>
          <form onSubmit={login}>
            <span className="eyebrow">WELCOME IN</span>
            <h2>先打个招呼。</h2>
            <p className="muted">给自己起个名字，就能参与校园讨论。</p>
            <label htmlFor="username">你的名字</label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={32}
              required
              placeholder="例如 Alex"
              autoComplete="nickname"
            />
            <button
              className="primary"
              disabled={loginBusy || !username.trim()}
            >
              {loginBusy ? "正在进入…" : "进入校园回声"} <span>↗</span>
            </button>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="demo-notice">
              <strong>无需密码 · 公开演示</strong>
              <p>
                用户页与分析看板可自由切换，所有访客均可操作看板。名字仅用于展示，不验证真实身份。
              </p>
            </div>
            <p className="fineprint muted">
              模型仅支持英文评论。分析文本表达的情绪，不推断心理状态，不自动删除评论。
            </p>
          </form>
          <span className="login-footer">
            POWERED BY GOEMOTIONS · RUNNING ON CPU
          </span>
        </section>
      </main>
    );
  return (
    <>
      <header className="header">
        <a
          className="wordmark"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("events");
          }}
        >
          <Mark small />
          <span>
            CAMPUS
            <br />
            <b>NOTES</b>
          </span>
        </a>
        <nav aria-label="主导航">
          {(
            [
              ["events", "发现活动"],
              ["mine", "我的评论"],
              ["board", "分析看板"],
              ["favorites", "我的收藏"],
              ["evaluation", "评测报告"],
            ] as [View, string][]
          ).map(([v, t]) => (
            <button
              key={v}
              className={
                view === v || (view === "event" && v === "events")
                  ? "active"
                  : ""
              }
              onClick={() => navigate(v)}
            >
              {t}
              {v === "favorites" && stats.favorites > 0 ? (
                <span className="nav-count">{stats.favorites}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="user">
          <span className="avatar">
            {user.username.slice(0, 1).toUpperCase()}
          </span>
          <span>{user.username}</span>
          <button
            title="退出后会结束此浏览器身份，同名不恢复原会话"
            className="text-button"
            onClick={async () => {
              await api("/api/session", { method: "DELETE" });
              setUser(null);
              navigate("events");
            }}
          >
            退出
          </button>
        </div>
      </header>
      <div className="demo-banner">
        <span>
          <i />
          公开演示模式 · 用户与看板自由切换
        </span>
        <span>
          仅支持英文文本情绪分析 <span className="banner-divider">/</span>{" "}
          不用于心理或违规判断
        </span>
      </div>
      <main className="container">
        {error && (
          <div className="error global-error" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="关闭错误">
              ×
            </button>
          </div>
        )}
        {view === "events" ? (
          <>
            <section className="hero">
              <div>
                <span className="eyebrow">YOUR CAMPUS, IN YOUR WORDS</span>
                <h1>
                  校园里的事，
                  <br />
                  听听大家怎么说<span>。</span>
                </h1>
                <p>
                  参与一场活动，留下一段感受。
                  <br />
                  让每一条反馈，都成为下一次更好的开始。
                </p>
                <button className="secondary" onClick={() => navigate("board")}>
                  打开分析看板 <span>↗</span>
                </button>
              </div>
              <div className="hero-art" aria-hidden="true">
                <div className="orbit orbit-one" />
                <div className="orbit orbit-two" />
                <div className="orbit-center">
                  <Mark />
                  <span>
                    GOOD VIBES.
                    <br />
                    HONEST FEEDBACK.
                  </span>
                </div>
                <span className="orbit-label ol1">curiosity</span>
                <span className="orbit-label ol2">excitement</span>
                <span className="orbit-label ol3">gratitude</span>
                <span className="art-spark">✳</span>
              </div>
            </section>
            <div className="section-title">
              <div>
                <span className="eyebrow">WHAT'S HAPPENING</span>
                <h2>值得参与的校园日常</h2>
              </div>
              <span className="muted">03 场虚构活动 · 真实功能演示</span>
            </div>
            <div className="event-grid">
              {events.map((e, i) => (
                <button
                  className="event-card"
                  key={e.id}
                  onClick={() => {
                    setSelected(e);
                    navigate("event");
                  }}
                >
                  <div className={"event-art art-" + i}>
                    <span className="event-number">0{i + 1}</span>
                    <span className="event-date">
                      APR {new Date(e.starts_at).getUTCDate()}
                    </span>
                    <div className="event-shape" />
                    <span className="event-art-title">
                      {
                        ["SPRING\nSOUNDS", "MAKE\nSOMETHING.", "AFTER\nHOURS"][
                          i
                        ]
                      }
                    </span>
                  </div>
                  <div className="event-info">
                    <span className="eyebrow">{e.category}</span>
                    <h3>{e.title.split(" · ")[1]}</h3>
                    <p>{e.description}</p>
                    <div className="event-meta">
                      <span>{e.location}</span>
                      <span>
                        {e.comment_count} 条评论 <b>↗</b>
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <section className="principles">
              <span className="eyebrow">A NOTE ON EMOTION</span>
              <h3>情绪是线索，理解需要更多上下文。</h3>
              <p>
                模型识别英文文字中表达的情绪，无法知道一个人的真实心理状态。多种情绪可以同时出现；没有标签超过阈值，也是一种正常结果。
              </p>
            </section>
          </>
        ) : view === "evaluation" ? (
          <>
            <div className="page-heading">
              <span className="eyebrow">MEASURE, DON'T GUESS</span>
              <h1>让结果，经得起检验。</h1>
              <p>固定模型、固定官方测试集。分类质量与运行性能分别记录。</p>
            </div>
            <div className="evaluation-source">
              <div>
                <span className="eyebrow">MODEL</span>
                <strong>RoBERTa · GoEmotions INT8</strong>
                <span>CPU ONNX · 28 标签 · score &gt; 0.5</span>
              </div>
              <div>
                <span className="eyebrow">TEST DATA</span>
                <strong>GoEmotions simplified / test</strong>
                <span>5,427 条真实标注 · 与现场评论及人工纠正分开</span>
              </div>
              <a
                href="https://huggingface.co/SamLowe/roberta-base-go_emotions-onnx"
                target="_blank"
                rel="noreferrer"
              >
                查看模型来源 ↗
              </a>
            </div>
            {evaluations.length > 0 && (
              <label className="run-picker">
                评测运行
                <select
                  value={activeEvaluation?.id || ""}
                  onChange={(e) => setEvaluationId(e.target.value)}
                >
                  {evaluations.map((e) => (
                    <option key={e.id} value={e.id}>
                      {date(e.created_at)} ·{" "}
                      {e.official ? "完整官方测试" : "部分样本冒烟测试"} ·{" "}
                      {statusName[e.status] || e.status}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!activeEvaluation ? (
              <div className="empty">
                <span>◎</span>
                <h3>官方评测结果尚未生成</h3>
                <p>完成评测后，指标和逐条预测会出现在这里。</p>
              </div>
            ) : activeEvaluation.status !== "completed" ? (
              <div className="empty">
                <span>◎</span>
                <h3>
                  {statusName[activeEvaluation.status] ||
                    activeEvaluation.status}
                </h3>
                <p>
                  已处理 {activeEvaluation.processed} / {activeEvaluation.total}{" "}
                  条，页面会自动更新。
                </p>
              </div>
            ) : (
              activeEvaluation.metrics && (
                <>
                  <div className="section-title">
                    <h2>
                      {activeEvaluation.official
                        ? "官方完整测试成绩"
                        : "部分样本冒烟结果 · 非官方完整成绩"}
                    </h2>
                    <span className="muted">
                      {activeEvaluation.total.toLocaleString()} 条 · 全部 28 类
                    </span>
                  </div>
                  <div className="metric-grid">
                    {[
                      [
                        "Micro-F1",
                        activeEvaluation.metrics.micro_f1,
                        "整体标签预测",
                      ],
                      [
                        "Macro-F1",
                        activeEvaluation.metrics.macro_f1,
                        "28 类等权平均",
                      ],
                      [
                        "Exact-match accuracy",
                        activeEvaluation.metrics.exact_match_accuracy,
                        "整组标签完全匹配",
                      ],
                    ].map(([t, v, s]) => (
                      <div className="metric-card" key={String(t)}>
                        <span>{t}</span>
                        <strong>{percent(Number(v))}</strong>
                        <small>{s}</small>
                      </div>
                    ))}
                  </div>
                  <div className="report-downloads">
                    {["metrics.json", "predictions.jsonl", "metadata.json"].map(
                      (f) => (
                        <a
                          key={f}
                          href={`/api/evaluations/${activeEvaluation.id}/files/${f}`}
                          download
                        >
                          {f === "metrics.json"
                            ? "下载指标"
                            : f === "predictions.jsonl"
                              ? "下载逐条预测"
                              : "下载运行信息"}{" "}
                          ↓
                        </a>
                      ),
                    )}
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>情绪标签</th>
                          <th>Precision</th>
                          <th>Recall</th>
                          <th>F1</th>
                          <th>真实标签样本数</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeEvaluation.metrics.per_label.map((m) => (
                          <tr key={m.label}>
                            <td>{labelName(m.label)}</td>
                            <td>{m.precision.toFixed(3)}</td>
                            <td>{m.recall.toFixed(3)}</td>
                            <td>
                              <b>{m.f1.toFixed(3)}</b>
                            </td>
                            <td>{m.support}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="fineprint muted">
                    多标签样本可计入多个类别的 support。Exact-match
                    要求一条文本的整组预测标签与真实标签完全一致；不等于逐标签平均准确率。
                  </p>
                </>
              )
            )}
            <div className="section-title">
              <div>
                <span className="eyebrow">ON THIS MACHINE</span>
                <h2>CPU 实测性能</h2>
              </div>
              <span className="muted">与作者报告分开记录</span>
            </div>
            {benchmark ? (
              <>
                <div className="metric-grid">
                  <div className="metric-card">
                    <span>预热后推理 p50 / p95</span>
                    <strong className="compact-number">
                      {ms(benchmark.model_inference_ms.p50)} /{" "}
                      {ms(benchmark.model_inference_ms.p95)}
                    </strong>
                    <small>{benchmark.samples} 条 · batch 1 · 预热 20 次</small>
                  </div>
                  <div className="metric-card">
                    <span>模型加载 / 首次推理</span>
                    <strong className="compact-number">
                      {ms(benchmark.runtime.model_load_ms)} /{" "}
                      {ms(benchmark.runtime.first_inference_ms)}
                    </strong>
                    <small>本地缓存加载，不含文件下载</small>
                  </div>
                  <div className="metric-card">
                    <span>进程内存 / CPU</span>
                    <strong className="compact-number">
                      {benchmark.rss_mb.max.toFixed(0)} MB /{" "}
                      {benchmark.process_cpu_percent.mean.toFixed(0)}%
                    </strong>
                    <small>推理后采样最大 RSS / 平均 CPU（100% = 1 核）</small>
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>API 并发</th>
                        <th>完成 p50 / p95</th>
                        <th>排队 p95</th>
                        <th>推理 p95</th>
                        <th>吞吐量</th>
                      </tr>
                    </thead>
                    <tbody>
                      {benchmark.api_cases?.map((c) => (
                        <tr key={c.concurrency}>
                          <td>{c.concurrency}</td>
                          <td>
                            {ms(c.server_completion_ms.p50)} /{" "}
                            {ms(c.server_completion_ms.p95)}
                          </td>
                          <td>{ms(c.queue_ms.p95)}</td>
                          <td>{ms(c.inference_ms.p95)}</td>
                          <td>{c.throughput_per_second.toFixed(2)} 条/秒</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="fineprint muted">
                  硬件环境：{benchmark.runtime.platform} /{" "}
                  {benchmark.runtime.architecture}；ORT 线程{" "}
                  {benchmark.runtime.intra_threads}/
                  {benchmark.runtime.inter_threads}；容器 CPU 配额{" "}
                  {benchmark.runtime.cpu_limit}。容器本地结果不代表 Jetstream2
                  的性能。
                </p>
              </>
            ) : (
              <div className="empty compact">
                <p>尚无已完成的性能测试。</p>
              </div>
            )}
          </>
        ) : (
          <>
            {view === "event" && selected ? (
              <>
                <button
                  className="back text-button"
                  onClick={() => navigate("events")}
                >
                  ← 返回活动
                </button>
                <div className="event-heading">
                  <div>
                    <span className="eyebrow">{selected.category}</span>
                    <h1>{selected.title.split(" · ")[1]}</h1>
                    <p>{selected.description}</p>
                    <span className="muted">
                      {selected.location} · {date(selected.starts_at)}
                    </span>
                  </div>
                  <span
                    className={
                      "mini-art art-" +
                      events.findIndex((e) => e.id === selected.id)
                    }
                  >
                    ✳
                  </span>
                </div>
                <form className="composer" onSubmit={submit}>
                  <div className="composer-title">
                    <h3>留下你的活动体验</h3>
                    <span className="tag">ENGLISH ONLY</span>
                  </div>
                  <textarea
                    aria-label="英文活动评论"
                    value={text}
                    onChange={(e) => editText(e.target.value)}
                    maxLength={2000}
                    required
                    placeholder="How was the event? Tell us what stood out to you…"
                    rows={4}
                  />
                  <div className="composer-bottom">
                    <span className={hasCjk ? "language-warning" : "muted"}>
                      {hasCjk
                        ? "本模型仅支持英文；中文分析结果不可靠，请改用英文。"
                        : "先保存评论，再由后台分析；不根据情绪自动删除内容。"}
                      <small>{text.length} / 2000</small>
                    </span>
                    <button
                      className="primary"
                      disabled={sending || !text.trim() || hasCjk}
                    >
                      {sending ? "保存中…" : "发布评论"} <span>↗</span>
                    </button>
                  </div>
                  <div className="examples">
                    <span>试试：</span>
                    {[
                      "The music was amazing! Thank you for organizing this.",
                      "I was disappointed by the long wait, but I loved the performances.",
                    ].map((s) => (
                      <button type="button" key={s} onClick={() => editText(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                </form>
                <div className="section-title">
                  <h2>活动评论</h2>
                  <span className="muted">{total} 条 · 自动更新分析状态</span>
                </div>
              </>
            ) : (
              <>
                <div className="page-heading">
                  <span className="eyebrow">
                    {view === "mine"
                      ? "YOUR WORDS, YOUR EXPERIENCE"
                      : view === "favorites"
                        ? "KEEP THE IMPORTANT ONES"
                        : "FROM FEEDBACK TO FOLLOW-UP"}
                  </span>
                  <h1>
                    {view === "mine"
                      ? "你说过的，都在这里。"
                      : view === "favorites"
                        ? "把重要的声音，留下来。"
                        : "听见情绪，跟进反馈。"}
                  </h1>
                  <p>
                    {view === "mine"
                      ? "查看此浏览器会话提交的评论与分析状态。"
                      : view === "favorites"
                        ? "收藏按当前浏览器身份保存，处理和纠正记录公开可见。"
                        : "情绪标签帮助理解文字表达，不代表违规或真实心理状态。"}
                  </p>
                </div>
                <div className="stats-grid">
                  {[
                    ["所有评论", stats.total, "01"],
                    ["两套分析均完成", stats.completed, "02"],
                    ["等待 / 分析中", stats.waiting, "03"],
                    ["尚未查看", stats.unread, "04"],
                  ].map(([t, n, i]) => (
                    <div key={String(t)}>
                      <span>{t}</span>
                      <strong>{String(n).padStart(2, "0")}</strong>
                      <small>{i}</small>
                    </div>
                  ))}
                </div>
                <section className="dual-distributions" aria-label="双模型统计">
                  <div className="distribution-panel">
                    <span className="eyebrow">SENTIMENT · 三分类分布</span>
                    <p className="fineprint muted">
                      全站真实评论 · 已完成 {stats.sentiment_completed || 0} 条
                    </p>
                    <div className="sentiment-totals">
                      {Object.entries(sentiments).map(([label, name]) => (
                        <button
                          key={label}
                          className={"sentiment-total sentiment-" + label}
                          onClick={() => {
                            setFilterSentiment(label);
                            setPage(1);
                          }}
                        >
                          <span>{name}</span>
                          <strong>{stats.sentiment?.[label] || 0}</strong>
                          <small>
                            {stats.sentiment_completed
                              ? percent(
                                  (stats.sentiment?.[label] || 0) /
                                    stats.sentiment_completed,
                                )
                              : "—"}
                          </small>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="distribution-panel">
                    <span className="eyebrow">EMOTION · 阈值标签分布</span>
                    <p className="fineprint muted">
                      全站模型原始输出 · 一条评论可有多个标签
                    </p>
                    <div className="emotion-totals">
                      {stats.emotions?.length ? (
                        stats.emotions.map((e) => (
                          <button
                            key={e.label}
                            className="tag"
                            onClick={() => setFilterLabel(e.label)}
                          >
                            {labelName(e.label)} <b>{e.count}</b>
                          </button>
                        ))
                      ) : (
                        <span className="muted">分析完成后显示情绪分布。</span>
                      )}
                    </div>
                  </div>
                </section>
                <section className="filters" aria-label="评论筛选">
                  <label>
                    活动
                    <select
                      value={filterEvent}
                      onChange={(e) => setFilterEvent(e.target.value)}
                    >
                      <option value="">全部活动</option>
                      {events.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.title.split(" · ")[1]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    模型情绪
                    <select
                      value={filterLabel}
                      onChange={(e) => setFilterLabel(e.target.value)}
                    >
                      <option value="">全部情绪</option>
                      {labels.map((l) => (
                        <option key={l} value={l}>
                          {labelName(l)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    情绪分析状态
                    <select
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                    >
                      <option value="">全部状态</option>
                      {["pending", "processing", "completed", "failed"].map(
                        (s) => (
                          <option key={s} value={s}>
                            {statusName[s]}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    三分类结果
                    <select
                      value={filterSentiment}
                      onChange={(e) => setFilterSentiment(e.target.value)}
                    >
                      <option value="">全部倾向</option>
                      {Object.entries(sentiments).map(([l, n]) => (
                        <option key={l} value={l}>
                          {n} · {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    三分类状态
                    <select
                      value={filterSentimentStatus}
                      onChange={(e) => setFilterSentimentStatus(e.target.value)}
                    >
                      <option value="">全部状态</option>
                      {["pending", "processing", "completed", "failed"].map(
                        (l) => (
                          <option key={l} value={l}>
                            {statusName[l]}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    处理状态
                    <select
                      value={filterHandling}
                      onChange={(e) => setFilterHandling(e.target.value)}
                    >
                      <option value="">全部处理状态</option>
                      {["unread", "viewed", "processed"].map((s) => (
                        <option key={s} value={s}>
                          {statusName[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    开始日期
                    <input
                      type="date"
                      value={after}
                      onChange={(e) => setAfter(e.target.value)}
                    />
                  </label>
                  <label>
                    结束日期
                    <input
                      type="date"
                      value={before}
                      onChange={(e) => setBefore(e.target.value)}
                    />
                  </label>
                  <button
                    className="text-button"
                    onClick={() => {
                      setFilterEvent("");
                      setFilterLabel("");
                      setFilterSentiment("");
                      setFilterSentimentStatus("");
                      setFilterStatus("");
                      setFilterHandling("");
                      setAfter("");
                      setBefore("");
                    }}
                  >
                    重置
                  </button>
                </section>
                <div className="section-title">
                  <h2>
                    {view === "mine"
                      ? "我的评论"
                      : view === "favorites"
                        ? "已收藏的评论"
                        : "评论与跟进"}
                  </h2>
                  <span className="muted">{total} 条匹配 · 按发布时间倒序</span>
                </div>
              </>
            )}
            <div className="notes-list">{notes.map(noteCard)}</div>
            {notes.length === 0 && (
              <div className="empty">
                <span>↗</span>
                <h3>
                  {view === "event"
                    ? "成为第一个分享体验的人"
                    : view === "favorites"
                      ? "重要的反馈，值得收藏"
                      : "这里暂时没有评论"}
                </h3>
                <p>
                  {view === "favorites"
                    ? "在评论下点击 ☆ 收藏，就能在这里找到它。"
                    : "发布一条英文活动评论，查看真实运行的情绪分析。"}
                </p>
                {view !== "event" && (
                  <button
                    className="secondary"
                    onClick={() => navigate("events")}
                  >
                    去发现活动 ↗
                  </button>
                )}
              </div>
            )}
            {total > 12 && (
              <div className="pagination">
                <button
                  disabled={page === 1}
                  onClick={() => setPage((x) => x - 1)}
                >
                  ← 上一页
                </button>
                <span>
                  {page} / {Math.ceil(total / 12)}
                </span>
                <button
                  disabled={page >= Math.ceil(total / 12)}
                  onClick={() => setPage((x) => x + 1)}
                >
                  下一页 →
                </button>
              </div>
            )}
          </>
        )}
      </main>
      <footer className="footer">
        <div>
          <Mark small />
          <span>
            CAMPUS NOTES <span className="muted">/ 校园回声</span>
          </span>
        </div>
        <span className={"worker-state " + (ready ? "online" : "")}>
          <i />
          {ready ? "两套 CPU 模型服务在线" : "模型服务准备中"}
        </span>
        <span className="muted">DML · PUBLIC DEMO · 2026</span>
      </footer>
      {notice && (
        <div className="toast" role="status">
          ✓ {notice}
        </div>
      )}
      {correcting && (
        <div
          className="modal-backdrop"
          onClick={() => !saving && setCorrecting(null)}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="correction-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="关闭纠正"
              onClick={() => setCorrecting(null)}
            >
              ×
            </button>
            <span className="eyebrow">HUMAN REVIEW</span>
            <h2 id="correction-title">添加你的判断</h2>
            <p className="muted">
              人工纠正单独保存，不覆盖模型输出，也不触发训练。可以保留空标签集合。
            </p>
            <blockquote>{correcting.text}</blockquote>
            <form onSubmit={saveCorrection}>
              <fieldset className="label-options">
                <legend>选择情绪标签</legend>
                {labels.map((l) => (
                  <label
                    key={l}
                    className={corrected.includes(l) ? "selected" : ""}
                  >
                    <input
                      type="checkbox"
                      checked={corrected.includes(l)}
                      onChange={(e) =>
                        setCorrected((x) =>
                          e.target.checked
                            ? [...x, l]
                            : x.filter((v) => v !== l),
                        )
                      }
                    />
                    {labelName(l)}
                  </label>
                ))}
              </fieldset>
              <label className="reason-label">
                纠正说明
                <textarea
                  required
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="为什么你认为这些标签更合适？"
                />
              </label>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button className="primary" disabled={saving || !reason.trim()}>
                {saving ? "保存中…" : "追加保存纠正记录"} ↗
              </button>
            </form>
          </section>
        </div>
      )}
      {history && (
        <div className="modal-backdrop" onClick={() => setHistory(null)}>
          <section
            className="modal history-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="关闭记录"
              onClick={() => setHistory(null)}
            >
              ×
            </button>
            <span className="eyebrow">A TRACE OF EVERY CHANGE</span>
            <h2 id="history-title">评论记录</h2>
            <blockquote>{history.text}</blockquote>
            <h3>分析尝试</h3>
            {history.attempts?.length ? (
              history.attempts.map((a, i) => (
                <p className="history-row" key={i}>
                  <b>
                    #{i + 1} · {statusName[a.status] || a.status}
                  </b>
                  <span>{date(a.started_at)}</span>
                </p>
              ))
            ) : (
              <p className="muted">等待首次分析。</p>
            )}
            <h3>三分类分析尝试</h3>
            {history.sentiment_attempts?.length ? (
              history.sentiment_attempts.map((a, i) => (
                <p className="history-row" key={i}>
                  <b>
                    #{i + 1} · {statusName[a.status]}
                  </b>
                  <span>{date(a.started_at)}</span>
                </p>
              ))
            ) : (
              <p className="muted">等待三分类首次分析。</p>
            )}
            <h3>人工纠正历史（情绪标签）</h3>
            {history.correction_history?.length ? (
              history.correction_history.map((c, i) => (
                <div className="history-entry" key={i}>
                  <span className="muted">
                    {c.username} · {date(c.created_at)}
                  </span>
                  <p>{c.labels.map(labelName).join(" / ") || "空标签集合"}</p>
                  <small>{c.reason}</small>
                </div>
              ))
            ) : (
              <p className="muted">还没有人工纠正。原始模型输出始终保留。</p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
