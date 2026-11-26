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
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const anonymizer = createPresidioResumeAnonymizer({
      serviceUrl: "http://127.0.0.1:5002",
      timeoutMs: 1_000,
      fetchImpl,
      sleepImpl: async () => undefined,
    });

    await expect(anonymizer.anonymize("sensitive CV text"))
      .rejects.toMatchObject({ statusCode: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("rejects unsuccessful or malformed service responses", async () => {
    for (const response of [
      new Response("service failure", { status: 500 }),
      new Response(JSON.stringify({ text: "not the expected response shape" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      new Response(JSON.stringify({ anonymizedText: "A <UNSUPPORTED> value" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ]) {
      const anonymizer = createPresidioResumeAnonymizer({
        serviceUrl: "http://127.0.0.1:5002",
        timeoutMs: 1_000,
        fetchImpl: vi.fn(async () => response),
        sleepImpl: async () => undefined,
      });

      await expect(anonymizer.anonymize("sensitive CV text"))
        .rejects.toMatchObject({ statusCode: 502 });
    }
  });

  it("retries rate limits and server errors only, with a bounded attempt count", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ anonymizedText: "<PERSON> applied" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    const anonymizer = createPresidioResumeAnonymizer({
      serviceUrl: "http://127.0.0.1:5002",
      timeoutMs: 1_000,
      fetchImpl,
      sleepImpl: async () => undefined,
      randomImpl: () => 0,
    });

    await expect(anonymizer.anonymize("Jane applied")).resolves.toBe("<PERSON> applied");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-network programming failures", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("unexpected local failure");
    });
    const anonymizer = createPresidioResumeAnonymizer({
      serviceUrl: "http://127.0.0.1:5002",
      timeoutMs: 1_000,
      fetchImpl,
      sleepImpl: async () => undefined,
    });

    await expect(anonymizer.anonymize("sensitive CV text"))
      .rejects.toMatchObject({ statusCode: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("preserves known placeholders and rejects newly introduced unsupported placeholders", async () => {
    const anonymizer = createPresidioResumeAnonymizer({
      serviceUrl: "http://127.0.0.1:5002",
      timeoutMs: 1_000,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        anonymizedText: "<PERSON> has <EMAIL_ADDRESS>",
      }), { status: 200, headers: { "Content-Type": "application/json" } })),
    });

    await expect(anonymizer.anonymize("<PERSON> has mail"))
      .resolves.toBe("<PERSON> has <EMAIL_ADDRESS>");
  });
});
