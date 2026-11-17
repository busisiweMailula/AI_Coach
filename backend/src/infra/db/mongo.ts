import { MongoClient, type Db } from "mongodb";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

let client: MongoClient | undefined;
let database: Db | undefined;

export async function connectMongo(): Promise<Db> {
  if (database) return database;

  const nextClient = new MongoClient(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5_000,
  });
  await nextClient.connect();
  client = nextClient;
  database = nextClient.db(env.MONGODB_DB_NAME);
  logger.info({ database: env.MONGODB_DB_NAME }, "MongoDB connected");
  return database;
}

export function getDb(): Db {
  if (!database) {
    throw new Error("MongoDB has not been connected");
  }
  return database;
}

export function getMongoClient(): MongoClient {
  if (!client) throw new Error("MongoDB has not been connected");
  return client;
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = undefined;
    database = undefined;
    logger.info("MongoDB connection closed");
  }
}

