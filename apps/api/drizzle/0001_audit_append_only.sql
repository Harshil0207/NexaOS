-- Audit logs are append-only: reject UPDATE and DELETE at the database level,
-- so even a compromised application path cannot rewrite history.
CREATE OR REPLACE FUNCTION audit_logs_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();
--> statement-breakpoint
-- Execution config snapshots must never change after a run is created.
CREATE OR REPLACE FUNCTION agent_versions_block_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'agent_versions are immutable' USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER agent_versions_no_update BEFORE UPDATE ON agent_versions
  FOR EACH ROW EXECUTE FUNCTION agent_versions_block_update();
