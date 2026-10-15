ALTER TABLE feedback ADD COLUMN department_id INT UNSIGNED NULL, ADD CONSTRAINT fk_feedback_department FOREIGN KEY (department_id) REFERENCES departments(id);
UPDATE feedback f SET department_id = COALESCE((SELECT r.department_id FROM resolution_cycles r WHERE r.complaint_id=f.complaint_id AND r.resolved_at IS NOT NULL AND r.resolved_at<=f.created_at ORDER BY r.resolved_at DESC LIMIT 1),(SELECT c.department_id FROM complaints c WHERE c.id=f.complaint_id));
CREATE INDEX idx_feedback_department ON feedback (department_id);
