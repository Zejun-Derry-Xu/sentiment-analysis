CREATE TABLE load_runs (
 id uuid PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '2 minutes',
 phase text NOT NULL DEFAULT 'open' CHECK (phase IN ('open','clearing','cleared')),
 cleared_at timestamptz
);
ALTER TABLE comments ADD COLUMN load_run_id uuid REFERENCES load_runs;
CREATE INDEX comments_load_run ON comments(load_run_id) WHERE load_run_id IS NOT NULL;
CREATE TABLE load_samples (
 run_id uuid NOT NULL REFERENCES load_runs,
 sample integer NOT NULL CHECK(sample BETWEEN 1 AND 100),
 comment_id uuid UNIQUE REFERENCES comments,
 http_ms double precision,
 submit_error text,
 PRIMARY KEY(run_id,sample)
);
