import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorHandler } from "../src/middleware/error-handler.js";
import { authMiddleware, requireRole, signAccessToken } from "../src/middleware/auth.js";

describe("RBAC middleware", () => {
  it("returns 403 when an authenticated candidate requests an admin-only action", async () => {
    const app = express();
    app.get("/admin", authMiddleware, requireRole("admin"), (_req, res) => {
      res.sendStatus(204);
    });
    app.use(errorHandler);

    const token = signAccessToken({
      userId: "candidate-1",
      email: "candidate@example.com",
      role: "candidate",
    });

    const response = await request(app)
      .get("/admin")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });
});

