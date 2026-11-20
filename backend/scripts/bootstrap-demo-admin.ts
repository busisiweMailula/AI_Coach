import { closeDatabase, connectDatabase } from "../src/infra/db/database.js";
import { env } from "../src/config/env.js";
import { ensureIndexes } from "../src/infra/db/indexes.js";
import { bootstrapDemoAdmin } from "../src/modules/users/demo-admin-bootstrap.js";

async function main(): Promise<void> {
  await connectDatabase();
  try {
    await ensureIndexes();
    const result = await bootstrapDemoAdmin({
      nodeEnv: env.NODE_ENV,
      email: process.env.DEMO_ADMIN_EMAIL,
      password: process.env.DEMO_ADMIN_PASSWORD,
    });
    console.log(result === "created"
      ? "Local demo admin created. Sign in with the email and password you supplied."
      : "A local admin account already exists for that email; no changes were made.");
  } finally {
    await closeDatabase();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Local demo admin bootstrap failed");
  process.exitCode = 1;
});
