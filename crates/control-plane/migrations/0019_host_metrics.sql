-- Host telemetry is operational data, not an administrative action/audit event.
CREATE TABLE host_metric_samples (
    host_id text NOT NULL,
    timestamp timestamptz NOT NULL,
    sample jsonb NOT NULL,
    PRIMARY KEY (host_id, timestamp)
);
CREATE INDEX host_metric_samples_expiry ON host_metric_samples (timestamp);
