import { useState } from "react";
import { PerformanceMonitor } from "./PerformanceMonitor";
import { SummaryMonitor } from "./SummaryMonitor";

export function MonitorPage() {
  const [view, setView] = useState<"classifiers" | "llm">("classifiers");
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">METRICS · LOGS · TRACES</span>
        <h1>Performance Monitor</h1>
      </div>
      <div
        className="monitor-views"
        role="group"
        aria-label="Performance tests"
      >
        <button
          type="button"
          className="text-button"
          aria-pressed={view === "classifiers"}
          aria-controls="classifier-performance"
          onClick={() => setView("classifiers")}
        >
          Post Classifiers
        </button>
        <button
          type="button"
          className="text-button"
          aria-pressed={view === "llm"}
          aria-controls="summary-performance"
          onClick={() => setView("llm")}
        >
          LLM Summary
        </button>
      </div>
      <section
        id="classifier-performance"
        aria-label="Post classifiers"
        hidden={view !== "classifiers"}
      >
        <PerformanceMonitor />
      </section>
      <section
        id="summary-performance"
        aria-label="LLM summary"
        hidden={view !== "llm"}
      >
        <SummaryMonitor />
      </section>
    </>
  );
}
