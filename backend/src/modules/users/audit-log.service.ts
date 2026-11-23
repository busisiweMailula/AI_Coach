import { ObjectId } from "mongodb";
import { getDb } from "../../infra/db/database.js";
import type { AuditLogDocument } from "./audit-log.model.js";

type AuditLogInput = Omit<AuditLogDocument, "_id" | "createdAt"> & { createdAt?: Date };

export async function recordAuditEvent(input: AuditLogInput): Promise<void> {
  await getDb().collection<AuditLogDocument>("audit_logs").insertOne({
    _id: new ObjectId(),
    ...input,
    createdAt: input.createdAt ?? new Date(),
  });
}
