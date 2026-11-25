import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ObjectId } from "mongodb";
import { afterEach, describe, expect, it } from "vitest";
import { readLegacyJsonDatabase } from "../src/infra/db/legacy-json-import.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("legacy JSON database import", () => {
  it("restores ObjectIds and dates while preserving nested data", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ai-coach-legacy-import-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "database.json");
    const id = "65f0c0a3f6b8a7b123456789";
    await writeFile(filePath, JSON.stringify({
      users: [{
        _id: { $oid: id },
        createdAt: { $date: "2026-01-01T10:00:00.000Z" },
        profile: { skills: ["TypeScript"] },
      }],
    }));

    const collections = await readLegacyJsonDatabase(filePath);

    expect(collections).toHaveLength(1);
    expect(collections[0]?.name).toBe("users");
    expect(collections[0]?.documents[0]?._id).toEqual(new ObjectId(id));
    expect(collections[0]?.documents[0]?.createdAt).toEqual(new Date("2026-01-01T10:00:00.000Z"));
    expect(collections[0]?.documents[0]?.profile).toEqual({ skills: ["TypeScript"] });
  });

  it("rejects malformed collection data and invalid tagged values", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ai-coach-legacy-import-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "database.json");

    await writeFile(filePath, JSON.stringify({ users: [{ _id: { $oid: "bad-id" } }] }));
    await expect(readLegacyJsonDatabase(filePath)).rejects.toThrow("invalid ObjectId");

    await writeFile(filePath, JSON.stringify({ users: "not-an-array" }));
    await expect(readLegacyJsonDatabase(filePath)).rejects.toThrow('collection "users" must contain an array');
  });
});
