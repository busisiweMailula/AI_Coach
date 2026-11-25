import { describe, expect, it, vi } from "vitest";
import { createPresidioResumeAnonymizer } from "../src/modules/privacy/presidio-anonymizer.js";

describe("Presidio resume anonymizer client", () => {
  it("sends resume text to the configured endpoint and returns only the anonymized result", async () => {
    const fetchImpl = vi.fn(async (_input: string, _init: RequestInit) =>
      new Response(JSON.stringify({ anonymizedText: "<PERSON> is a software engineer" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const anonymizer = createPresidioResumeAnonymizer({
      serviceUrl: "http://127.0.0.1:5002/",
      timeoutMs: 1_000,
      apiToken: "a-valid-test-token-with-at-least-32-chars",
      fetchImpl,
    });

    await expect(anonymizer.anonymize("Jane Doe is a software engineer"))
      .resolves.toBe("<PERSON> is a software engineer");

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:5002/anonymize",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer a-valid-test-token-with-at-least-32-chars",
        },
        body: JSON.stringify({ text: "Jane Doe is a software engineer" }),
      }),
    );
  });

  it("fails closed when the service is unreachable", async () => {
    const anonymizer = createPresidioResumeAnonymizer({
      serviceUrl: "http://127.0.0.1:5002",
      timeoutMs: 1_000,
      fetchImpl: vi.fn(async () => {
        throw new Error("connection refused");
      }),
    });

    await expect(anonymizer.anonymize("sensitive CV text"))
      .rejects.toMatchObject({ statusCode: 503 });
  });

  it("rejects unsuccessful or malformed service responses", async () => {
    for (const response of [
      new Response("service failure", { status: 500 }),
      new Response(JSON.stringify({ text: "not the expected response shape" }), { status: 200 }),
    ]) {
      const anonymizer = createPresidioResumeAnonymizer({
        serviceUrl: "http://127.0.0.1:5002",
        timeoutMs: 1_000,
        fetchImpl: vi.fn(async () => response),
      });

      await expect(anonymizer.anonymize("sensitive CV text"))
        .rejects.toMatchObject({ statusCode: 502 });
    }
  });

  it("fails closed if the service returns a placeholder outside the four allowed types", async () => {
    const anonymizer = createPresidioResumeAnonymizer({
      serviceUrl: "http://127.0.0.1:5002",
      timeoutMs: 1_000,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        anonymizedText: "Built a <ORGANIZATION> agent",
      }), { status: 200 })),
    });

    await expect(anonymizer.anonymize("Built a LangGraph agent"))
      .rejects.toMatchObject({ statusCode: 502 });
  });
});
