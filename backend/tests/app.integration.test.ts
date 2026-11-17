import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("Phase 3 API foundation", () => {
  const app = createApp();

  it("serves the health endpoint", async () => {
    const response = await request(app).get("/api/v1/health");
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("ok");
    expect(response.headers["x-request-id"]).toBeTruthy();
  });

  it("leaves frontend routes to the React application", async () => {
    const response = await request(app).get("/");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("rejects unauthenticated profile access", async () => {
    const response = await request(app).get("/api/v1/users/me");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("does not allow public registration to assign a privileged role", async () => {
    const response = await request(app)
      .post("/api/v1/auth/register")
      .send({
        email: "candidate@example.com",
        password: "a-long-enough-password",
        role: "admin",
      });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("does not expose stack traces for missing routes", async () => {
    const response = await request(app).get("/not-a-route");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(response.body.stack).toBeUndefined();
  });
});

