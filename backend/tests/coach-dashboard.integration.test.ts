import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Express } from "express";
import { ObjectId } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { structureCv } from "../src/modules/resumes/structured-cv.js";
import { buildDeterministicCvSummary } from "../src/modules/reviews/reviews.service.js";

let app: Express;
let database: import("../src/infra/db/json-database.js").JsonDatabase;
let candidateId: ObjectId;
let coach1Id: ObjectId;
let coach2Id: ObjectId;
let adminId: ObjectId;
let candidateToken: string;
let coach1Token: string;
let coach2Token: string;
let adminToken: string;
let connectDatabase: typeof import("../src/infra/db/database.js").connectDatabase;
let closeDatabase: typeof import("../src/infra/db/database.js").closeDatabase;
let ensureIndexes: typeof import("../src/infra/db/indexes.js").ensureIndexes;
let signAccessToken: typeof import("../src/middleware/auth.js").signAccessToken;

const storageRoot = path.join(os.tmpdir(), `ai-coach-coach-test-${randomUUID()}`);
const databasePath = path.join(os.tmpdir(), `ai-coach-coach-test-${randomUUID()}.json`);

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.LLM_PROVIDER = "mock";
  process.env.EMBEDDING_PROVIDER = "disabled";
  process.env.RATE_LIMIT_MAX_REQUESTS = "1000";
  process.env.JSON_DB_PATH = databasePath;
  process.env.FILE_STORAGE_DIR = storageRoot;

  const [databaseModule, indexModule, appModule, authModule] = await Promise.all([
    import("../src/infra/db/database.js"),
    import("../src/infra/db/indexes.js"),
    import("../src/app.js"),
    import("../src/middleware/auth.js"),
  ]);
  connectDatabase = databaseModule.connectDatabase;
  closeDatabase = databaseModule.closeDatabase;
  ensureIndexes = indexModule.ensureIndexes;
  signAccessToken = authModule.signAccessToken;

  database = await connectDatabase();
  await ensureIndexes();
  app = appModule.createApp();

  candidateId = new ObjectId();
  coach1Id = new ObjectId();
  coach2Id = new ObjectId();
  adminId = new ObjectId();

  candidateToken = signAccessToken({ userId: candidateId.toHexString(), email: "candidate@example.com", role: "candidate" });
  coach1Token = signAccessToken({ userId: coach1Id.toHexString(), email: "coach1@example.com", role: "coach" });
  coach2Token = signAccessToken({ userId: coach2Id.toHexString(), email: "coach2@example.com", role: "coach" });
  adminToken = signAccessToken({ userId: adminId.toHexString(), email: "admin@example.com", role: "admin" });
});

beforeEach(async () => {
  await database.dropDatabase();
  await ensureIndexes();
  await rm(storageRoot, { recursive: true, force: true });

  const now = new Date();
  for (const user of [
    { _id: candidateId, email: "candidate@example.com", passwordHash: "hash", role: "candidate", createdAt: now, updatedAt: now },
    { _id: coach1Id, email: "coach1@example.com", passwordHash: "hash", role: "coach", createdAt: now, updatedAt: now },
    { _id: coach2Id, email: "coach2@example.com", passwordHash: "hash", role: "coach", createdAt: now, updatedAt: now },
    { _id: adminId, email: "admin@example.com", passwordHash: "hash", role: "admin", createdAt: now, updatedAt: now },
  ]) {
    await database.collection("users").insertOne(user);
  }

  // Grant human_review and resume_processing consents to candidate
  for (const consent of [
    {
      _id: new ObjectId(),
      ownerId: candidateId,
      purpose: "resume_processing",
      policyVersion: "resume-processing-v3",
      granted: true,
      recordedAt: now,
      revokedAt: null,
      source: "registration",
    },
    {
      _id: new ObjectId(),
      ownerId: candidateId,
      purpose: "human_review",
      policyVersion: "human-review-v1",
      granted: true,
      recordedAt: now,
      revokedAt: null,
      source: "registration",
    },
  ]) {
    await database.collection("consents").insertOne(consent);
  }
});

afterAll(async () => {
  await closeDatabase();
  await rm(storageRoot, { recursive: true, force: true });
  await rm(databasePath, { force: true });
});

describe("Coach Dashboard & Review Summary API", () => {
  it("enforces role guards on coach endpoints", async () => {
    // GET /api/v1/coach/dashboard
    const unauth = await request(app).get("/api/v1/coach/dashboard");
    expect(unauth.status).toBe(401);

    const candidateDash = await request(app)
      .get("/api/v1/coach/dashboard")
      .set("Authorization", `Bearer ${candidateToken}`);
    expect(candidateDash.status).toBe(403);

    const adminDash = await request(app)
      .get("/api/v1/coach/dashboard")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminDash.status).toBe(403);

    const coachDash = await request(app)
      .get("/api/v1/coach/dashboard")
      .set("Authorization", `Bearer ${coach1Token}`);
    expect(coachDash.status).toBe(200);
    expect(coachDash.body.success).toBe(true);
    expect(coachDash.body.data.stats).toBeDefined();
    expect(coachDash.body.data.stats.pending).toBe(0);
    expect(coachDash.body.data.queue.items).toEqual([]);
  });

  it("returns server-computed stats, nextReview, and paginated queue for coach", async () => {
    const resumeText = "JOHN DOE\nFull-Stack Engineer\n\nSUMMARY\nExperienced engineer building APIs.\n\nEXPERIENCE\nSenior Developer | Acme Corp | 2022 - Present\n• Built microservices\n\nSKILLS\nTypeScript, Node.js, React, Docker\n\nEDUCATION\nBSc Computer Science | Tech University | 2018 - 2021";
    const structured = structureCv(resumeText);
    const resumeId = new ObjectId();
    const jobDescriptionId = new ObjectId();
    const matchId = new ObjectId();
    const now = new Date();

    await database.collection("resumes").insertOne({
      _id: resumeId,
      ownerId: candidateId,
      originalFileName: "john_doe_resume.pdf",
      contentType: "application/pdf",
      sizeBytes: 1024,
      sha256: "b".repeat(64),
      storageKey: `resumes/${candidateId}/${resumeId}.pdf`,
      extractedText: resumeText,
      structuredCv: structured,
      textExtractionStatus: "extracted",
      parseStatus: "parsed",
      createdAt: now,
      updatedAt: now,
    });

    await database.collection("job_descriptions").insertOne({
      _id: jobDescriptionId,
      ownerId: candidateId,
      roleTitle: "Staff Software Engineer",
      rawText: "We are seeking a Staff Software Engineer with TypeScript and React experience.",
      requiredSkills: [
        { name: "TypeScript", evidenceSnippet: "TypeScript required" },
        { name: "React", evidenceSnippet: "React required" },
      ],
      createdAt: now,
      updatedAt: now,
    });

    await database.collection("job_matches").insertOne({
      _id: matchId,
      ownerId: candidateId,
      resumeId,
      jobDescriptionId,
      score: 85,
      skillResults: [
        { name: "TypeScript", status: "matched", evidenceSnippet: "TypeScript" },
        { name: "React", status: "matched", evidenceSnippet: "React" },
      ],
      missingSkills: [],
      strengths: ["Strong TypeScript"],
      disclaimer: "Indicative match only; not a hiring decision.",
      confidence: 0.9,
      reviewStatus: "pending_review",
      createdAt: now,
      updatedAt: now,
    });

    const reviewId = new ObjectId();
    await database.collection("review_items").insertOne({
      _id: reviewId,
      ownerId: candidateId,
      targetType: "job_match",
      targetId: matchId,
      flags: ["evidence_not_found_in_source"],
      riskLevel: "high",
      status: "pending_review",
      assignedCoachId: null,
      claimedAt: null,
      requestReason: null,
      decisionReason: null,
      decisionText: null,
      modifiedOutput: null,
      originalOutput: null,
      recommendations: [],
      internalNote: null,
      decidedBy: null,
      decidedAt: null,
      createdAt: new Date(Date.now() - 3600000), // 1 hour ago
      updatedAt: now,
    });

    const dash = await request(app)
      .get("/api/v1/coach/dashboard")
      .set("Authorization", `Bearer ${coach1Token}`);

    expect(dash.status).toBe(200);
    const data = dash.body.data;
    expect(data.stats.pending).toBe(1);
    expect(data.stats.byRisk.high).toBe(1);
    expect(data.stats.byType.job_match).toBe(1);
    expect(data.nextReview).not.toBeNull();
    expect(data.nextReview.id).toBe(reviewId.toHexString());
    expect(data.nextReview.accountEmail).toBe("candidate@example.com");
    expect(data.nextReview.jobTitle).toBe("Staff Software Engineer");
    expect(data.nextReview.riskLevel).toBe("high");
    expect(data.nextReview.flagReason).toContain("could not be found in the CV");
    expect(data.queue.total).toBe(1);
    expect(data.queue.items[0].id).toBe(reviewId.toHexString());

    // Summary endpoint: /api/v1/reviews/:reviewId/summary
    const summary = await request(app)
      .get(`/api/v1/reviews/${reviewId.toHexString()}/summary`)
      .set("Authorization", `Bearer ${coach1Token}`);

    expect(summary.status).toBe(200);
    const sumData = summary.body.data;
    expect(sumData.reviewId).toBe(reviewId.toHexString());
    expect(sumData.account.email).toBe("candidate@example.com");
    expect(sumData.account.flagReason).toContain("could not be found in the CV");
    expect(sumData.cv).not.toBeNull();
    expect(sumData.cv.fileName).toBe("john_doe_resume.pdf");
    expect(sumData.cv.headline).toBe("Full-Stack Engineer");
    expect(sumData.cv.mostRecentRole).toEqual({ title: "Senior Developer", company: "Acme Corp" });
    expect(sumData.cv.topSkills).toContain("TypeScript");
    expect(sumData.cv.highestEducation).toEqual({ degree: "BSc Computer Science", institution: "Tech University" });
    expect(sumData.cv.detectedSections).toContain("EXPERIENCE");
    expect(sumData.job).not.toBeNull();
    expect(sumData.job.title).toBe("Staff Software Engineer");
    expect(sumData.job.topSkills).toContain("TypeScript");
  });

  it("enforces coach scoping and consent checks on review summary and drawer endpoints", async () => {
    const resumeId = new ObjectId();
    const matchId = new ObjectId();
    const reviewId = new ObjectId();
    const now = new Date();

    await database.collection("job_matches").insertOne({
      _id: matchId,
      ownerId: candidateId,
      resumeId,
      jobDescriptionId: new ObjectId(),
      score: 90,
      skillResults: [],
      missingSkills: [],
      strengths: [],
      disclaimer: "Test",
      confidence: 0.9,
      reviewStatus: "in_review",
      createdAt: now,
      updatedAt: now,
    });

    // Review claimed by coach2 (not expired)
    await database.collection("review_items").insertOne({
      _id: reviewId,
      ownerId: candidateId,
      targetType: "job_match",
      targetId: matchId,
      flags: [],
      riskLevel: "medium",
      status: "in_review",
      assignedCoachId: coach2Id,
      claimedAt: new Date(),
      requestReason: null,
      decisionReason: null,
      decisionText: null,
      modifiedOutput: null,
      originalOutput: null,
      recommendations: [],
      internalNote: null,
      decidedBy: null,
      decidedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    // Coach 1 cannot access review claimed by Coach 2
    const forbiddenSummary = await request(app)
      .get(`/api/v1/reviews/${reviewId.toHexString()}/summary`)
      .set("Authorization", `Bearer ${coach1Token}`);
    expect(forbiddenSummary.status).toBe(403);

    // Coach 2 can access their claimed review
    const allowedSummary = await request(app)
      .get(`/api/v1/reviews/${reviewId.toHexString()}/summary`)
      .set("Authorization", `Bearer ${coach2Token}`);
    expect(allowedSummary.status).toBe(200);

    // Candidate revokes human_review consent
    await database.collection("consents").insertOne({
      _id: new ObjectId(),
      ownerId: candidateId,
      purpose: "human_review",
      policyVersion: "human-review-v1",
      granted: false,
      recordedAt: new Date(),
      revokedAt: new Date(),
      source: "settings",
    });

    const consentBlocked = await request(app)
      .get(`/api/v1/reviews/${reviewId.toHexString()}/summary`)
      .set("Authorization", `Bearer ${coach2Token}`);
    expect(consentBlocked.status).toBe(403);
  });

  it("creates audit log entries on drawer views without logging content", async () => {
    const resumeId = new ObjectId();
    const matchId = new ObjectId();
    const reviewId = new ObjectId();
    const now = new Date();

    await database.collection("job_matches").insertOne({
      _id: matchId,
      ownerId: candidateId,
      resumeId,
      jobDescriptionId: new ObjectId(),
      score: 90,
      skillResults: [],
      missingSkills: [],
      strengths: [],
      disclaimer: "Test",
      confidence: 0.9,
      reviewStatus: "pending_review",
      createdAt: now,
      updatedAt: now,
    });

    await database.collection("review_items").insertOne({
      _id: reviewId,
      ownerId: candidateId,
      targetType: "job_match",
      targetId: matchId,
      flags: [],
      riskLevel: "low",
      status: "pending_review",
      assignedCoachId: null,
      claimedAt: null,
      requestReason: null,
      decisionReason: null,
      decisionText: null,
      modifiedOutput: null,
      originalOutput: null,
      recommendations: [],
      internalNote: null,
      decidedBy: null,
      decidedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    // Test POST /api/v1/reviews/:reviewId/audit-view
    const cvAudit = await request(app)
      .post(`/api/v1/reviews/${reviewId.toHexString()}/audit-view`)
      .set("Authorization", `Bearer ${coach1Token}`)
      .send({ view: "cv" });
    expect(cvAudit.status).toBe(200);

    const jdAudit = await request(app)
      .post(`/api/v1/reviews/${reviewId.toHexString()}/audit-view`)
      .set("Authorization", `Bearer ${coach1Token}`)
      .send({ view: "job_description" });
    expect(jdAudit.status).toBe(200);

    // Verify audit logs in database
    const logs = await database.collection("audit_logs")
      .find({ targetId: reviewId })
      .toArray();

    expect(logs.length).toBeGreaterThanOrEqual(2);
    const actions = logs.map((l) => l.action);
    expect(actions).toContain("coach_view_cv_drawer");
    expect(actions).toContain("coach_view_job_description_drawer");

    for (const log of logs) {
      expect(log.actorId?.toHexString()).toBe(coach1Id.toHexString());
      expect(log.ownerId?.toHexString()).toBe(candidateId.toHexString());
      // Must not contain CV content or text
      expect(JSON.stringify(log)).not.toContain("Full-Stack Engineer");
      expect(JSON.stringify(log)).not.toContain("rawText");
    }
  });

  it("verifies CV summary is deterministic and contains only data from the CV", () => {
    const rawCv = "ALICE SMITH\nLead Systems Architect\n\nSUMMARY\nSpecialist in distributed architectures.\n\nEXPERIENCE\nPrincipal Architect | CloudWorks | 2020 - Present\nSenior Architect | NetCorp | 2017 - 2020\n\nSKILLS\nKubernetes, Go, Kafka, Distributed Systems\n\nEDUCATION\nMSc Distributed Computing | University of Cape Town | 2015 - 2017";
    const structured = structureCv(rawCv);
    const mockResume = {
      _id: new ObjectId(),
      originalFileName: "alice_smith.pdf",
      title: "Alice Smith CV",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      structuredCv: structured,
      extractedText: rawCv,
    };

    const run1 = buildDeterministicCvSummary(mockResume);
    const run2 = buildDeterministicCvSummary(mockResume);

    // Exact determinism: run 1 equals run 2 completely
    expect(run1).toEqual(run2);
    expect(run1?.fileName).toBe("alice_smith.pdf");
    expect(run1?.headline).toBe("Lead Systems Architect");
    expect(run1?.mostRecentRole).toEqual({ title: "Principal Architect", company: "CloudWorks" });
    expect(run1?.roleCount).toBe(2);
    expect(run1?.topSkills).toEqual(["Kubernetes", "Go", "Kafka", "Distributed Systems"]);
    expect(run1?.highestEducation).toEqual({ degree: "MSc Distributed Computing", institution: "University of Cape Town" });
    expect(run1?.detectedSections).toEqual(["SUMMARY", "EXPERIENCE", "SKILLS", "EDUCATION"]);
  });
});
