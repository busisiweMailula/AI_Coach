import type { ObjectId } from "mongodb";

export interface NotificationDocument {
  _id: ObjectId;
  recipientUserId: ObjectId;
  type: string;
  title: string;
  message: string;
  link: string;
  entityType: string;
  entityId: ObjectId;
  dedupeKey: string;
  createdAt: Date;
  readAt: Date | null;
}
