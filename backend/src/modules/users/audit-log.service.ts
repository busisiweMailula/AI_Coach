import { ObjectId } from "mongodb";
import { getDb } from "../../infra/db/database.js";
import { getPostgresPool, type AuditLogRow } from "../../infra/db/postgres.js";
import { env } from "../../config/env.js";
import type { AuditLogDocument } from "./audit-log.model.js";

type AuditLogInput = Omit<AuditLogDocument, "_id" | "createdAt"> & { createdAt?: Date };

export async function recordAuditEvent(input: AuditLogInput): Promise<void> {
  const entry: AuditLogDocument = {
    _id: new ObjectId(),
    ...input,
    createdAt: input.createdAt ?? new Date(),
  };
  if (useTestMongoFallback()) {
    await getDb().collection<AuditLogDocument>("audit_logs").insertOne(entry);
    return;
  }

  await getPostgresPool().query(
    `INSERT INTO audit_logs (
      mongo_id, actor_id, target_id, owner_id, action, target_type,
      previous_role, new_role, previous_status, new_status, request_id,
      reason, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      entry._id.toHexString(),
      entry.actorId?.toHexString() ?? null,
      entry.targetId?.toHexString() ?? null,
      entry.ownerId?.toHexString() ?? null,
      entry.action,
      entry.targetType ?? null,
      entry.previousRole ?? null,
      entry.newRole ?? null,
      entry.previousStatus ?? null,
      entry.newStatus ?? null,
      entry.requestId ?? null,
      entry.reason ?? null,
      entry.createdAt,
    ],
  );
}

export async function listAuditEvents(limit: number): Promise<AuditLogDocument[]> {
  if (useTestMongoFallback()) {
    return getDb().collection<AuditLogDocument>("audit_logs")
      .find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  const result = await getPostgresPool().query<AuditLogRow>(
    `SELECT mongo_id, actor_id, target_id, owner_id, action, target_type,
      previous_role, new_role, previous_status, new_status, request_id,
      reason, created_at
     FROM audit_logs ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    _id: parseObjectId(row.mongo_id, "audit log ID"),
    actorId: parseNullableObjectId(row.actor_id, "actor ID"),
    ...(row.target_id ? { targetId: parseObjectId(row.target_id, "target ID") } : {}),
    ...(row.owner_id ? { ownerId: parseObjectId(row.owner_id, "owner ID") } : {}),
    action: row.action,
    ...(typeof row.target_type === "string" ? { targetType: row.target_type } : {}),
    ...(typeof row.previous_role === "string" ? { previousRole: row.previous_role } : {}),
    ...(typeof row.new_role === "string" ? { newRole: row.new_role } : {}),
    ...(typeof row.previous_status === "string" ? { previousStatus: row.previous_status } : {}),
    ...(typeof row.new_status === "string" ? { newStatus: row.new_status } : {}),
    ...(typeof row.request_id === "string" ? { requestId: row.request_id } : {}),
    ...(typeof row.reason === "string" ? { reason: row.reason } : {}),
    createdAt: row.created_at,
  }));
}

function useTestMongoFallback(): boolean {
  return env.NODE_ENV === "test";
}

function parseNullableObjectId(value: unknown, field: string): ObjectId | null {
  return value === null || value === undefined ? null : parseObjectId(value, field);
}

function parseObjectId(value: unknown, field: string): ObjectId {
  if (typeof value !== "string" || !ObjectId.isValid(value)) {
    throw new Error(`PostgreSQL audit log contains an invalid ${field}`);
  }
  return new ObjectId(value);
}
