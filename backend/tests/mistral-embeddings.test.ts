import { describe, expect, it, vi } from "vitest";
import { MistralEmbedder, MISTRAL_EMBEDDING_DIMENSIONS } from "../src/infra/embeddings/mistral-embedder.js";
import {
  rankResumeEvidence,
  splitResumeText,
} from "../src/infra/embeddings/resume-semantic-search.js";

describe("Mistral embeddings", () => {
  it("sends a batch to Mistral and restores vectors to input order", async () => {
    const first = Array<number>(MISTRAL_EMBEDDING_DIMENSIONS).fill(0.1);
    const second = Array<number>(MISTRAL_EMBEDDING_DIMENSIONS).fill(0.2);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      data: [
        { index: 1, embedding: second },
        { index: 0, embedding: first },
      ],
    }), { status: 200 }));
    const embedder = new MistralEmbedder("test-key", "mistral-embed", 1_000, fetchMock);

    const vectors = await embedder.embed(["resume text", "job text"]);

    expect(vectors).toEqual([first, second]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.mistral.ai/v1/embeddings",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
        body: JSON.stringify({ model: "mistral-embed", input: ["resume text", "job text"] }),
      }),
    );
  });

  it("rejects responses with the wrong vector dimensions", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
    }), { status: 200 }));
    const embedder = new MistralEmbedder("test-key", "mistral-embed", 1_000, fetchMock);

    await expect(embedder.embed(["resume text"])).rejects.toThrow("invalid embedding vector");
  });

  it("splits large input sets into bounded API batches", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const requestBody = JSON.parse(String(init?.body)) as { input: string[] };
      return new Response(JSON.stringify({
        data: requestBody.input.map((_, index) => ({
          index,
          embedding: Array<number>(MISTRAL_EMBEDDING_DIMENSIONS).fill(0.1),
        })),
      }), { status: 200 });
    });
    const embedder = new MistralEmbedder("test-key", "mistral-embed", 1_000, fetchMock);
    const inputs = Array.from({ length: 33 }, (_, index) => `text ${index}`);

    const vectors = await embedder.embed(inputs);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vectors).toHaveLength(inputs.length);
  });
});

describe("resume vector search", () => {
  it("splits text into bounded chunks without dropping non-whitespace content", () => {
    const text = `${"a".repeat(1_100)} ${"b".repeat(1_100)}`;

    const chunks = splitResumeText(text);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 1_200)).toBe(true);
    expect(chunks.join(" ")).toBe(text);
  });

  it("ranks only the caller-provided resume vectors by cosine similarity", () => {
    const ranked = rankResumeEvidence([
      { content: "lower match", embedding: [1, 0] },
      { content: "best match", embedding: [0.8, 0.6] },
      { content: "invalid dimensions", embedding: [0, 1, 2] },
    ], [0.8, 0.6], 2);

    expect(ranked).toEqual([
      { content: "best match", score: 1 },
      { content: "lower match", score: 0.8 },
    ]);
  });
});
