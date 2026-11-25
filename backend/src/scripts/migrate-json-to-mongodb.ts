import { access } from "node:fs/promises";
import path from "node:path";
import { MongoServerError, ObjectId } from "mongodb";
import { connectDatabase, closeDatabase, getDb } from "../infra/db/database.js";
import { ensureIndexes } from "../infra/db/indexes.js";
import { readLegacyJsonDatabase } from "../infra/db/legacy-json-import.js";

async function main(): Promise<void> {
  const sourceArgument = process.argv.indexOf("--source");
  const sourceValue = sourceArgument >= 0
    ? process.argv[sourceArgument + 1]
    : process.env.LEGACY_JSON_DB_PATH ?? ".data/ai-coach.json";
  if (!sourceValue) throw new Error("Provide a path after --source.");
  const sourcePath = path.resolve(sourceValue);
  const apply = process.argv.includes("--apply");
  const merge = process.argv.includes("--merge");
  await access(sourcePath);

  const sourceCollections = await readLegacyJsonDatabase(sourcePath);
  if (sourceCollections.length === 0) {
    throw new Error(`No collections found in legacy JSON file: ${sourcePath}`);
  }

  await connectDatabase();
  const database = getDb();
  const existingCollections = await database.listCollections({}, { nameOnly: true }).toArray();
  const existingCounts = await Promise.all(existingCollections.map(async ({ name }) => ({
    name,
    count: await database.collection(name).countDocuments(),
  })));
  const existingDocuments = existingCounts.reduce((sum, item) => sum + item.count, 0);

  console.log(`Legacy source: ${sourcePath}`);
  for (const { name, documents } of sourceCollections) {
    console.log(`  ${name}: ${documents.length} document(s)`);
  }
  console.log(`MongoDB target "${database.databaseName}": ${existingDocuments} existing document(s)`);
  const sourceRoleCounts = countUsersByRole(
    sourceCollections.find(({ name }) => name === "users")?.documents ?? [],
  );
  const targetRoleCounts = await database.collection("users")
    .aggregate<{ _id: unknown; count: number }>([
      { $group: { _id: "$role", count: { $sum: 1 } } },
    ]).toArray();
  console.log(`Source users by role: ${formatRoleCounts(sourceRoleCounts)}`);
  console.log(`Target users by role: ${formatRoleCounts(
    new Map(targetRoleCounts.map(({ _id, count }) => [String(_id), count])),
  )}`);
  const idConflicts = await countUserEmailConflicts(database, sourceCollections);
  if (idConflicts > 0) {
    console.error(`Migration has ${idConflicts} conflicting user email(s) with different Mongo IDs.`);
  }

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to import into an empty database or --merge --apply to merge.");
    return;
  }
  if (existingDocuments > 0 && !merge) {
    throw new Error("Target MongoDB is not empty. Use --merge to add records without replacing existing IDs.");
  }
  if (idConflicts > 0) {
    throw new Error("Migration stopped because a user email exists with a different Mongo ID; resolve it before importing.");
  }

  await ensureIndexes();
  for (const { name, documents } of sourceCollections) {
    const collection = database.collection(name);
    let inserted = 0;
    let skipped = 0;
    for (const document of documents) {
      if (await collection.findOne({ _id: document._id }, { projection: { _id: 1 } })) {
        skipped += 1;
        continue;
      }
      try {
        await collection.insertOne(document);
        inserted += 1;
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) {
          throw new Error(`Unique-key conflict while importing collection "${name}"; no source data was deleted.`);
        }
        throw error;
      }
    }
    console.log(`  ${name}: inserted ${inserted}, skipped existing IDs ${skipped}`);
  }
  console.log("Migration completed. The legacy JSON file was left unchanged.");
}

async function countUserEmailConflicts(
  database: ReturnType<typeof getDb>,
  sourceCollections: Awaited<ReturnType<typeof readLegacyJsonDatabase>>,
): Promise<number> {
  const users = sourceCollections.find(({ name }) => name === "users")?.documents ?? [];
  const targetUsers = database.collection("users");
  let conflicts = 0;
  const sourceEmails = new Map<string, unknown>();
  for (const user of users) {
    if (typeof user.email !== "string" || user._id === undefined) continue;
    const email = user.email.trim().toLowerCase();
    const sourceId = sourceEmails.get(email);
    if (sourceId !== undefined && !sameId(sourceId, user._id)) conflicts += 1;
    else sourceEmails.set(email, user._id);
    const existing = await targetUsers.findOne(
      { email: user.email },
      { projection: { _id: 1 } },
    );
    if (existing && !sameId(existing._id, user._id)) conflicts += 1;
  }
  return conflicts;
}

function countUsersByRole(users: Record<string, unknown>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const user of users) {
    const role = typeof user.role === "string" ? user.role : "unspecified";
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  return counts;
}

function formatRoleCounts(counts: Map<string, number>): string {
  if (counts.size === 0) return "none";
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([role, count]) => `${role}=${count}`)
    .join(", ");
}

function sameId(left: unknown, right: unknown): boolean {
  if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
  return left === right;
}

async function run(): Promise<void> {
  try {
    await main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "Migration failed");
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}

void run();
