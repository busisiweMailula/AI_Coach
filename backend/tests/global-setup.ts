import { MongoMemoryServer } from "mongodb-memory-server";

export default async function setup() {
  if (process.env.MONGODB_TEST_URI) return;

  const server = await MongoMemoryServer.create({
    binary: {
      version: process.env.MONGODB_TEST_VERSION ?? "7.0.14",
    },
    instance: {
      ip: "127.0.0.1",
      args: ["--wiredTigerCacheSizeGB", "0.25"],
    },
  });
  process.env.MONGODB_TEST_URI = server.getUri();

  return async () => {
    delete process.env.MONGODB_TEST_URI;
    await server.stop();
  };
}
