CREATE TABLE IF NOT EXISTS audit_log (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	ts           TEXT    NOT NULL,
	email        TEXT    NOT NULL,
	action       TEXT    NOT NULL,
	bucket       TEXT,
	path         TEXT,
	permission   TEXT,
	prefixes     TEXT,
	actions      TEXT,
	ttl_seconds  INTEGER,
	domain_id    TEXT,
	role         TEXT,
	outcome      TEXT    NOT NULL,
	detail       TEXT,
	request_id   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log (ts);
CREATE INDEX IF NOT EXISTS idx_audit_email ON audit_log (email COLLATE NOCASE, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_bucket ON audit_log (bucket, ts);
CREATE INDEX IF NOT EXISTS idx_audit_denied ON audit_log (outcome, ts);
