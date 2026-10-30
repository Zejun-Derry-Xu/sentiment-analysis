ALTER TABLE comments ADD COLUMN sentiment_status text NOT NULL DEFAULT 'pending' CHECK(sentiment_status IN ('pending','processing','completed','failed'));
ALTER TABLE comments ADD COLUMN sentiment_error text;
CREATE TABLE sentiment_jobs (
 id uuid PRIMARY KEY, comment_id uuid NOT NULL REFERENCES comments,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
 attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
 available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, last_error text
);
CREATE UNIQUE INDEX one_active_sentiment_job ON sentiment_jobs(comment_id) WHERE status IN ('pending','processing');
CREATE INDEX sentiment_queue ON sentiment_jobs(status,available_at,created_at);
CREATE TABLE sentiment_runtimes (
 id uuid PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(), heartbeat timestamptz NOT NULL DEFAULT now(), metadata jsonb NOT NULL
);
CREATE TABLE sentiment_analyses (
 id uuid PRIMARY KEY, comment_id uuid NOT NULL REFERENCES comments, job_id uuid NOT NULL REFERENCES sentiment_jobs,
 runtime_id uuid REFERENCES sentiment_runtimes, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 status text NOT NULL DEFAULT 'processing', model_revision text NOT NULL,
 label text CHECK(label IN ('negative','neutral','positive')), scores jsonb,
 inference_ms double precision, queue_ms double precision, service_queue_ms double precision,
 token_count integer, rss_mb double precision, error text
);
CREATE INDEX sentiment_comment ON sentiment_analyses(comment_id,started_at DESC);
