import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ObjectId } from "mongodb";
import { afterEach, describe, expect, it } from "vitest";
import { DuplicateKeyError, JsonDatabase } from "../src/infra/db/json-database.js";

interface UserRecord {
  _id: ObjectId;
  email: string;
  createdAt: Date;
  attempts: number;
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("JSON database", () => {
  it("persists BSON-compatible IDs and dates and enforces unique indexes", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ai-coach-json-db-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "database.json");
    const database = await JsonDatabase.open(filePath);
    const users = database.collection<UserRecord>("users");
    const id = new ObjectId();
    const createdAt = new Date("2026-01-01T10:00:00.000Z");
    await users.createIndex({ email: 1 }, { unique: true });

    await users.insertOne({ _id: id, email: "candidate@example.com", createdAt, attempts: 0 });

    const reopened = await JsonDatabase.open(filePath);
    const reopenedUsers = reopened.collection<UserRecord>("users");
    await reopenedUsers.createIndex({ email: 1 }, { unique: true });
    const saved = await reopenedUsers.findOne({ _id: id });
    expect(saved?._id.equals(id)).toBe(true);
    expect(saved?.createdAt).toEqual(createdAt);
    await expect(reopenedUsers.insertOne({
      _id: new ObjectId(),
      email: "candidate@example.com",
      createdAt,
      attempts: 0,
    })).rejects.toBeInstanceOf(DuplicateKeyError);
    await expect(reopenedUsers.insertOne({
      _id: id,
      email: "another@example.com",
      createdAt,
      attempts: 0,
    })).rejects.toBeInstanceOf(DuplicateKeyError);
  });

  it("supports compound filtering, atomic updates, sorting, and upserts", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ai-coach-json-db-"));
    temporaryDirectories.push(directory);
    const database = await JsonDatabase.open(path.join(directory, "database.json"));
    const records = database.collection<UserRecord>("records");
    const ownerId = new ObjectId();
    const firstId = new ObjectId();
    const secondId = new ObjectId();

    await records.insertOne({
      _id: firstId,
      email: "first@example.com",
      createdAt: new Date("2026-01-01T10:00:00.000Z"),
      attempts: 1,
    });
    await records.insertOne({
      _id: secondId,
      email: "second@example.com",
      createdAt: new Date("2026-01-02T10:00:00.000Z"),
      attempts: 0,
    });
    await records.updateOne(
      { _id: secondId },
      { $set: { email: "second@example.com" }, $inc: { attempts: 1 } },
      { upsert: true },
    );
    await records.updateOne(
      { ownerId, email: "created@example.com" },
      { $setOnInsert: { attempts: 2, createdAt: new Date("2026-01-03T10:00:00.000Z") } },
      { upsert: true },
    );

    const filtered = await records.find({ _id: { $in: [firstId, secondId] } })
      .sort({ createdAt: -1 })
      .toArray();
    expect(filtered.map((record) => record._id.toHexString())).toEqual([
      secondId.toHexString(),
      firstId.toHexString(),
    ]);
    expect((await records.findOne({ _id: secondId }))?.attempts).toBe(1);
    expect(await records.countDocuments({ ownerId, attempts: { $gte: 2 } })).toBe(1);
  });
});
