CREATE INDEX idx_complaints_priority ON complaints (deleted_at,priority DESC,created_at DESC,id DESC);
CREATE INDEX idx_complaints_reporter_priority ON complaints (reporter_id,deleted_at,priority DESC,created_at DESC,id DESC);
CREATE INDEX idx_complaints_department_priority ON complaints (department_id,deleted_at,priority DESC,created_at DESC,id DESC);
