CREATE TABLE topic_summary_cache (
    event_id text PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
    fingerprint text NOT NULL,
    report jsonb NOT NULL
);
