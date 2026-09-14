-- Create immutability trigger function for audit logs
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit log records are immutable and cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to identity_audit_logs table
DROP TRIGGER IF EXISTS trg_identity_audit_logs_immutable ON identity_audit_logs;

CREATE TRIGGER trg_identity_audit_logs_immutable
BEFORE UPDATE OR DELETE ON identity_audit_logs
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_log_modification();

-- Attach truncate trigger to identity_audit_logs table
DROP TRIGGER IF EXISTS trg_identity_audit_logs_truncate ON identity_audit_logs;

CREATE TRIGGER trg_identity_audit_logs_truncate
BEFORE TRUNCATE ON identity_audit_logs
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_audit_log_modification();

