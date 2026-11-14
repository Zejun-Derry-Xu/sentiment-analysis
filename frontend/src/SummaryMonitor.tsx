import { useEffect, useState } from "react";
import { LatencyChart } from "./PerformanceMonitor";

const endpoint = "/api/admin/summary-monitor";

type Sample = {
  sample: number;
  status: "completed" | "timeout" | "failed";
  queue_ms: number;
  inference_ms: number;
  total_ms: number;
  load_ms?: number;
  prompt_ms?: number;
  generation_ms?: number;
  prompt_tokens?: number;
  output_tokens?: number;
};
type Monitor = {
  enabled: boolean;
  model: string;
  cooldown: number;
  recent: { status: string; elapsed_ms: number }[];
  run: null | {
    model: string;
    phase: string;
    target: number;
    concurrency: number;
    samples: Sample[];
  };
};
const seconds = (ms: number) => (ms / 1000).toFixed(2) + " s";

async function request(
  path = "",
  method = "GET",
): Promise<Monitor | undefined> {
  const response = await fetch(endpoint + path, { method });
  if (response.status === 204) return;
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || "LLM monitor unavailable.");
  return data;
}

export function SummaryMonitor() {
  const [state, setState] = useState<Monitor>();
  const [sampleId, pick] = useState<number>();
  const [mode, setMode] = useState<"total_ms" | "inference_ms">("total_ms");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const result = await request();
        if (active) setState(result);
      } catch {
        // Keep the last known measurements while the API reconnects.
      } finally {
        pending = false;
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  async function action(method: "POST" | "DELETE") {
    setBusy(true);
    setError("");
    pick(undefined);
    try {
      await request("/run", method);
      setState(await request());
    } catch (e) {
      setError(e instanceof Error ? e.message : "LLM monitor unavailable.");
    } finally {
      setBusy(false);
    }
  }

  if (!state?.enabled) return null;
  const run = state.run;
  const rows = run?.samples ?? [];
  const selected = rows.find((row) => row.sample === sampleId);
  const hits = state.recent.filter((row) => row.status === "cache_hit").length;
  const generated = state.recent.filter(
    (row) => row.status === "generated",
  ).length;
  return (
    <section
      className="distribution-panel llm-monitor"
      aria-label="LLM performance"
    >
      <div className="section-title">
        <h2>LLM performance</h2>
      </div>
      <p className="muted">
        {state.model} · Up to 100 recent topic summary requests since API start
      </p>
      <div className="monitor-metrics">
        <div>
          <span>Cache hits</span>
          <strong>{hits}</strong>
        </div>
        <div>
          <span>Generated</span>
          <strong>{generated}</strong>
        </div>
        <div>
          <span>Failed or timed out</span>
          <strong>{state.recent.length - hits - generated}</strong>
        </div>
      </div>
      <p>
        Run 8 uncached generations on sample posts. Two requests at a time share
        one model slot.
      </p>
      <button
        className="primary"
        disabled={busy || run?.phase === "running" || state.cooldown > 0}
        onClick={() => void action("POST")}
      >
        {run?.phase === "running"
          ? "Running LLM load test…"
          : "Run LLM Load Test"}
      </button>
      {run && run.phase !== "running" && (
        <button
          className="text-button"
          disabled={busy}
          onClick={() => void action("DELETE")}
        >
          Clear LLM Run
        </button>
      )}
      {state.cooldown > 0 && (
        <p className="muted">Next test in {state.cooldown} s</p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {run && (
        <>
          <p role="status">
            {rows.length}/{run.target} finished ·{" "}
            {rows.filter((s) => s.status === "completed").length} succeeded ·{" "}
            {rows.filter((s) => s.status === "failed").length} failed ·{" "}
            {rows.filter((s) => s.status === "timeout").length} timed out
            {run.phase === "failed" && " · Test stopped early"}
          </p>
          <label>
            Measure{" "}
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="total_ms">Queue + Ollama response</option>
              <option value="inference_ms">Ollama response only</option>
            </select>
          </label>
          <LatencyChart
            measurements={rows
              .filter((s) => s.status === "completed")
              .map((s) => ({ sample: s.sample, ms: s[mode] }))}
            pick={pick}
          />
          {selected && (
            <p>
              Sample {selected.sample} · Queue {seconds(selected.queue_ms)} ·
              Model load {seconds(selected.load_ms ?? 0)} · Prompt{" "}
              {seconds(selected.prompt_ms ?? 0)} · Generation{" "}
              {seconds(selected.generation_ms ?? 0)} ·{" "}
              {selected.output_tokens ?? 0} output tokens
            </p>
          )}
        </>
      )}
    </section>
  );
}
