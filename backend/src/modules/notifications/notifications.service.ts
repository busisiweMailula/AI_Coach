import { ObjectId } from "mongodb";
import { logger } from "../../config/logger.js";
import { getDb } from "../../infra/db/database.js";
import type { UserDocument, UserRole } from "../users/user.model.js";
import type { NotificationDocument } from "./notification.model.js";

export async function notify(input: {
  recipientUserId: string | ObjectId;
  type: string;
  title: string;
  message: string;
  link: string;
  entityType: string;
  entityId: string | ObjectId;
  dedupeKey: string;
}): Promise<void> {
  try {
    const recipientUserId = typeof input.recipientUserId === "string"
      ? new ObjectId(input.recipientUserId)
      : input.recipientUserId;
    const entityId = typeof input.entityId === "string" ? new ObjectId(input.entityId) : input.entityId;
    await getDb().collection<NotificationDocument>("notifications").insertOne({
      _id: new ObjectId(),
      recipientUserId,
      type: input.type,
      title: input.title.slice(0, 120),
      message: input.message.slice(0, 240),
      link: input.link,
      entityType: input.entityType,
      entityId,
      dedupeKey: input.dedupeKey,
      createdAt: new Date(),
      readAt: null,
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === 11000) return;
    logger.error({ err: error, type: input.type, entityType: input.entityType }, "Notification delivery failed");
  }
}

export async function notifyActiveRole(input: {
  role: UserRole;
  type: string;
  title: string;
  message: string;
  link: string;
  entityType: string;
  entityId: string | ObjectId;
  dedupeKey: string;
}): Promise<void> {
  try {
    const users = await getDb().collection<UserDocument>("users").find({ role: input.role }).toArray();
    await Promise.all(users
      .filter((user) => (user.status ?? "active") === "active")
      .map((user) => notify({ ...input, recipientUserId: user._id, dedupeKey: `${input.dedupeKey}:${user._id.toHexString()}` })));
  } catch (error) {
    logger.error({ err: error, role: input.role, type: input.type }, "Role notifications could not be delivered");
  }
}

export async function listNotifications(
  recipientUserId: string,
  options: { limit: number; offset: number; unreadOnly: boolean },
) {
  const all = await getDb().collection<NotificationDocument>("notifications")
    .find({ recipientUserId: new ObjectId(recipientUserId) })
    .sort({ createdAt: -1 })
    .toArray();
  const filtered = options.unreadOnly ? all.filter((item) => item.readAt === null) : all;
  const page = filtered.slice(options.offset, options.offset + options.limit);
  return {
    items: page.map(toNotificationResponse),
    nextCursor: options.offset + page.length < filtered.length
      ? String(options.offset + page.length)
      : null,
  };
}

export async function unreadNotificationCount(recipientUserId: string): Promise<number> {
  const items = await getDb().collection<NotificationDocument>("notifications")
    .find({ recipientUserId: new ObjectId(recipientUserId), readAt: null })
    .toArray();
  return items.length;
}

export async function markNotificationRead(notificationId: string, recipientUserId: string) {
  if (!ObjectId.isValid(notificationId)) return null;
  const collection = getDb().collection<NotificationDocument>("notifications");
  const existing = await collection.findOne({
    _id: new ObjectId(notificationId),
    recipientUserId: new ObjectId(recipientUserId),
  });
  if (!existing) return null;
  if (existing.readAt) return toNotificationResponse(existing);
  const updated = await collection.findOneAndUpdate(
    { _id: existing._id, recipientUserId: existing.recipientUserId, readAt: null },
    { $set: { readAt: new Date() } },
    { returnDocument: "after" },
  );
  return updated ? toNotificationResponse(updated) : null;
}

export async function markAllNotificationsRead(recipientUserId: string): Promise<number> {
  const result = await getDb().collection<NotificationDocument>("notifications").updateMany(
    { recipientUserId: new ObjectId(recipientUserId), readAt: null },
    { $set: { readAt: new Date() } },
  );
  return result.modifiedCount;
}

function toNotificationResponse(item: NotificationDocument) {
  return {
    id: item._id.toHexString(),
    type: item.type,
    title: item.title,
    message: item.message,
    link: item.link,
    entityType: item.entityType,
    entityId: item.entityId.toHexString(),
    createdAt: item.createdAt.toISOString(),
    readAt: item.readAt?.toISOString() ?? null,
  };
}
