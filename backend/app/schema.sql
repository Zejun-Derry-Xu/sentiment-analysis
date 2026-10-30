CREATE TABLE users (
 id uuid PRIMARY KEY, username text NOT NULL, role text NOT NULL DEFAULT 'demo', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users, expires_at timestamptz NOT NULL
);
CREATE TABLE events (
 id text PRIMARY KEY, title text NOT NULL, category text NOT NULL, description text NOT NULL,
 location text NOT NULL, starts_at timestamptz NOT NULL, is_benchmark boolean NOT NULL DEFAULT false
);
CREATE TABLE comments (
 id uuid PRIMARY KEY, event_id text NOT NULL REFERENCES events, user_id uuid NOT NULL REFERENCES users,
 text text NOT NULL CHECK(length(text) BETWEEN 1 AND 2000), created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
 handling text NOT NULL DEFAULT 'unread' CHECK(handling IN ('unread','viewed','processed')),
 completed_at timestamptz, last_error text, idempotency_key uuid,
 UNIQUE(user_id, idempotency_key)
);
CREATE TABLE jobs (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('comment','evaluation','benchmark')),
 comment_id uuid REFERENCES comments, payload jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), last_error text
);
CREATE UNIQUE INDEX one_active_comment_job ON jobs(comment_id) WHERE kind='comment' AND status IN ('pending','processing');
CREATE INDEX jobs_queue ON jobs(status,available_at,created_at);
CREATE TABLE runtimes (
 id uuid PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(), heartbeat timestamptz NOT NULL DEFAULT now(),
 metadata jsonb NOT NULL
);
CREATE TABLE analyses (
 id uuid PRIMARY KEY, comment_id uuid NOT NULL REFERENCES comments, job_id uuid NOT NULL REFERENCES jobs,
 runtime_id uuid REFERENCES runtimes, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 model_revision text NOT NULL, status text NOT NULL DEFAULT 'processing', scores jsonb, labels jsonb,
 top_label text, top_score double precision, inference_ms double precision, token_count integer,
 truncated boolean, queue_ms double precision, rss_mb double precision, cpu_percent double precision, error text
);
CREATE INDEX analyses_comment ON analyses(comment_id, started_at DESC);
CREATE TABLE favorites (
 user_id uuid REFERENCES users, comment_id uuid REFERENCES comments, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,comment_id)
);
CREATE TABLE corrections (
 id uuid PRIMARY KEY, comment_id uuid NOT NULL REFERENCES comments, user_id uuid NOT NULL REFERENCES users,
 labels jsonb NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE handling_history (
 id uuid PRIMARY KEY, comment_id uuid NOT NULL REFERENCES comments, user_id uuid NOT NULL REFERENCES users,
 previous_status text NOT NULL, new_status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE evaluations (
 id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz, finished_at timestamptz, model_revision text NOT NULL, dataset_revision text NOT NULL,
 total integer NOT NULL, processed integer NOT NULL DEFAULT 0, official boolean NOT NULL,
 metrics jsonb, metadata jsonb, error text
);
CREATE TABLE benchmarks (
 id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz, samples integer NOT NULL, report jsonb, error text
);
