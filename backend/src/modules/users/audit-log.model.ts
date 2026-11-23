import type { ObjectId } from "mongodb";

export interface AuditLogDocument {
  _id: ObjectId;
  actorId: ObjectId | null;
  targetId?: ObjectId | null;
  ownerId?: ObjectId | null;
  action: string;
  targetType?: string;
  previousRole?: string;
  newRole?: string;
  previousStatus?: string;
  newStatus?: string;
  requestId?: string;
  reason?: string;
  createdAt: Date;
}
