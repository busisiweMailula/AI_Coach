import { ObjectId } from "mongodb";
import { Client } from "pg";
import { closeDatabase, connectDatabase, getDb } from "../infra/db/database.js";
import { env } from "../config/env.js";
import {
  auditLogsCollectionShape,
  collectionShape,
  postgresValue,
  valueType,
  type CollectionShape,
} from "../infra/db/postgres-migration.js";

const excludedCollections = new Map([
  ["resume_vector_chunks", "kept in MongoDB for vector search"],
  ["interview_answers", "raw candidate interview answers are intentionally not migrated"],
]);
const insertBatchRows = 250;

async function main(): Promise<void> {
  if (!env.POSTGRES_URL) throw new Error("POSTGRES_URL is required for this migration.");

  const apply = process.argv.includes("--apply");
  const collectionArgument = process.argv.indexOf("--collection");
  const selectedCollection = collectionArgument >= 0
    ? process.argv[collectionArgument + 1]
    : undefined;
  if (collectionArgument >= 0 &&
      (!selectedCollection || selectedCollection.startsWith("--"))) {
    throw new Error("Provide a collection name after --collection.");
  }
  if (selectedCollection && excludedCollections.has(selectedCollection)) {
    throw new Error(`Collection "${selectedCollection}" is intentionally excluded from PostgreSQL migration.`);
  }
  await connectDatabase();
  const mongo = getDb();
  const postgres = new Client({ connectionString: env.POSTGRES_URL });
  let postgresConnected = false;

  try {
    await postgres.connect();
    postgresConnected = true;
    const collectionNames = (await mongo.listCollections({}, { nameOnly: true }).toArray())
      .map(({ name }) => name)
      .filter((name) => !name.startsWith("system."));
    if (selectedCollection && !collectionNames.includes(selectedCollection)) {
      throw new Error(`MongoDB collection "${selectedCollection}" does not exist.`);
    }
    const migrationCollections = collectionNames.filter((name) =>
      !excludedCollections.has(name) &&
      (!selectedCollection || name === selectedCollection)
    );
    const shapes: CollectionShape[] = [];
    const tableSources = new Map<string, string>();

    console.log(`MongoDB source database: ${env.MONGODB_DB_NAME}`);
    console.log(`PostgreSQL target: ${safePostgresTarget(env.POSTGRES_URL)}`);
    console.log(apply ? "Mode: APPLY (copy only; MongoDB source is unchanged)" : "Mode: DRY RUN");
    for (const [name, reason] of excludedCollections) {
      if (collectionNames.includes(name)) {
        const count = await mongo.collection(name).countDocuments();
        console.log(`  SKIP ${name}: ${count} document(s) (${reason})`);
      }
    }

    for (const name of migrationCollections) {
      const typesByField = new Map<string, Set<string>>();
      let documentCount = 0;
      for await (const document of mongo.collection(name).find()) {
        documentCount += 1;
        for (const [fieldName, value] of Object.entries(document)) {
          if (fieldName === "_id") continue;
          const types = typesByField.get(fieldName) ?? new Set<string>();
          if (value !== null && value !== undefined) types.add(valueType(value));
          typesByField.set(fieldName, types);
        }
      }
      const shape = name === "audit_logs"
        ? auditLogsCollectionShape(documentCount)
        : collectionShape(name, documentCount, typesByField);
      const priorSource = tableSources.get(shape.tableName);
      if (priorSource) {
        throw new Error(
          `Mongo collections "${priorSource}" and "${name}" map to the same PostgreSQL table "${shape.tableName}"`,
        );
      }
      tableSources.set(shape.tableName, name);
      shapes.push(shape);
      const targetRows = await targetRowCount(postgres, shape.tableName);
      console.log(
        `  ${apply ? "COPY" : "PLAN"} ${name} -> ${shape.tableName}: ${shape.count} source document(s), ${targetRows} existing PostgreSQL row(s), ${shape.fields.length} typed field(s)`,
      );
    }

    if (!selectedCollection && collectionNames.includes("users")) {
      await reportUserRoles(mongo);
    } else if (!selectedCollection && !collectionNames.includes("users")) {
      console.warn("WARNING: MongoDB source has no users collection.");
    }
    if (!apply) {
      console.log("Dry run complete. Re-run with --apply to copy the listed collections.");
      return;
    }

    for (const shape of shapes) {
      await migrateCollection(mongo, postgres, shape);
    }
    console.log("Migration complete. Source MongoDB documents were not modified or deleted.");
  } finally {
    if (postgresConnected) await postgres.end();
    await closeDatabase();
  }
}

async function migrateCollection(
  mongo: ReturnType<typeof getDb>,
  postgres: Client,
  shape: CollectionShape,
): Promise<void> {
  const collectionName = shape.tableName;
  const collection = mongo.collection(shape.sourceName);
  await postgres.query("BEGIN");
  try {
    await createTable(postgres, shape);
    let batch: Record<string, unknown>[] = [];
    let copied = 0;
    for await (const document of collection.find()) {
      batch.push(document);
      if (batch.length >= insertBatchRows) {
        copied += await insertBatch(postgres, shape, batch);
        batch = [];
      }
    }
    if (batch.length > 0) copied += await insertBatch(postgres, shape, batch);
    await postgres.query("COMMIT");
    console.log(`  DONE ${collectionName}: inserted ${copied} of ${shape.count} document(s)`);
  } catch (error) {
    await postgres.query("ROLLBACK");
    throw error;
  }
}

async function createTable(postgres: Client, shape: CollectionShape): Promise<void> {
  const definitions = [
    `${quoteIdentifier("mongo_id")} TEXT PRIMARY KEY`,
    ...shape.fields.map((field) =>
      `${quoteIdentifier(field.columnName)} ${field.type}`
    ),
  ];
  await postgres.query(
    `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(shape.tableName)} (${definitions.join(", ")})`,
  );
  for (const field of shape.fields) {
    await postgres.query(
      `ALTER TABLE ${quoteIdentifier(shape.tableName)} ADD COLUMN IF NOT EXISTS ${quoteIdentifier(field.columnName)} ${field.type}`,
    );
  }
  if (shape.fields.some((field) => field.columnName === "owner_id")) {
    await postgres.query(
      `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${shape.tableName}_owner_id_idx`)} ON ${quoteIdentifier(shape.tableName)} (${quoteIdentifier("owner_id")})`,
    );
  }
  if (shape.fields.some((field) => field.columnName === "created_at")) {
    await postgres.query(
      `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${shape.tableName}_created_at_idx`)} ON ${quoteIdentifier(shape.tableName)} (${quoteIdentifier("created_at")})`,
    );
  }
}

async function insertBatch(
  postgres: Client,
  shape: CollectionShape,
  documents: Record<string, unknown>[],
): Promise<number> {
  const columnNames = ["mongo_id", ...shape.fields.map((field) => field.columnName)];
  const rowsPerBatch = Math.max(1, Math.floor(60_000 / columnNames.length));
  let inserted = 0;

  for (let offset = 0; offset < documents.length; offset += rowsPerBatch) {
    const batch = documents.slice(offset, offset + rowsPerBatch);
    const parameters: unknown[] = [];
    const valueGroups = batch.map((document) => {
      const values = [
        mongoId(document._id),
        ...shape.fields.map((field) => postgresValue(document[field.sourceName], field.type)),
      ];
      const placeholders = values.map((value) => {
        parameters.push(value);
        return `$${parameters.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    const columns = columnNames.map(quoteIdentifier).join(", ");
    const result = await postgres.query(
      `INSERT INTO ${quoteIdentifier(shape.tableName)} (${columns}) VALUES ${valueGroups.join(", ")} ON CONFLICT (${quoteIdentifier("mongo_id")}) DO NOTHING`,
      parameters,
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

async function reportUserRoles(mongo: ReturnType<typeof getDb>): Promise<void> {
  const roles = await mongo.collection("users").find({}, { projection: { role: 1 } }).toArray();
  const roleCounts = new Map<string, number>();
  for (const user of roles) {
    const role = typeof user.role === "string" ? user.role : "unspecified";
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
  }
  const candidates = roleCounts.get("candidate") ?? 0;
  const coaches = roleCounts.get("coach") ?? 0;
  const admins = roleCounts.get("admin") ?? 0;
  console.log(`  USERS source roles: ${candidates} candidate(s), ${coaches} coach(es), ${admins} admin(s)`);
  if (candidates === 0 || coaches === 0) {
    console.warn(
      "WARNING: Candidate/coach accounts missing from this MongoDB source will not be created by migration. Verify the source URI/database before applying.",
    );
  }
}

async function targetRowCount(postgres: Client, tableName: string): Promise<number> {
  const exists = await postgres.query<{ table_exists: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS table_exists",
    [`public.${tableName}`],
  );
  if (!exists.rows[0]?.table_exists) return 0;
  const result = await postgres.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${quoteIdentifier(tableName)}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

function mongoId(value: unknown): string {
  if (value instanceof ObjectId) return value.toHexString();
  if (typeof value === "string" || typeof value === "number") return String(value);
  throw new Error("A MongoDB document is missing a supported _id; migration stopped.");
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function safePostgresTarget(connectionString: string): string {
  try {
    const target = new URL(connectionString);
    return `${target.hostname}:${target.port || "5432"}${target.pathname}`;
  } catch {
    return "configured PostgreSQL server";
  }
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
