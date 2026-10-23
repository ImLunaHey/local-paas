ALTER TABLE runtime_logs ADD COLUMN archived boolean NOT NULL DEFAULT false;
ALTER TABLE runtime_logs ADD COLUMN level text NOT NULL DEFAULT 'unclassified';
ALTER TABLE runtime_logs ADD COLUMN message text;
ALTER TABLE runtime_logs ADD COLUMN fields jsonb;
CREATE INDEX log_archive_pending ON runtime_logs(sequence) WHERE NOT archived;
ALTER TABLE instances ADD COLUMN io_read_bytes_per_second double precision;
ALTER TABLE instances ADD COLUMN io_write_bytes_per_second double precision;
ALTER TABLE instances ADD COLUMN network_rx_bytes_per_second double precision;
ALTER TABLE instances ADD COLUMN network_tx_bytes_per_second double precision;
ALTER TABLE runtime_metrics ADD COLUMN io_read_bytes_per_second double precision;
ALTER TABLE runtime_metrics ADD COLUMN io_write_bytes_per_second double precision;
ALTER TABLE runtime_metrics ADD COLUMN network_rx_bytes_per_second double precision;
ALTER TABLE runtime_metrics ADD COLUMN network_tx_bytes_per_second double precision;
-- Retain deduplication identities after the recent PostgreSQL copy is pruned.
CREATE TABLE runtime_log_keys (
 instance_id uuid NOT NULL REFERENCES instances(id),
 entry_key text NOT NULL,
 PRIMARY KEY(instance_id,entry_key)
);
INSERT INTO runtime_log_keys SELECT instance_id,entry_key FROM runtime_logs;
