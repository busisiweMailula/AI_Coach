import { Pool, type QueryResultRow } from "pg";
import { env } from "../../config/env.js";

let pool: Pool | undefined;

export function getPostgresPool(): Pool {
  if (!env.POSTGRES_URL) {
    throw new Error("POSTGRES_URL is required for audit log storage.");
  }
  pool ??= new Pool({ connectionString: env.POSTGRES_URL });
  return pool;
}

export async function ensurePostgresAuditTable(): Promise<void> {
  const postgres = getPostgresPool();
  await postgres.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      mongo_id TEXT PRIMARY KEY,
      actor_id TEXT,
      target_id TEXT,
      owner_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      previous_role TEXT,
      new_role TEXT,
      previous_status TEXT,
      new_status TEXT,
      request_id TEXT,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL
    )
  `);
  const columns = [
    ["actor_id", "TEXT"],
    ["target_id", "TEXT"],
    ["owner_id", "TEXT"],
    ["action", "TEXT"],
    ["target_type", "TEXT"],
    ["previous_role", "TEXT"],
    ["new_role", "TEXT"],
    ["previous_status", "TEXT"],
    ["new_status", "TEXT"],
    ["request_id", "TEXT"],
    ["reason", "TEXT"],
    ["created_at", "TIMESTAMPTZ"],
  ] as const;
  for (const [name, type] of columns) {
    await postgres.query(
      `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ${name} ${type}`,
    );
  }
  await postgres.query(
    "CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at DESC)",
  );
}

export async function closePostgres(): Promise<void> {
  const activePool = pool;
  pool = undefined;
  if (activePool) await activePool.end();
}

export interface AuditLogRow extends QueryResultRow {
  mongo_id: string;
  actor_id: string | null;
  target_id: string | null;
  owner_id: string | null;
  action: string;
  target_type: string | null;
  previous_role: string | null;
  new_role: string | null;
  previous_status: string | null;
  new_status: string | null;
  request_id: string | null;
  reason: string | null;
  created_at: Date;
}
