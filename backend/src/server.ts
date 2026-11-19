import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { ensureIndexes } from "./infra/db/indexes.js";
import { closeDatabase, connectDatabase } from "./infra/db/database.js";
import { resumeQueuedAgentJobs } from "./infra/jobs/job-queue.js";

async function start(): Promise<void> {
  await connectDatabase();
  await ensureIndexes();
  await resumeQueuedAgentJobs();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "API server listening");
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "Shutting down");
    server.close((error) => {
      void closeDatabase().then(() => {
        if (error) {
          logger.error({ err: error }, "HTTP server shutdown failed");
          process.exitCode = 1;
        }
      });
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

start().catch(async (error: unknown) => {
  logger.fatal({ err: error }, "Failed to start API server");
  await closeDatabase();
  process.exitCode = 1;
});

