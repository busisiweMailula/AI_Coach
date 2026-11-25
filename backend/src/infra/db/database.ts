import { MongoClient, type Db } from "mongodb";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

let client: MongoClient | undefined;
let database: Db | undefined;
let connecting: Promise<Db> | undefined;

export async function connectDatabase(): Promise<Db> {
  if (database) return database;
  if (connecting) return connecting;

  const nextClient = new MongoClient(env.MONGODB_URI);
  connecting = nextClient.connect()
    .then(() => {
      client = nextClient;
      database = nextClient.db(env.MONGODB_DB_NAME);
      logger.info({ database: env.MONGODB_DB_NAME }, "MongoDB connected");
      return database;
    })
    .catch(async (error: unknown) => {
      await nextClient.close();
      throw error;
    });

  try {
    return await connecting;
  } finally {
    connecting = undefined;
  }
}

export function getDb(): Db {
  if (!database) throw new Error("MongoDB has not been connected");
  return database;
}

export function getMongoDb(): Db {
  return getDb();
}

export async function closeDatabase(): Promise<void> {
  const activeClient = client;
  if (!activeClient) return;
  client = undefined;
  database = undefined;
  await activeClient.close();
  logger.info("MongoDB connection closed");
}
