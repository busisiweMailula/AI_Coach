import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Express } from "express";
import JSZip from "jszip";
import { ObjectId } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let app: Express;
let database: import("../src/infra/db/json-database.js").JsonDatabase;
let ownerId: ObjectId;
let coachId: ObjectId;
let otherId: ObjectId;
let ownerToken: string;
let coachToken: string;
let otherToken: string;
let connectDatabase: typeof import("../src/infra/db/database.js").connectDatabase;
let closeDatabase: typeof import("../src/infra/db/database.js").closeDatabase;
let ensureIndexes: typeof import("../src/infra/db/indexes.js").ensureIndexes;
let signAccessToken: typeof import("../src/middleware/auth.js").signAccessToken;
let configureResumeAnonymizer: typeof import("../src/modules/privacy/resume-anonymizer.js").configureResumeAnonymizer;
const storageRoot = path.join(os.tmpdir(), `ai-coach-phase5-${randomUUID()}`);
const databasePath = path.join(os.tmpdir(), `ai-coach-phase5-${randomUUID()}.json`);

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_MODEL = "mock-v1";
  process.env.JSON_DB_PATH = databasePath;
  process.env.FILE_STORAGE_DIR = storageRoot;

  const [databaseModule, indexModule, appModule, authModule, anonymizerModule] = await Promise.all([
    import("../src/infra/db/database.js"),
    import("../src/infra/db/indexes.js"),
    import("../src/app.js"),
    import("../src/middleware/auth.js"),
    import("../src/modules/privacy/resume-anonymizer.js"),
  ]);
  connectDatabase = databaseModule.connectDatabase;
  closeDatabase = databaseModule.closeDatabase;
  ensureIndexes = indexModule.ensureIndexes;
  signAccessToken = authModule.signAccessToken;
  configureResumeAnonymizer = anonymizerModule.configureResumeAnonymizer;
  configureResumeAnonymizer({ anonymize: async (text) => text });
  database = await connectDatabase();
  await ensureIndexes();
  app = appModule.createApp();

  ownerId = new ObjectId("65f0c0a3f6b8a7b123456789");
  coachId = new ObjectId("65f0c0a3f6b8a7b123456788");
  otherId = new ObjectId("65f0c0a3f6b8a7b123456787");
  ownerToken = signAccessToken({ userId: ownerId.toHexString(), email: "owner@example.com", role: "candidate" });
  coachToken = signAccessToken({ userId: coachId.toHexString(), email: "coach@example.com", role: "coach" });
  otherToken = signAccessToken({ userId: otherId.toHexString(), email: "other@example.com", role: "candidate" });
}, 120_000);

beforeEach(async () => {
  await database.dropDatabase();
  await ensureIndexes();
  await rm(storageRoot, { recursive: true, force: true });
  const now = new Date();
  for (const user of [
    {
      _id: ownerId,
      email: "owner@example.com",
      passwordHash: "not-used-in-this-test",
      role: "candidate",
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: coachId,
      email: "coach@example.com",
      passwordHash: "not-used-in-this-test",
      role: "coach",
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: otherId,
      email: "other@example.com",
      passwordHash: "not-used-in-this-test",
      role: "candidate",
      createdAt: now,
      updatedAt: now,
    },
  ]) await database.collection("users").insertOne(user);
  await database.collection("consents").insertOne({
    _id: new ObjectId(),
    ownerId,
    purpose: "external_model_processing",
    policyVersion: "external-model-v2",
    granted: true,
    recordedAt: new Date(),
    revokedAt: null,
    source: "settings",
  });
});

afterAll(async () => {
  await closeDatabase();
  await rm(storageRoot, { recursive: true, force: true });
  await rm(databasePath, { force: true });
});

describe("Phase 5 AI workflows", () => {
  it("runs resume and job-description agents and exposes persisted parse status", async () => {
    await grantResumeConsent();
    const upload = await request(app)
      .post("/api/v1/resumes/upload")
      .set("Authorization", `Bearer ${ownerToken}`)
      .attach("file", await createDocx("TypeScript developer who builds secure APIs."), {
        filename: "resume.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    expect(upload.status).toBe(201);
    expect(upload.body.data.resume.parseStatus).toBe("queued");

    const parseJobId = upload.body.data.resume.parseJobId as string;
    const parseStatus = await waitForJob(parseJobId);
    expect(parseStatus.status).toBe("succeeded");
    const parsedResume = await request(app)
      .get(`/api/v1/resumes/${upload.body.data.resume.id as string}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(parsedResume.status).toBe(200);
    expect(parsedResume.body.data.resume.parseStatus).toBe("parsed");
    expect(parsedResume.body.data.resume.parsedData.skills).toEqual([]);

    const jdSubmission = await request(app)
      .post("/api/v1/jobs/analyze")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ text: "Senior TypeScript engineer required to design secure APIs and mentor teams." });
    expect(jdSubmission.status).toBe(202);
    const jdJobStatus = await waitForJob(jdSubmission.body.data.jobId as string);
    expect(jdJobStatus.status).toBe("succeeded");
    const description = await request(app)
      .get(`/api/v1/jobs/${jdSubmission.body.data.jobDescriptionId as string}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(description.body.data.analysisStatus).toBe("succeeded");
    expect(description.body.data.analyzerVersion).toBe("jd-analyzer-v1");
  });

  it("computes a match in code, queues low-confidence review, and scopes it to its owner", async () => {
    await grantResumeConsent();
    const { resumeId, jobDescriptionId } = await seedResumeAndDescription("Experienced TypeScript developer.");
    const submitted = await request(app)
      .post("/api/v1/matching/analyze")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ resumeId: resumeId.toHexString(), jobDescriptionId: jobDescriptionId.toHexString() });
    expect(submitted.status).toBe(202);
    const status = await waitForJob(submitted.body.data.jobId as string);
    expect(status.status).toBe("succeeded");

    const matchId = status.resultId as string;
    const ownMatch = await request(app)
      .get(`/api/v1/matches/${matchId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(ownMatch.status).toBe(200);
    expect(ownMatch.body.data.score).toBe(100);
    expect(ownMatch.body.data.reviewStatus).toBe("pending_review");
    expect(ownMatch.body.data.disclaimer).toContain("not a hiring decision");

    const hiddenMatch = await request(app)
      .get(`/api/v1/matches/${matchId}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(hiddenMatch.status).toBe(404);

    const queue = await request(app)
      .get("/api/v1/reviews/pending")
      .set("Authorization", `Bearer ${coachToken}`);
    expect(queue.status).toBe(200);
    expect(queue.body.data.items).toHaveLength(1);
    const reviewId = queue.body.data.items[0].id as string;
    const details = await request(app)
      .get(`/api/v1/reviews/${reviewId}`)
      .set("Authorization", `Bearer ${coachToken}`);
    expect(details.status).toBe(200);
    expect(details.body.data.review.id).toBe(reviewId);
    expect(details.body.data.target.type).toBe("job_match");
    expect(details.body.data.target.skillResults[0].evidenceSnippet).toContain("TypeScript");

    const decision = await request(app)
      .post(`/api/v1/reviews/${reviewId}/decision`)
      .set("Authorization", `Bearer ${coachToken}`)
      .send({ decision: "approve", reason: "Evidence and score reviewed." });
    expect(decision.status).toBe(200);
    expect(decision.body.data.status).toBe("approved");
  });

  it("blocks fabricated resume suggestions and enforces external-model consent", async () => {
    await grantResumeConsent();
    const { resumeId, jobDescriptionId } = await seedResumeAndDescription("__test_fabrication_case__");
    const submission = await request(app)
      .post("/api/v1/resumes/optimize")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ resumeId: resumeId.toHexString(), jobDescriptionId: jobDescriptionId.toHexString() });
    expect(submission.status).toBe(202);
    const status = await waitForJob(submission.body.data.jobId as string);
    expect(status.status).toBe("failed");
    expect(status.error.code).toBe("FABRICATION_GUARDRAIL_HIT");
    const suggestions = await request(app)
      .get("/api/v1/suggestions")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(suggestions.body.data.items).toHaveLength(0);

    const noConsentResume = await seedResumeAndDescription("Python API developer", otherId);
    await grantResumeConsent(otherId);
    const noConsentJob = await request(app)
      .post("/api/v1/matching/analyze")
      .set("Authorization", `Bearer ${otherToken}`)
      .send({
        resumeId: noConsentResume.resumeId.toHexString(),
        jobDescriptionId: noConsentResume.jobDescriptionId.toHexString(),
      });
    expect(noConsentJob.status).toBe(202);
    const failedConsentJob = await waitForJob(noConsentJob.body.data.jobId as string, otherToken);
    expect(failedConsentJob.status).toBe("failed");
    expect(failedConsentJob.error.code).toBe("FORBIDDEN");
  });

  it("resumes an in-memory checkpoint after database reconnect and stores rubric evaluation and progress", async () => {
    await grantResumeConsent();
    const { resumeId, jobDescriptionId } = await seedResumeAndDescription("TypeScript backend engineer");
    const generated = await request(app)
      .post("/api/v1/interviews/generate")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ resumeId: resumeId.toHexString(), jobDescriptionId: jobDescriptionId.toHexString(), questionCount: 1 });
    expect(generated.status).toBe(202);
    const generationStatus = await waitForJob(generated.body.data.jobId as string);
    expect(generationStatus.status).toBe("succeeded");
    const questionSetId = generationStatus.resultId as string;

    const started = await request(app)
      .post("/api/v1/interviews")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ questionSetId });
    expect(started.status).toBe(201);
    const sessionId = started.body.data.id as string;
    expect(started.body.data.currentQuestion).toBeTruthy();

    await closeDatabase();
    database = await connectDatabase();
    await ensureIndexes();

    const answer = await request(app)
      .post(`/api/v1/interviews/${sessionId}/answer`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", "phase5-answer-key-001")
      .send({ answerText: "I would clarify requirements, design a small API, and test it." });
    expect(answer.status).toBe(200);
    expect(answer.body.data.status).toBe("evaluating");

    const evaluationJob = await database.collection("jobs").findOne({
      ownerId,
      type: "interview_evaluation",
      "payload.sessionId": sessionId,
    });
    expect(evaluationJob).toBeTruthy();
    const evaluationStatus = await waitForJob(evaluationJob?._id.toHexString() ?? "");
    expect(evaluationStatus.status).toBe("succeeded");

    const results = await request(app)
      .get(`/api/v1/interviews/${sessionId}/results`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(results.status).toBe(200);
    expect(results.body.data.status).toBe("completed");
    expect(results.body.data.evaluations[0].rubricVersion).toBe("1.0.0");
    const progress = await request(app)
      .get("/api/v1/candidates/me/progress")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(progress.body.data.completedInterviews).toBe(1);
    expect(progress.body.data.completedEvaluations).toBe(1);

    const duplicate = await request(app)
      .post(`/api/v1/interviews/${sessionId}/answer`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", "phase5-answer-key-001")
      .send({ answerText: "I would clarify requirements, design a small API, and test it." });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.data.status).toBe("completed");
  });

  it("fails closed rather than sending raw CV text when anonymization is unavailable", async () => {
    await grantResumeConsent();
    configureResumeAnonymizer(undefined);
    try {
      const upload = await request(app)
        .post("/api/v1/resumes/upload")
        .set("Authorization", `Bearer ${ownerToken}`)
        .attach("file", await createDocx("Private Candidate Name built secure APIs."), {
          filename: "resume.docx",
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
      expect(upload.status).toBe(201);
      const status = await waitForJob(upload.body.data.resume.parseJobId as string);
      expect(status.status).toBe("failed");
      expect(status.error.code).toBe("SERVICE_UNAVAILABLE");
      expect(await database.collection("agent_executions").countDocuments({
        ownerId,
        task: "resume_parser",
      })).toBe(0);
    } finally {
      configureResumeAnonymizer({ anonymize: async (text) => text });
    }
  });
});

async function seedResumeAndDescription(
  resumeText: string,
  candidateId = ownerId,
): Promise<{ resumeId: ObjectId; jobDescriptionId: ObjectId }> {
  const resumeId = new ObjectId();
  const jobDescriptionId = new ObjectId();
  const now = new Date();
  await database.collection("resumes").insertOne({
    _id: resumeId,
    ownerId: candidateId,
    originalFileName: "resume.pdf",
    contentType: "application/pdf",
    sizeBytes: Buffer.byteLength(resumeText),
    sha256: "a".repeat(64),
    storageKey: `resumes/${candidateId.toHexString()}/${resumeId.toHexString()}.pdf`,
    extractedText: resumeText,
    textExtractionStatus: "extracted",
    parseStatus: "uploaded",
    createdAt: now,
    updatedAt: now,
  });
  await database.collection("job_descriptions").insertOne({
    _id: jobDescriptionId,
    ownerId: candidateId,
    sourceType: "paste",
    sourceFileKey: null,
    rawText: "Required skill: TypeScript. Build and maintain secure APIs.",
    normalizedText: "Required skill: TypeScript. Build and maintain secure APIs.",
    analysisStatus: "succeeded",
    analysisJobId: new ObjectId(),
    requiredSkills: [{ name: "TypeScript", evidenceSnippet: "Required skill: TypeScript" }],
    preferredSkills: [],
    responsibilities: [],
    createdAt: now,
    updatedAt: now,
  });
  return { resumeId, jobDescriptionId };
}

async function grantResumeConsent(candidateId = ownerId): Promise<void> {
  await database.collection("consents").insertOne({
    _id: new ObjectId(),
    ownerId: candidateId,
    purpose: "resume_processing",
    policyVersion: "resume-processing-v3",
    granted: true,
    recordedAt: new Date(),
    revokedAt: null,
    source: "settings",
  });
}

async function waitForJob(jobId: string, token = ownerToken): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await request(app)
      .get(`/api/v1/jobs/status/${jobId}`)
      .set("Authorization", `Bearer ${token}`);
    if (response.body.data?.status === "succeeded" || response.body.data?.status === "failed") {
      return response.body.data as Record<string, unknown>;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Job ${jobId} did not finish in time`);
}

async function createDocx(text: string): Promise<Buffer> {
  const archive = new JSZip();
  archive.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>",
  );
  archive.file(
    "word/document.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
  );
  return archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
