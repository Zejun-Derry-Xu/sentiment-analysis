import React, { useEffect, useRef, useState } from "react";

const ENDPOINT = "/api/admin/load-runs";
const SAMPLE_COUNT = 100;
const CONCURRENCY = 16;

type Attempt = {
  status: string;
  started_at: string;
  finished_at: string | null;
  queue_ms: number | null;
  inference_ms: number | null;
  service_queue_ms?: number;
};
type Sample = {
  sample: number;
  http_ms: number | null;
  completion_ms: number | null;
  submit_error: "timeout" | "request_failed" | null;
  comment_id: string | null;
  created_at: string | null;
  emotion_status: string | null;
  sentiment_status: string | null;
  emotion: Attempt[] | null;
  sentiment: Attempt[] | null;
};
type Run = {
  id: string;
  created_at: string;
  expires_at: string;
  phase: "open" | "clearing" | "cleared";
};
type Report = Run & { samples: Sample[]; target: number };
type Measurement = {
  sample: number;
  http_ms: number;
  error: Sample["submit_error"];
};
type Mode = "completion" | "http";
const stamp = (value: string) => new Date(value).getTime();
const duration = (ms: number) =>
  ms >= 1000 ? (ms / 1000).toFixed(2) + " s" : ms.toFixed(1) + " ms";
const completed = (sample: Sample) =>
  sample.emotion_status === "completed" &&
  sample.sentiment_status === "completed";
function completionTime(sample: Sample) {
  const emotion = sample.emotion
    ?.filter((a) => a.status === "completed")
    .at(-1)?.finished_at;
  const sentiment = sample.sentiment
    ?.filter((a) => a.status === "completed")
    .at(-1)?.finished_at;
  return emotion && sentiment
    ? Math.max(stamp(emotion), stamp(sentiment))
    : null;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const r = await fetch(ENDPOINT + path, options);
  const body = await r.json();
  if (!r.ok)
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : `Request failed (${r.status}).`,
    );
  return body;
}

function LatencyChart({
  samples,
  mode,
  pick,
}: {
  samples: Sample[];
  mode: Mode;
  pick: (id: number) => void;
}) {
  const rows = samples
    .flatMap((s) => {
      const ms =
        mode === "http"
          ? s.submit_error
            ? null
            : s.http_ms
          : completed(s)
            ? s.completion_ms
            : null;
      return ms === null ? [] : [{ sample: s.sample, ms }];
    })
    .sort((a, b) => a.ms - b.ms || a.sample - b.sample);
  if (!rows.length)
    return <p className="muted">Waiting for measured samples…</p>;

  const first = Math.max(0.001, rows[0].ms);
  const last = Math.max(first, rows[rows.length - 1].ms);
  const low = Math.floor(Math.log10(first)) - (first === last ? 1 : 0);
  const high = Math.max(low + 1, Math.ceil(Math.log10(last)));
  const ticks = Array.from(
    { length: high - low + 1 },
    (_, i) => 10 ** (low + i),
  );
  const left = 86,
    right = 930,
    top = 128,
    bottom = 395;
  const x = (i: number) => left + ((i + 0.5) * (right - left)) / rows.length;
  const y = (ms: number) =>
    bottom -
    (Math.max(0, Math.log10(Math.max(0.001, ms)) - low) / (high - low)) *
      (bottom - top);
  const percentiles = [50, 95, 99].map((p) => {
    const rank = Math.ceil((rows.length * p) / 100);
    return { p, rank, ...rows[rank - 1] };
  });
  return (
    <>
      <p className="muted">
        {rows.length} valid samples · nearest-rank percentiles · logarithmic
        scale
      </p>
      <div className="latency-scroll">
        <svg
          viewBox="0 0 960 442"
          className="latency-chart"
          role="group"
          aria-label="Latency from fastest to slowest with p50, p95 and p99 markers"
        >
          {ticks.map((val) => (
            <g key={val}>
              <line
                x1={left}
                x2={right}
                y1={y(val)}
                y2={y(val)}
                className="latency-grid"
              />
              <text x={left - 9} y={y(val) + 4} textAnchor="end">
                {val >= 1000 ? val / 1000 + " s" : val + " ms"}
              </text>
            </g>
          ))}
          <path
            d={`M ${left} ${top} V ${bottom} H ${right}`}
            className="latency-axis"
          />
          {rows.map((row, i) => {
            const rank = (i + 1) / rows.length;
            const width = (right - left) / rows.length;
            const height = Math.max(2, bottom - y(row.ms));
            const title = `Sample ${row.sample} · rank ${i + 1} · ${duration(row.ms)}`;
            return (
              <rect
                key={row.sample}
                x={x(i) - width * 0.45}
                y={bottom - height}
                width={width * 0.9}
                height={height}
                className={
                  rank >= 0.98
                    ? "latency-red"
                    : rank >= 0.94
                      ? "latency-yellow"
                      : "latency-green"
                }
                role="button"
                tabIndex={0}
                aria-label={title}
                onClick={() => pick(row.sample)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    pick(row.sample);
                  }
                }}
              >
                <title>{title}</title>
              </rect>
            );
          })}
          {percentiles.map(({ p, rank, ms }, i) => (
            <g key={p} className="latency-marker" pointerEvents="none">
              <line
                x1={x(rank - 1)}
                x2={x(rank - 1)}
                y1={92 - i * 26}
                y2={Math.min(bottom - 3, y(ms) - 4)}
              />
              <text
                x={x(rank - 1) < 360 ? x(rank - 1) + 8 : x(rank - 1) - 8}
                y={88 - i * 26}
                textAnchor={x(rank - 1) < 360 ? "start" : "end"}
              >
                {`p${p} = ${duration(ms)} · rank ${rank} of ${rows.length}`}
              </text>
            </g>
          ))}
          <text x={(left + right) / 2} y={428} textAnchor="middle">
            Samples ordered fastest to slowest
          </text>
        </svg>
      </div>
    </>
  );
}

function SampleTrace({ sample }: { sample: Sample }) {
  const timeline = (["emotion", "sentiment"] as const).flatMap((model) =>
    (sample[model] || []).map((attempt, i) => ({
      model,
      attempt,
      ordinal: i + 1,
    })),
  );
  const events = [
    ...(sample.created_at
      ? [
          {
            at: sample.created_at,
            message: "Post accepted and both model jobs queued",
          },
        ]
      : []),
    ...timeline.flatMap(({ model, attempt }) => [
      { at: attempt.started_at, message: `${model} attempt started` },
      ...(attempt.finished_at
        ? [
            {
              at: attempt.finished_at,
              message: `${model} attempt ${attempt.status}`,
            },
          ]
        : []),
    ]),
  ].sort((a, b) => stamp(a.at) - stamp(b.at));
  return (
    <section className="distribution-panel">
      <h2>Trace · Sample {sample.sample}</h2>
      <p className="muted">{sample.comment_id || "No post ID recorded"}</p>
      <p>
        HTTP submit {sample.http_ms === null ? "—" : duration(sample.http_ms)}
        {sample.submit_error && ` · ${sample.submit_error.replace("_", " ")}`}
      </p>
      {timeline.map(({ model, attempt, ordinal }) => (
        <p key={model + ordinal}>
          <strong>
            {model} attempt {ordinal}
          </strong>{" "}
          · {attempt.status} · Database queue{" "}
          {attempt.queue_ms == null ? "—" : duration(attempt.queue_ms)}
          {attempt.service_queue_ms != null &&
            ` · Model service queue ${duration(attempt.service_queue_ms)}`}
          {" · "}Inference{" "}
          {attempt.inference_ms == null ? "—" : duration(attempt.inference_ms)}
        </p>
      ))}
      <h3>Event log</h3>
      {sample.submit_error && (
        <p>HTTP submit: {sample.submit_error.replace("_", " ")}</p>
      )}
      <ol className="trace-events">
        {events.map((event, i) => (
          <li key={i}>
            <time dateTime={event.at}>
              {new Date(event.at).toLocaleTimeString()}
            </time>{" "}
            {event.message}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function PerformanceMonitor() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [selected, select] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [mode, setMode] = useState<Mode>("completion");
  const [sample, pick] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const abortRun = useRef<AbortController | null>(null);

  useEffect(() => () => abortRun.current?.abort(), []);
  useEffect(() => {
    let active = true;
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const data = await request<{ runs: Run[]; enabled: boolean }>("");
        if (!active) return;
        setEnabled(data.enabled);
        setRuns(data.runs);
        if (!selected && data.runs[0]) select(data.runs[0].id);
        if (selected) {
          const detail = await request<Report>("/" + selected);
          if (active) setReport(detail);
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        pending = false;
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selected]);

  const headers = {
    "X-Load-Demo-Code": code,
    "Content-Type": "application/json",
  };
  async function start() {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError("");
    const controller = new AbortController();
    abortRun.current = controller;
    try {
      const run = await request<Run>("", {
        method: "POST",
        headers,
        signal: controller.signal,
      });
      select(run.id);
      pick(null);
      let next = 1;
      const measurements: Measurement[] = [];
      async function send() {
        while (next <= SAMPLE_COUNT && !controller.signal.aborted) {
          const n = next++;
          const started = performance.now();
          let failure: Sample["submit_error"] = null;
          try {
            await request(`/${run.id}/samples/${n}`, {
              method: "POST",
              headers,
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(10000),
              ]),
            });
          } catch (e) {
            failure =
              e instanceof DOMException && e.name === "TimeoutError"
                ? "timeout"
                : "request_failed";
          }
          measurements.push({
            sample: n,
            http_ms: performance.now() - started,
            error: failure,
          });
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, send));
      if (!controller.signal.aborted)
        await request(`/${run.id}/measurements`, {
          method: "PUT",
          headers,
          body: JSON.stringify(measurements),
          signal: controller.signal,
        });
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function clear() {
    setError("");
    try {
      const response = await request<{ phase: Run["phase"] }>("/" + selected, {
        method: "DELETE",
        headers,
      });
      abortRun.current?.abort();
      setReport((old) =>
        old && old.id === selected ? { ...old, phase: response.phase } : old,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const current = report?.id === selected ? report : null;
  const rows = current?.samples || [];
  const inspected = rows.find((r) => r.sample === sample);
  const done = rows.filter(completed);
  const finished = done
    .map(completionTime)
    .filter((t): t is number => t !== null);
  const rate =
    current && finished.length
      ? done.length /
        Math.max(
          0.001,
          (Math.max(...finished) - stamp(current.created_at)) / 1000,
        )
      : 0;
  const queued = (model: "emotion_status" | "sentiment_status") =>
    rows.filter((r) => r[model] === "pending").length;
  const failed = rows.filter(
    (r) =>
      r.submit_error === "request_failed" ||
      r.emotion_status === "failed" ||
      r.sentiment_status === "failed",
  );
  const timedOut = rows.filter((r) => r.submit_error === "timeout");
  const cooling = runs.some(
    (r) => r.phase === "clearing" || stamp(r.expires_at) > Date.now(),
  );
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">METRICS · LOGS · TRACES</span>
        <h1>Performance Monitor</h1>
        <p>
          Send 100 test posts with up to 16 concurrent submissions. Follow the
          queue through both CPU models.
        </p>
      </div>
      <section
        className="distribution-panel monitor-controls"
        aria-label="Load demo controls"
      >
        <label htmlFor="load-code">Load demo code</label>
        <input
          id="load-code"
          type="password"
          value={code}
          autoComplete="off"
          onChange={(e) => setCode(e.target.value)}
        />
        <button
          className="primary"
          disabled={!enabled || !code || sending || cooling}
          onClick={() => void start()}
        >
          {sending ? "Submitting…" : "Run Load Demo"}
        </button>
        <button
          className="text-button"
          disabled={
            !enabled ||
            !code ||
            !selected ||
            current?.phase === "cleared" ||
            current?.phase === "clearing"
          }
          onClick={() => void clear()}
        >
          Clear Run
        </button>
        {!enabled && (
          <p className="muted">Load demo is disabled on this deployment.</p>
        )}
        {cooling && !sending && (
          <p className="muted">One run at a time · Two-minute cooldown</p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {runs.length > 0 && (
          <label>
            Run
            <select
              value={selected}
              onChange={(e) => {
                select(e.target.value);
                pick(null);
              }}
            >
              {current?.phase === "cleared" && (
                <option value={selected}>Cleared run</option>
              )}
              {runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {new Date(run.created_at).toLocaleString()} ·{" "}
                  {run.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>
      {current?.phase === "clearing" && (
        <p role="status">
          Clearing test data. Waiting for in-flight inference to finish…
        </p>
      )}
      {current?.phase === "cleared" && <p role="status">Run cleared.</p>}
      {current && current.phase !== "cleared" && (
        <>
          <section className="monitor-metrics" aria-label="Load metrics">
            {[
              [
                "Accepted",
                rows.filter((r) => r.comment_id).length + "/" + current.target,
              ],
              ["Both complete", done.length],
              ["Emotion queued", queued("emotion_status")],
              ["Sentiment queued", queued("sentiment_status")],
              ["Completed / sec", rate.toFixed(1)],
              ["Failures", failed.length],
              ["HTTP timeouts", timedOut.length],
            ].map(([label, value]) => (
              <div className="distribution-panel" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </section>
          <section className="distribution-panel">
            <h2>Percentile latency</h2>
            <label>
              Measure{" "}
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as Mode)}
              >
                <option value="completion">
                  Database insert to both model results
                </option>
                <option value="http">HTTP submit (browser measured)</option>
              </select>
            </label>
            <LatencyChart samples={rows} mode={mode} pick={pick} />
            <p className="muted">
              Select a sample to see its trace. Throughput is measured from run
              start through the last completed sample.
            </p>
            <label>
              Sample{" "}
              <select
                aria-label="Sample"
                value={sample || ""}
                onChange={(e) => pick(Number(e.target.value) || null)}
              >
                <option value="">Select a sample</option>
                {rows.map((r) => (
                  <option key={r.sample} value={r.sample}>
                    Sample {r.sample}
                    {r.submit_error ? ` · ${r.submit_error}` : ""}
                  </option>
                ))}
              </select>
            </label>
          </section>
          {inspected && <SampleTrace sample={inspected} />}
        </>
      )}
    </>
  );
}
