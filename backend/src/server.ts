import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { ensureIndexes } from "./infra/db/indexes.js";
import { closeDatabase, connectDatabase } from "./infra/db/database.js";
import { resumeQueuedAgentJobs } from "./infra/jobs/job-queue.js";
import { bootstrapDemoAdmin } from "./modules/users/demo-admin-bootstrap.js";

async function start(): Promise<void> {
  await connectDatabase();
  await ensureIndexes();
  if (process.env.DEMO_ADMIN_EMAIL || process.env.DEMO_ADMIN_PASSWORD) {
    const result = await bootstrapDemoAdmin({
      nodeEnv: env.NODE_ENV,
      email: process.env.DEMO_ADMIN_EMAIL,
      password: process.env.DEMO_ADMIN_PASSWORD,
    });
    logger.info({ result }, "Local demo admin bootstrap checked");
  }
  await resumeQueuedAgentJobs();

  const app = createApp();
  const onListening = () => {
    logger.info({ port: env.PORT }, "API server listening");
  };
  const server = env.NODE_ENV === "development"
    ? app.listen(env.PORT, "127.0.0.1", onListening)
    : app.listen(env.PORT, onListening);

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

