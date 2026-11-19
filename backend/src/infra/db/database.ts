import path from "node:path";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { JsonDatabase } from "./json-database.js";

let database: JsonDatabase | undefined;

export async function connectDatabase(): Promise<JsonDatabase> {
  if (database) return database;
  database = await JsonDatabase.open(path.resolve(env.JSON_DB_PATH));
  logger.info({ file: path.resolve(env.JSON_DB_PATH) }, "JSON database connected");
  return database;
}

export function getDb(): JsonDatabase {
  if (!database) throw new Error("JSON database has not been connected");
  return database;
}

export async function closeDatabase(): Promise<void> {
  if (!database) return;
  database = undefined;
  logger.info("JSON database connection closed");
}
