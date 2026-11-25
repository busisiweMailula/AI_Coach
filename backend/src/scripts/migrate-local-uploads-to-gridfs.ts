import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { closeDatabase, connectDatabase, getDb } from "../infra/db/database.js";
import { MongoGridFsStorage } from "../infra/storage/mongodb-gridfs-storage.js";

interface FileReference {
  key: string;
  sourcePath: string;
}

async function main(): Promise<void> {
  const sourceArgument = process.argv.indexOf("--source-dir");
  const sourceValue = sourceArgument >= 0
    ? process.argv[sourceArgument + 1]
    : ".data/uploads";
  if (!sourceValue) throw new Error("Provide a directory after --source-dir.");
  const sourceRoot = path.resolve(sourceValue);
  const apply = process.argv.includes("--apply");

  await connectDatabase();
  try {
    const database = getDb();
    const storage = new MongoGridFsStorage();
    const keys = new Set<string>();
    for (const resume of await database.collection("resumes")
      .find({}, { projection: { storageKey: 1 } }).toArray()) {
      if (typeof resume.storageKey === "string") keys.add(resume.storageKey);
    }
    for (const description of await database.collection("job_descriptions")
      .find({}, { projection: { sourceFileKey: 1 } }).toArray()) {
      if (typeof description.sourceFileKey === "string") keys.add(description.sourceFileKey);
    }

    const pending: FileReference[] = [];
    let alreadyStored = 0;
    let missingFiles = 0;
    for (const key of keys) {
      if (await storage.exists(key)) {
        alreadyStored += 1;
        continue;
      }
      const sourcePath = resolveSourcePath(sourceRoot, key);
      try {
        await access(sourcePath);
        pending.push({ key, sourcePath });
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
          missingFiles += 1;
          continue;
        }
        throw error;
      }
    }

    console.log(`MongoDB metadata references ${keys.size} uploaded file(s).`);
    console.log(`Already in GridFS: ${alreadyStored}; available locally to copy: ${pending.length}; missing locally: ${missingFiles}.`);
    console.log(apply ? "Mode: APPLY (copies only; does not delete local files)" : "Mode: DRY RUN");
    if (!apply) {
      console.log("Dry run complete. Re-run with --apply to copy available files into GridFS.");
      return;
    }
    if (missingFiles > 0) {
      throw new Error("Migration stopped because some referenced files are missing locally; no local files were deleted.");
    }

    let copied = 0;
    for (const reference of pending) {
      await storage.put(reference.key, await readFile(reference.sourcePath));
      copied += 1;
    }
    console.log(`Copied ${copied} file(s) to MongoDB GridFS. Local files were left unchanged.`);
  } finally {
    await closeDatabase();
  }
}

function resolveSourcePath(root: string, key: string): string {
  if (!key || key.includes("\0")) throw new Error("Invalid legacy storage key.");
  const resolved = path.resolve(root, key);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) ||
      relative === ".." || path.isAbsolute(relative)) {
    throw new Error("Legacy storage key resolves outside the configured source directory.");
  }
  return resolved;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error &&
    typeof error.code === "string";
}

async function run(): Promise<void> {
  try {
    await main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "Migration failed");
    process.exitCode = 1;
  }
}

void run();
