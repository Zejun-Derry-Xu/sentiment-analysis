import { useEffect, useState } from "react";

type Report = {
  model: string;
  total_posts: number;
  posts_read: number;
  elapsed_ms?: number;
  bullets: string[];
  cached: boolean;
};

export function TopicSummary({ topicId }: { topicId: string }) {
  const [enabled, setEnabled] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [attempt, retry] = useState(0);

  useEffect(() => {
    const config = new AbortController();
    void fetch("/api/model", { signal: config.signal })
      .then((r) => r.json())
      .then((data) => setEnabled(data.topic_summary_enabled === true))
      .catch(() => {});
    return () => {
      config.abort();
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: number | undefined;
    const deadline = Date.now() + 180_000;
    setWorking(true);
    setError("");

    async function run() {
      try {
        const response = await fetch(
          `/api/events/${encodeURIComponent(topicId)}/summary`,
          {
            method: "POST",
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted) return;
        if (response.status === 202) {
          if (Date.now() >= deadline)
            throw new Error("The model is busy. Please try again.");
          timer = window.setTimeout(() => void run(), 2000);
          return;
        }
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) {
          throw new Error(
            typeof data.detail === "string"
              ? data.detail
              : "Summary unavailable.",
          );
        }
        setReport(data);
        setWorking(false);
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : "Summary unavailable.");
        setWorking(false);
      }
    }

    void run();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [enabled, topicId, attempt]);

  if (!enabled) return null;
  return (
    <section
      className="distribution-panel topic-summary-panel"
      aria-label="Discussion summary"
    >
      <div className="section-title">
        <h2>Discussion summary</h2>
        {error && (
          <button
            className="text-button"
            type="button"
            onClick={() => retry((n) => n + 1)}
          >
            Retry summary
          </button>
        )}
      </div>
      {working && <p role="status">Reading the posts in this topic…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {report && report.posts_read === 0 && (
        <p role="status">There are no posts to summarize yet.</p>
      )}
      {!!report?.posts_read && (
        <div aria-live="polite">
          <p className="muted">
            AI summary · {report.posts_read} of {report.total_posts} posts ·{" "}
            {report.model}
            {report.cached
              ? " · Cached"
              : report.elapsed_ms !== undefined &&
                ` · ${(report.elapsed_ms / 1000).toFixed(1)} s`}
          </p>
          {report.posts_read < report.total_posts && (
            <p className="muted">
              The summary covers the newest posts that fit in this run.
            </p>
          )}
          {report.bullets.length ? (
            <ul className="topic-summary-bullets">
              {report.bullets.map((bullet, i) => (
                <li key={i}>{bullet}</li>
              ))}
            </ul>
          ) : (
            <p>No clear discussion points were found.</p>
          )}
        </div>
      )}
    </section>
  );
}
