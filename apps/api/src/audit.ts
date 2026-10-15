import type { DB } from './db.js';
import { execute } from './db.js';
export async function audit(
  db: DB,
  actorId: number | null,
  action: string,
  entityType: string,
  entityId: number | null,
  metadata: Record<string, unknown> = {},
) {
  await execute(
    'INSERT INTO audit_events (actor_id,action,entity_type,entity_id,metadata) VALUES (?,?,?,?,?)',
    [actorId, action, entityType, entityId, JSON.stringify(metadata)],
    db,
  );
}
