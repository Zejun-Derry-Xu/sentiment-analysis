import { useEffect, useRef, useState } from "react";

type Report = {
  model: string;
  total_posts: number;
  posts_read: number;
  elapsed_ms?: number;
  points: { heading: string; views: string; sources: number[] }[];
  sources: { number: number; id: string; text: string }[];
};

export function TopicSummary({ topicId }: { topicId: string }) {
  const [enabled, setEnabled] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const config = new AbortController();
    void fetch("/api/model", { signal: config.signal })
      .then((r) => r.json())
      .then((data) => setEnabled(data.topic_summary_enabled === true))
      .catch(() => {});
    return () => {
      config.abort();
      request.current?.abort();
    };
  }, []);

  async function run() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setWorking(true);
    setError("");
    try {
      const response = await fetch(
        `/api/events/${encodeURIComponent(topicId)}/summary`,
        {
          method: "POST",
          signal: controller.signal,
        },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : "Summary unavailable.",
        );
      }
      setReport(data);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Summary unavailable.");
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setWorking(false);
    }
  }

  if (!enabled) return null;
  return (
    <section
      className="distribution-panel topic-summary-panel"
      aria-label="Discussion summary"
    >
      <div className="section-title">
        <h2>Discussion summary</h2>
        <button
          className="primary"
          type="button"
          disabled={working}
          onClick={() => void run()}
        >
          {working ? "Summarizing…" : report ? "Refresh summary" : "Summarize"}
        </button>
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
            {report.elapsed_ms !== undefined &&
              ` · ${(report.elapsed_ms / 1000).toFixed(1)} s`}
          </p>
          {report.posts_read < report.total_posts && (
            <p className="muted">
              The summary covers the newest posts that fit in this run.
            </p>
          )}
          {report.points.length === 0 && (
            <p>No clear discussion points were found.</p>
          )}
          {report.points.map((point, i) => (
            <article key={i} className="topic-summary-point">
              <h3>{point.heading}</h3>
              <p>{point.views}</p>
              <details>
                <summary>Source posts</summary>
                {report.sources
                  .filter((s) => point.sources.includes(s.number))
                  .map((s) => (
                    <blockquote key={s.id}>
                      <strong>Post {s.number}</strong> · {s.text}
                    </blockquote>
                  ))}
              </details>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
