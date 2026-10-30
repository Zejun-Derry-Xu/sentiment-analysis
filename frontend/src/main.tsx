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
  negative: "Negative",
  neutral: "Neutral",
  positive: "Positive",
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
type SentimentEvaluation = {
  run_id: string;
  runtime: {
    model: string;
    revision: string;
    host_label: string;
    architecture: string;
    device: string;
    precision: string;
    batch_size: number;
    threads: number;
    interop_threads: number;
  };
  dataset: {
    repository: string;
    revision: string;
    configuration: string;
    split: string;
    rows: number;
  };
  metrics: {
    samples: number;
    official_full_test: boolean;
    accuracy: number;
    micro_f1: number;
    macro_f1: number;
    macro_recall: number;
    classification_report: Record<
      string,
      { precision: number; recall: number; "f1-score": number; support: number }
    >;
    confusion_matrix: number[][];
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
type View = "events" | "event" | "mine" | "board" | "evaluation";
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
const labelName = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
const postExamples: Record<string, string[]> = {
  "spring-sounds": [
    "The haunted house was so much fun! I loved the costumes and spooky decorations.",
    "The long queue was disappointing, but the student actors were amazing.",
  ],
  "campus-makers": [
    "The new campus food stall is delicious, and the staff are so welcoming!",
    "The vegetarian options were limited and the lunch queue was frustrating.",
  ],
  "night-run": [
    "The DSAN project feedback was clear and helped me understand the material.",
    "I am confused about the assignment requirements. Could we have more examples?",
  ],
};
const statusName: Record<string, string> = {
  pending: "Pending",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  unread: "Unread",
  viewed: "Viewed",
  processed: "Processed",
};
const date = (v: string) =>
  new Date(v).toLocaleString("en-US", {
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
    let msg = `Request failed (${r.status})`;
    try {
      const e = await r.json();
      msg =
        typeof e.detail === "string"
          ? e.detail
          : e.detail?.map((x: { msg: string }) => x.msg).join("; ") || msg;
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
function SentimentEvaluationReport({
  report,
}: {
  report: SentimentEvaluation | null;
}) {
  if (!report)
    return (
      <section aria-label="Sentiment evaluation" className="sentiment-report">
        <h2>Sentiment · Three classes</h2>
        <p className="muted">Loading the recorded official test report…</p>
      </section>
    );
  const m = report.metrics;
  const names = ["negative", "neutral", "positive"];
  return (
    <section aria-label="Sentiment evaluation" className="sentiment-report">
      <div className="section-title">
        <div>
          <span className="eyebrow">SENTIMENT / THREE CLASSES</span>
          <h2>Positive, neutral, or negative.</h2>
        </div>
        <span className="tag">Recorded local CPU evaluation</span>
      </div>
      <div className="evaluation-source">
        <div>
          <span className="eyebrow">MODEL</span>
          <strong>CardiffNLP · Twitter RoBERTa</strong>
          <span>Pretrained FP32 · Softmax + argmax</span>
        </div>
        <div>
          <span className="eyebrow">TEST DATA</span>
          <strong>TweetEval sentiment / test</strong>
          <span>
            {m.samples.toLocaleString("en-US")} labeled samples · Full official
            split
          </span>
        </div>
        <a
          href={"https://huggingface.co/" + report.runtime.model}
          target="_blank"
          rel="noreferrer"
        >
          View model source ↗
        </a>
      </div>
      <div className="metric-grid">
        {[
          ["Accuracy", m.accuracy, "Exactly one sentiment per text"],
          ["Macro-F1", m.macro_f1, "Equal weight for all three classes"],
          [
            "Macro-Recall",
            m.macro_recall,
            "Official TweetEval sentiment metric",
          ],
        ].map(([label, value, note]) => (
          <div className="metric-card" key={String(label)}>
            <span>{label}</span>
            <strong>{(Number(value) * 100).toFixed(2)}%</strong>
            <small>{note}</small>
          </div>
        ))}
      </div>
      <p className="fineprint muted">
        Micro-F1: {(m.micro_f1 * 100).toFixed(2)}% (equals accuracy for this
        single-label task). Measured on {report.runtime.host_label}. This is a
        saved test run, separate from live forum statistics.
      </p>
      <div className="table-wrap">
        <table>
          <caption className="table-caption">
            Per-class results · All three classes included
          </caption>
          <thead>
            <tr>
              <th>Sentiment</th>
              <th>Precision</th>
              <th>Recall</th>
              <th>F1</th>
              <th>Support</th>
            </tr>
          </thead>
          <tbody>
            {names.map((label) => {
              const c = m.classification_report[label];
              return (
                <tr key={label}>
                  <td>{sentiments[label]}</td>
                  <td>{c.precision.toFixed(3)}</td>
                  <td>{c.recall.toFixed(3)}</td>
                  <td>
                    <b>{c["f1-score"].toFixed(3)}</b>
                  </td>
                  <td>{c.support.toLocaleString("en-US")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="report-downloads">
        <a href="/api/sentiment/evaluation/download" download>
          Download sentiment report ↓
        </a>
        <a
          href="https://github.com/Zejun-Derry-Xu/sentiment-analysis/blob/5d45a4c/docs/results/cardiff-cpu-local/predictions.jsonl"
          target="_blank"
          rel="noreferrer"
        >
          View saved predictions ↗
        </a>
      </div>
      <details className="evaluation-details">
        <summary>Confusion matrix and reproducibility</summary>
        <div className="table-wrap">
          <table>
            <caption className="table-caption">
              Rows: true sentiment · Columns: predicted sentiment
            </caption>
            <thead>
              <tr>
                <th>True / Predicted</th>
                {names.map((l) => (
                  <th key={l}>{sentiments[l]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {names.map((l, i) => (
                <tr key={l}>
                  <td>{sentiments[l]}</td>
                  {m.confusion_matrix[i].map((n, j) => (
                    <td key={j}>{n.toLocaleString("en-US")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="evaluation-provenance">
          <dt>Model revision</dt>
          <dd>
            <code>{report.runtime.revision}</code>
          </dd>
          <dt>Dataset revision</dt>
          <dd>
            <code>{report.dataset.revision}</code>
          </dd>
          <dt>Evaluation run</dt>
          <dd>
            <code>{report.run_id}</code>
          </dd>
          <dt>Runtime</dt>
          <dd>
            {report.runtime.device.toUpperCase()} · {report.runtime.precision} ·{" "}
            {report.runtime.architecture} · Batch {report.runtime.batch_size} ·
            Threads {report.runtime.threads}/{report.runtime.interop_threads}
          </dd>
          <dt>Protocol</dt>
          <dd>
            All {m.samples.toLocaleString("en-US")} test samples; fixed
            pretrained weights and author preprocessing; no training, tuning, or
            sample selection.
          </dd>
        </dl>
      </details>
    </section>
  );
}

const emotionEmoji: Record<string, string> = {
  admiration: "🤩",
  amusement: "😂",
  anger: "😠",
  annoyance: "😒",
  approval: "👍",
  caring: "🫶",
  confusion: "😕",
  curiosity: "🧐",
  desire: "🤞",
  disappointment: "😞",
  disapproval: "👎",
  disgust: "🤢",
  embarrassment: "🫣",
  excitement: "🥳",
  fear: "😨",
  gratitude: "🙏",
  grief: "💔",
  joy: "😄",
  love: "🥰",
  nervousness: "😬",
  optimism: "🌈",
  pride: "🏅",
  realization: "💡",
  relief: "😌",
  remorse: "😔",
  sadness: "😢",
  surprise: "😮",
  neutral: "😐",
};
function EmotionSticker({
  analysis,
  text,
}: {
  analysis: Analysis;
  text: string;
}) {
  const [open, setOpen] = useState(false),
    [preview, setPreview] = useState<string | null>(null),
    [burst, setBurst] = useState(0);
  const root = useRef<HTMLDivElement>(null),
    hold = useRef<ReturnType<typeof setTimeout> | null>(null),
    origin = useRef({ x: 0, y: 0 });
  const eligible = analysis.labels.filter((l) => Boolean(emotionEmoji[l]));
  const label =
    preview && eligible.includes(preview)
      ? preview
      : eligible.includes(analysis.top_label)
        ? analysis.top_label
        : eligible[0];
  function cancelHold() {
    if (hold.current) {
      clearTimeout(hold.current);
      hold.current = null;
    }
  }
  useEffect(() => {
    setPreview(null);
    setOpen(false);
  }, [analysis.id]);
  useEffect(() => () => cancelHold(), []);
  useEffect(() => {
    if (!open) return;
    function outside(e: PointerEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div className="mood-post" ref={root}>
      <div
        className="mood-text"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          cancelHold();
          origin.current = { x: e.clientX, y: e.clientY };
          hold.current = setTimeout(() => {
            setOpen(true);
            hold.current = null;
          }, 480);
        }}
        onPointerMove={(e) => {
          if (
            Math.hypot(
              e.clientX - origin.current.x,
              e.clientY - origin.current.y,
            ) > 10
          )
            cancelHold();
        }}
        onPointerUp={cancelHold}
        onPointerCancel={cancelHold}
        onPointerLeave={cancelHold}
        onContextMenu={(e) => {
          if (open) e.preventDefault();
        }}
      >
        <p className="comment-text" lang="en">
          {text}
        </p>
      </div>
      <div className="mood-bar">
        <span className="mood-caption">MODEL EMOTION</span>
        {label ? (
          <button
            className="mood-stamp"
            key={analysis.id + label + burst}
            aria-label={
              "Model emotion: " +
              labelName(label) +
              ". Show predicted emoji stickers"
            }
            aria-expanded={open}
            onClick={() => {
              setOpen((v) => !v);
              setBurst((v) => v + 1);
            }}
            title={
              labelName(label) +
              " · model score " +
              analysis.scores[label].toFixed(3)
            }
          >
            <span className="mood-emoji" aria-hidden="true">
              {emotionEmoji[label]}
            </span>
            <span>{labelName(label)}</span>
            <span className="mood-spark" aria-hidden="true">
              ✦
            </span>
          </button>
        ) : (
          <span className="mood-empty">No emotion above the threshold</span>
        )}
        <button
          className="mood-more"
          aria-label="Show model emotion stickers"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          ⌁ <span>View moods</span>
        </button>
      </div>
      {open && (
        <div
          className="mood-palette"
          role="group"
          aria-label="Model emotion stickers"
        >
          <div className="mood-palette-title">
            Model predictions{" "}
            <button
              aria-label="Close mood stickers"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          {eligible.length ? (
            <>
              <div className="mood-options">
                {eligible.map((l, i) => (
                  <button
                    key={l}
                    style={{ animationDelay: `${i * 45}ms` }}
                    className={label === l ? "selected" : ""}
                    aria-pressed={label === l}
                    aria-label={"Preview " + labelName(l) + " sticker"}
                    onClick={() => {
                      setPreview(l);
                      setBurst((v) => v + 1);
                      setOpen(false);
                    }}
                  >
                    <span aria-hidden="true">{emotionEmoji[l]}</span>
                    <small>{labelName(l)}</small>
                    <b>{analysis.scores[l].toFixed(3)}</b>
                  </button>
                ))}
              </div>
              <p>
                Tap a predicted mood to replay the sticker. This is a model
                result, not a user reaction.
              </p>
            </>
          ) : (
            <p>No label scored above 0.5. No emoji is assigned.</p>
          )}
        </div>
      )}
    </div>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null),
    [checking, setChecking] = useState(true),
    [username, setUsername] = useState(""),
    [loginBusy, setLoginBusy] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [view, setView] = useState<View>("events"),
    [events, setEvents] = useState<Event[]>([]),
    [selected, setSelected] = useState<Event | null>(null);
  const [stats, setStats] = useState<Stats>({
      total: 0,
      completed: 0,
      waiting: 0,
      unread: 0,
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
  const [sentimentEvaluation, setSentimentEvaluation] =
    useState<SentimentEvaluation | null>(null);
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
          const [ev, bb, se] = await Promise.all([
            api<Evaluation[]>("/api/evaluations"),
            api<Bench[]>("/api/benchmarks"),
            api<SentimentEvaluation>("/api/sentiment/evaluation"),
          ]);
          if (active) {
            setEvaluations(ev);
            setBenches(bb);
            setSentimentEvaluation(se);
          }
        } else if (view !== "events") {
          const q = new URLSearchParams({
            page: String(page),
            page_size: "12",
          });
          if (view === "event" && selected) q.set("event_id", selected.id);
          if (view === "mine") q.set("mine", "true");
          if (["board", "mine"].includes(view)) {
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
      setNotice("Post saved. Both analyses are queued.");
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
      setNotice(
        "Review saved separately. Original model results are unchanged.",
      );
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
              {view !== "event" ? " · " + n.event_title : ""}
            </span>
          </div>
          <span className={"status " + n.status}>
            <i />
            {statusName[n.status]}
          </span>
        </div>
        {n.analysis ? (
          <EmotionSticker analysis={n.analysis} text={n.text} />
        ) : (
          <p className="comment-text" lang="en">
            {n.text}
          </p>
        )}
        {n.analysis ? (
          <div className="analysis">
            <div className="analysis-heading">
              <span className="eyebrow">TEXT EMOTION</span>
              <span className="muted">
                {ms(n.analysis.inference_ms)} · {n.analysis.token_count} tokens
                {n.analysis.truncated ? " · Truncated to 512 tokens" : ""}
              </span>
            </div>
            <div className="top-emotion">
              <span>Highest-scoring emotion</span>
              <strong>{labelName(n.analysis.top_label)}</strong>
              <span className="score" title="Model scores are not calibrated">
                Model score {n.analysis.top_score.toFixed(3)}
              </span>
            </div>
            <div className="label-row">
              <span className="muted">Labels above 0.5</span>
              {n.analysis.labels.length ? (
                n.analysis.labels.map((l) => (
                  <span className={"tag emotion-" + l} key={l}>
                    {labelName(l)}
                  </span>
                ))
              ) : (
                <span className="tag">No labels above the threshold</span>
              )}
            </div>
            <details>
              <summary>View all 28 emotion scores</summary>
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
                Model score is not a psychological measurement; labels require
                score &gt; 0.5.
              </p>
            </details>
          </div>
        ) : (
          <div className={"analysis pending-message " + n.status}>
            {n.status === "failed" ? (
              <>
                <strong>Emotion analysis unavailable</strong>
                <span>
                  Your post is safe. Retry analysis; previous attempts are
                  retained.
                </span>
              </>
            ) : (
              <>
                <span className="pulse" />
                <span>
                  {n.status === "processing"
                    ? "Analyzing the emotions expressed in this post…"
                    : "Post saved. Emotion analysis is queued."}
                </span>
              </>
            )}
          </div>
        )}
        <div className="analysis sentiment-analysis">
          <div className="analysis-heading">
            <span className="eyebrow">TEXT SENTIMENT · THREE CLASSES</span>
            <span className={"status " + n.sentiment_status}>
              {statusName[n.sentiment_status]}
            </span>
          </div>
          {n.sentiment ? (
            <>
              <div
                className={"sentiment-winner sentiment-" + n.sentiment.label}
              >
                {sentiments[n.sentiment.label]}
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
                Model score · Single-label sentiment, independent of multi-label
                emotion. Inference {ms(n.sentiment.inference_ms)} · Queue{" "}
                {ms(n.sentiment.queue_ms)}
              </p>
            </>
          ) : (
            <p className="muted">
              {n.sentiment_status === "failed"
                ? n.sentiment_error ||
                  "Sentiment analysis failed. Your post is saved."
                : "Post saved. Sentiment analysis is queued."}
            </p>
          )}
          {n.sentiment_status === "failed" && (
            <button
              className="text-button"
              onClick={() =>
                void act(`/api/comments/${n.id}/sentiment/retry`, "POST")
              }
            >
              Retry sentiment ↻
            </button>
          )}
        </div>
        {n.status === "failed" && (
          <button
            className="text-button"
            onClick={() => void act(`/api/comments/${n.id}/retry`, "POST")}
          >
            Retry emotion ↻
          </button>
        )}
        {n.correction && (
          <div className="correction">
            <span className="eyebrow">HUMAN REVIEW · SEPARATE RECORD</span>
            <p>
              {n.correction.labels.length
                ? n.correction.labels.map(labelName).join(" / ")
                : "No emotion labels"}
            </p>
            <span className="muted">
              {n.correction.reason} · {n.correction.username}
            </span>
          </div>
        )}
        {adminMode && (
          <div className="note-actions">
            <label className="handling-label">
              Handling status
              <select
                aria-label="Post handling status"
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
            {n.analysis && (
              <button className="text-button" onClick={() => openCorrection(n)}>
                Human review
              </button>
            )}
            <button className="text-button" onClick={() => void showHistory(n)}>
              History ↗
            </button>
          </div>
        )}
      </article>
    );
  }
  if (checking)
    return (
      <div className="loading">
        <Mark />
        <p>Opening Campus Forum…</p>
      </div>
    );
  if (!user)
    return (
      <main className="welcome">
        <section className="welcome-art">
          <div className="wordmark">
            <Mark />
            <span>CAMPUS FORUM</span>
          </div>
          <div className="welcome-copy">
            <span className="eyebrow">LISTEN TO YOUR CAMPUS</span>
            <h1>
              Your voice,
              <br />
              your campus<span>.</span>
            </h1>
            <p>
              Share what campus life feels like,
              <br />
              one conversation at a time.
            </p>
          </div>
          <div className="welcome-decoration">
            <div className="floating-note one">
              <span>HALLOWEEN NIGHT</span>
              <p>
                “The haunted house was incredible.
                <br />I loved every spooky moment!”
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
            <h2>Join the conversation.</h2>
            <p className="muted">Choose a display name to start posting.</p>
            <label htmlFor="username">Your name</label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={32}
              required
              placeholder="e.g. Alex"
              autoComplete="nickname"
            />
            <button
              className="primary"
              disabled={loginBusy || !username.trim()}
            >
              {loginBusy ? "Joining…" : "Enter Campus Forum"} <span>↗</span>
            </button>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="demo-notice">
              <strong>No password · Public demo</strong>
              <p>
                Anyone can switch to the admin dashboard in this demo. Display
                names do not verify identity.
              </p>
            </div>
            <p className="fineprint muted">
              English posts only. Models analyze text, not mental health. No
              automatic moderation.
            </p>
          </form>
          <span className="login-footer">
            GOEMOTIONS + CARDIFFNLP · RUNNING ON CPU
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
            <b>FORUM</b>
          </span>
        </a>
        <nav aria-label="Main navigation">
          {(
            [
              ["events", "Forum"],
              ["mine", "My Posts"],
              ["evaluation", "Evaluation"],
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
            </button>
          ))}
        </nav>
        <div className="user">
          <button
            className={"admin-switch " + (adminMode ? "is-admin" : "")}
            aria-pressed={adminMode}
            onClick={() => {
              const next = !adminMode;
              setAdminMode(next);
              navigate(next ? "board" : "events");
            }}
          >
            {adminMode ? "Switch to Student" : "Switch to Admin"}
          </button>
          <span className="avatar">
            {user.username.slice(0, 1).toUpperCase()}
          </span>
          <span className="user-name">{user.username}</span>
          <button
            title="Signing out ends this browser identity. Reusing a name will not restore it."
            className="text-button"
            onClick={async () => {
              await api("/api/session", { method: "DELETE" });
              setUser(null);
              setAdminMode(false);
              navigate("events");
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="demo-banner">
        <span>
          <i />
          Public demo · Admin tools are open to every visitor
        </span>
        <span>
          English text analysis only <span className="banner-divider">/</span>{" "}
          Not a mental-health or moderation decision
        </span>
      </div>
      <main className="container">
        {error && (
          <div className="error global-error" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="Dismiss error">
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
                  Your campus.
                  <br />
                  Your conversation<span>.</span>
                </h1>
                <p>
                  Talk about Halloween, campus food, and DSAN.
                  <br />
                  Share an experience. Ask a question. Start something better.
                </p>
                <button
                  className="secondary"
                  onClick={() =>
                    document
                      .getElementById("forum-boards")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                >
                  Explore the boards <span>↗</span>
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
                <h2>Find your conversation</h2>
              </div>
              <span className="muted">03 demo boards · Real analysis</span>
            </div>
            <div
              className="event-grid"
              id="forum-boards"
              aria-label="Forum boards"
            >
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
                    <span className="event-date">DISCUSS</span>
                    <div className="event-shape" />
                    <span className="event-art-title">
                      {["AFTER\nDARK.", "CAMPUS\nBITES.", "DSAN\nVOICE."][i]}
                    </span>
                  </div>
                  <div className="event-info">
                    <span className="eyebrow">{e.category}</span>
                    <h3>{e.title}</h3>
                    <p>{e.description}</p>
                    <div className="event-meta">
                      <span>{e.location}</span>
                      <span>
                        {e.comment_count} posts <b>↗</b>
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <section className="principles">
              <span className="eyebrow">A NOTE ON EMOTION</span>
              <h3>A little context goes a long way.</h3>
              <p>
                Models identify emotions expressed in English text, not a
                person’s inner state. Multiple emotions may appear together, and
                no label may exceed the threshold.
              </p>
            </section>
          </>
        ) : view === "evaluation" ? (
          <>
            <div className="page-heading">
              <span className="eyebrow">MEASURE, DON'T GUESS</span>
              <h1>Results you can inspect.</h1>
              <p>
                Fixed models and official test sets. Quality and runtime
                performance are reported separately.
              </p>
              <p className="fineprint muted">
                Emotion and sentiment use different official datasets and tasks.
                Their scores are not directly comparable; live forum
                distributions are not accuracy measurements.
              </p>
            </div>
            <SentimentEvaluationReport report={sentimentEvaluation} />
            <div className="section-title emotion-evaluation-heading">
              <div>
                <span className="eyebrow">EMOTION / 28 LABELS</span>
                <h2>Emotions expressed in text.</h2>
              </div>
              <span className="tag">GoEmotions evaluation</span>
            </div>
            <div className="evaluation-source">
              <div>
                <span className="eyebrow">MODEL</span>
                <strong>RoBERTa · GoEmotions INT8</strong>
                <span>CPU ONNX · 28 labels · score &gt; 0.5</span>
              </div>
              <div>
                <span className="eyebrow">TEST DATA</span>
                <strong>GoEmotions simplified / test</strong>
                <span>
                  5,427 labeled samples · Separate from posts and human reviews
                </span>
              </div>
              <a
                href="https://huggingface.co/SamLowe/roberta-base-go_emotions-onnx"
                target="_blank"
                rel="noreferrer"
              >
                View model source ↗
              </a>
            </div>
            {evaluations.length > 0 && (
              <label className="run-picker">
                Evaluation run
                <select
                  value={activeEvaluation?.id || ""}
                  onChange={(e) => setEvaluationId(e.target.value)}
                >
                  {evaluations.map((e) => (
                    <option key={e.id} value={e.id}>
                      {date(e.created_at)} ·{" "}
                      {e.official ? "Full official test" : "Partial smoke test"}{" "}
                      · {statusName[e.status] || e.status}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!activeEvaluation ? (
              <div className="empty">
                <span>◎</span>
                <h3>No official evaluation yet</h3>
                <p>
                  Metrics and saved predictions appear here after evaluation.
                </p>
              </div>
            ) : activeEvaluation.status !== "completed" ? (
              <div className="empty">
                <span>◎</span>
                <h3>
                  {statusName[activeEvaluation.status] ||
                    activeEvaluation.status}
                </h3>
                <p>
                  Processed {activeEvaluation.processed} /{" "}
                  {activeEvaluation.total} samples. This page refreshes
                  automatically.
                </p>
              </div>
            ) : (
              activeEvaluation.metrics && (
                <>
                  <div className="section-title">
                    <h2>
                      {activeEvaluation.official
                        ? "Official full-test results"
                        : "Partial smoke results · Not the full official test"}
                    </h2>
                    <span className="muted">
                      {activeEvaluation.total.toLocaleString()} samples · All 28
                      labels
                    </span>
                  </div>
                  <div className="metric-grid">
                    {[
                      [
                        "Micro-F1",
                        activeEvaluation.metrics.micro_f1,
                        "Overall label prediction",
                      ],
                      [
                        "Macro-F1",
                        activeEvaluation.metrics.macro_f1,
                        "Equal weight for all 28 labels",
                      ],
                      [
                        "Exact-match accuracy",
                        activeEvaluation.metrics.exact_match_accuracy,
                        "Entire label set matches",
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
                            ? "Download metrics"
                            : f === "predictions.jsonl"
                              ? "Download predictions"
                              : "Download run metadata"}{" "}
                          ↓
                        </a>
                      ),
                    )}
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Emotion label</th>
                          <th>Precision</th>
                          <th>Recall</th>
                          <th>F1</th>
                          <th>Support</th>
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
                    A multi-label sample can contribute to several classes.
                    Exact-match requires every predicted label to match the
                    reference set; it is not mean per-label accuracy.
                  </p>
                </>
              )
            )}
            <div className="section-title">
              <div>
                <span className="eyebrow">ON THIS MACHINE</span>
                <h2>Measured CPU performance</h2>
              </div>
              <span className="muted">
                Measured separately from author reports
              </span>
            </div>
            {benchmark ? (
              <>
                <div className="metric-grid">
                  <div className="metric-card">
                    <span>Warm inference p50 / p95</span>
                    <strong className="compact-number">
                      {ms(benchmark.model_inference_ms.p50)} /{" "}
                      {ms(benchmark.model_inference_ms.p95)}
                    </strong>
                    <small>
                      {benchmark.samples} samples · Batch 1 · 20 warmups
                    </small>
                  </div>
                  <div className="metric-card">
                    <span>Model load / First inference</span>
                    <strong className="compact-number">
                      {ms(benchmark.runtime.model_load_ms)} /{" "}
                      {ms(benchmark.runtime.first_inference_ms)}
                    </strong>
                    <small>Cached loading; excludes downloads</small>
                  </div>
                  <div className="metric-card">
                    <span>Process memory / CPU</span>
                    <strong className="compact-number">
                      {benchmark.rss_mb.max.toFixed(0)} MB /{" "}
                      {benchmark.process_cpu_percent.mean.toFixed(0)}%
                    </strong>
                    <small>Sampled max RSS / Mean CPU (100% = one core)</small>
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>API concurrency</th>
                        <th>Completion p50 / p95</th>
                        <th>Queue p95</th>
                        <th>Inference p95</th>
                        <th>Throughput</th>
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
                          <td>{c.throughput_per_second.toFixed(2)} posts/s</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="fineprint muted">
                  Hardware: {benchmark.runtime.platform} /{" "}
                  {benchmark.runtime.architecture}; ORT threads{" "}
                  {benchmark.runtime.intra_threads}/
                  {benchmark.runtime.inter_threads}; Container CPU quota{" "}
                  {benchmark.runtime.cpu_limit}. Local container results do not
                  establish Jetstream2 performance.
                </p>
              </>
            ) : (
              <div className="empty compact">
                <p>No completed emotion-only benchmark yet.</p>
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
                  ← Back to forum
                </button>
                <div className="event-heading">
                  <div>
                    <span className="eyebrow">{selected.category}</span>
                    <h1>{selected.title}</h1>
                    <p>{selected.description}</p>
                    <span className="muted">
                      {selected.location} · Open discussion
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
                    <h3>Start a discussion</h3>
                    <span className="tag">ENGLISH ONLY</span>
                  </div>
                  <textarea
                    aria-label="English post"
                    value={text}
                    onChange={(e) => editText(e.target.value)}
                    maxLength={2000}
                    required
                    placeholder="Share an experience, ask a question, or suggest an improvement…"
                    rows={4}
                  />
                  <div className="composer-bottom">
                    <span className={hasCjk ? "language-warning" : "muted"}>
                      {hasCjk
                        ? "These models support English only. Please write your post in English."
                        : "Your post is saved before analysis. Emotion never triggers automatic removal."}
                      <small>{text.length} / 2000</small>
                    </span>
                    <button
                      className="primary"
                      disabled={sending || !text.trim() || hasCjk}
                    >
                      {sending ? "Saving…" : "Publish post"} <span>↗</span>
                    </button>
                  </div>
                  <div className="examples">
                    <span>Try a prompt:</span>
                    {(postExamples[selected.id] || []).map((s) => (
                      <button type="button" key={s} onClick={() => editText(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                </form>
                <div className="section-title">
                  <h2>Discussion</h2>
                  <span className="muted">
                    {total} posts · Analysis updates automatically
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="page-heading">
                  <span className="eyebrow">
                    {view === "mine"
                      ? "YOUR WORDS, YOUR EXPERIENCE"
                      : "FROM FEEDBACK TO FOLLOW-UP"}
                  </span>
                  <h1>
                    {view === "mine"
                      ? "Your posts, all together."
                      : "Understand the feedback."}
                  </h1>
                  <p>
                    {view === "mine"
                      ? "Posts and analysis submitted from this browser identity."
                      : "Emotion labels describe text, not misconduct or a person’s mental state."}
                  </p>
                </div>
                {view === "board" && (
                  <>
                    {" "}
                    <div className="stats-grid">
                      {[
                        ["All posts", stats.total, "01"],
                        ["Both analyses complete", stats.completed, "02"],
                        ["Pending / Processing", stats.waiting, "03"],
                        ["Unread", stats.unread, "04"],
                      ].map(([t, n, i]) => (
                        <div key={String(t)}>
                          <span>{t}</span>
                          <strong>{String(n).padStart(2, "0")}</strong>
                          <small>{i}</small>
                        </div>
                      ))}
                    </div>
                    <section
                      className="dual-distributions"
                      aria-label="Model distributions"
                    >
                      <div className="distribution-panel">
                        <span className="eyebrow">
                          SENTIMENT · POST DISTRIBUTION
                        </span>
                        <p className="fineprint muted">
                          All non-benchmark posts · Completed{" "}
                          {stats.sentiment_completed || 0} posts
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
                        <span className="eyebrow">
                          EMOTION · THRESHOLD LABELS
                        </span>
                        <p className="fineprint muted">
                          Original predictions · A post can have multiple labels
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
                            <span className="muted">
                              Emotion counts appear after analysis.
                            </span>
                          )}
                        </div>
                      </div>
                    </section>
                  </>
                )}
                <section className="filters" aria-label="Post filters">
                  <label>
                    Board
                    <select
                      value={filterEvent}
                      onChange={(e) => setFilterEvent(e.target.value)}
                    >
                      <option value="">All boards</option>
                      {events.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Emotion
                    <select
                      value={filterLabel}
                      onChange={(e) => setFilterLabel(e.target.value)}
                    >
                      <option value="">All emotions</option>
                      {labels.map((l) => (
                        <option key={l} value={l}>
                          {labelName(l)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Emotion status
                    <select
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                    >
                      <option value="">All statuses</option>
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
                    Sentiment
                    <select
                      value={filterSentiment}
                      onChange={(e) => setFilterSentiment(e.target.value)}
                    >
                      <option value="">All sentiments</option>
                      {Object.entries(sentiments).map(([l, n]) => (
                        <option key={l} value={l}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Sentiment status
                    <select
                      value={filterSentimentStatus}
                      onChange={(e) => setFilterSentimentStatus(e.target.value)}
                    >
                      <option value="">All statuses</option>
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
                    Handling status
                    <select
                      value={filterHandling}
                      onChange={(e) => setFilterHandling(e.target.value)}
                    >
                      <option value="">All handling statuses</option>
                      {["unread", "viewed", "processed"].map((s) => (
                        <option key={s} value={s}>
                          {statusName[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    From date
                    <input
                      type="date"
                      value={after}
                      onChange={(e) => setAfter(e.target.value)}
                    />
                  </label>
                  <label>
                    To date
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
                    Reset
                  </button>
                </section>
                <div className="section-title">
                  <h2>{view === "mine" ? "My Posts" : "Posts & follow-up"}</h2>
                  <span className="muted">
                    {total} matching posts · Newest first
                  </span>
                </div>
              </>
            )}
            <div className="notes-list">{notes.map(noteCard)}</div>
            {notes.length === 0 && (
              <div className="empty">
                <span>↗</span>
                <h3>
                  {view === "event" ? "Be the first to post" : "No posts yet"}
                </h3>
                <p>{"Publish an English post to see both models in action."}</p>
                {view !== "event" && (
                  <button
                    className="secondary"
                    onClick={() => navigate("events")}
                  >
                    Explore the forum ↗
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
                  ← Previous
                </button>
                <span>
                  {page} / {Math.ceil(total / 12)}
                </span>
                <button
                  disabled={page >= Math.ceil(total / 12)}
                  onClick={() => setPage((x) => x + 1)}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </main>
      <footer className="footer">
        <div>
          <Mark small />
          <span>CAMPUS FORUM</span>
        </div>
        <span className={"worker-state " + (ready ? "online" : "")}>
          <i />
          {ready ? "Both CPU model services online" : "Model services starting"}
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
              aria-label="Close review"
              onClick={() => setCorrecting(null)}
            >
              ×
            </button>
            <span className="eyebrow">HUMAN REVIEW</span>
            <h2 id="correction-title">Add your review</h2>
            <p className="muted">
              Human reviews are saved separately, never overwrite model results,
              and never trigger training. An empty label set is allowed.
            </p>
            <blockquote>{correcting.text}</blockquote>
            <form onSubmit={saveCorrection}>
              <fieldset className="label-options">
                <legend>Choose emotion labels</legend>
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
                Review reason
                <textarea
                  required
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why do you think these labels fit better?"
                />
              </label>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button className="primary" disabled={saving || !reason.trim()}>
                {saving ? "Saving…" : "Save separate review"} ↗
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
              aria-label="Close history"
              onClick={() => setHistory(null)}
            >
              ×
            </button>
            <span className="eyebrow">A TRACE OF EVERY CHANGE</span>
            <h2 id="history-title">Post history</h2>
            <blockquote>{history.text}</blockquote>
            <h3>Emotion attempts</h3>
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
              <p className="muted">Waiting for the first emotion analysis.</p>
            )}
            <h3>Sentiment attempts</h3>
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
              <p className="muted">Waiting for the first sentiment analysis.</p>
            )}
            <h3>Human review history (emotion labels)</h3>
            {history.correction_history?.length ? (
              history.correction_history.map((c, i) => (
                <div className="history-entry" key={i}>
                  <span className="muted">
                    {c.username} · {date(c.created_at)}
                  </span>
                  <p>
                    {c.labels.map(labelName).join(" / ") || "No emotion labels"}
                  </p>
                  <small>{c.reason}</small>
                </div>
              ))
            ) : (
              <p className="muted">
                No human reviews yet. Original model outputs are always
                preserved.
              </p>
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
