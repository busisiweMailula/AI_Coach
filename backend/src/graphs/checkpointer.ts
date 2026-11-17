import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { env } from "../config/env.js";
import { getMongoClient } from "../infra/db/mongo.js";

let saver: MongoDBSaver | undefined;
let setupPromise: Promise<MongoDBSaver> | undefined;

export async function getMongoCheckpointer(): Promise<MongoDBSaver> {
  if (saver) return saver;
  if (!setupPromise) {
    setupPromise = (async () => {
      const nextSaver = new MongoDBSaver({
        client: getMongoClient(),
        dbName: env.MONGODB_DB_NAME,
        ttl: 30 * 24 * 60 * 60,
        enableTimestamps: true,
      });
      const errors = await nextSaver.setup();
      if (errors.length > 0) throw new AggregateError(errors, "Failed to initialize graph checkpoints");
      saver = nextSaver;
      return nextSaver;
    })();
  }

  try {
    return await setupPromise;
  } catch (error) {
    setupPromise = undefined;
    throw error;
  }
}

export function resetMongoCheckpointer(): void {
  saver = undefined;
  setupPromise = undefined;
}
