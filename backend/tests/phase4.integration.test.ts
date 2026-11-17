import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Express } from "express";
import JSZip from "jszip";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const storageRoot = path.join(os.tmpdir(), `ai-coach-phase4-${randomUUID()}`);
let mongo: MongoMemoryServer;
let app: Express;
let database: import("mongodb").Db;
let candidateToken: string;
let otherCandidateToken: string;
let connectMongo: typeof import("../src/infra/db/mongo.js").connectMongo;
let closeMongo: typeof import("../src/infra/db/mongo.js").closeMongo;
let ensureIndexes: typeof import("../src/infra/db/indexes.js").ensureIndexes;
let signAccessToken: typeof import("../src/middleware/auth.js").signAccessToken;

beforeAll(async () => {
  process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/ai-coach-test";
  process.env.MONGODB_DB_NAME = "ai-coach-phase4-test";
  process.env.FILE_STORAGE_DIR = storageRoot;
  process.env.MAX_UPLOAD_BYTES = "2048";

  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();

  const [mongoModule, indexModule, appModule, authModule] = await Promise.all([
    import("../src/infra/db/mongo.js"),
    import("../src/infra/db/indexes.js"),
    import("../src/app.js"),
    import("../src/middleware/auth.js"),
  ]);
  connectMongo = mongoModule.connectMongo;
  closeMongo = mongoModule.closeMongo;
  ensureIndexes = indexModule.ensureIndexes;
  signAccessToken = authModule.signAccessToken;
  database = await connectMongo();
  await ensureIndexes();
  app = appModule.createApp();
  candidateToken = signAccessToken({
    userId: "65f0c0a3f6b8a7b123456789",
    email: "candidate@example.com",
    role: "candidate",
  });
  otherCandidateToken = signAccessToken({
    userId: "65f0c0a3f6b8a7b123456788",
    email: "other@example.com",
    role: "candidate",
  });
}, 120_000);

beforeEach(async () => {
  await database.dropDatabase();
  await ensureIndexes();
  await rm(storageRoot, { recursive: true, force: true });
});

afterAll(async () => {
  await closeMongo();
  await mongo.stop();
  await rm(storageRoot, { recursive: true, force: true });
});

describe("Phase 4 intake APIs", () => {
  it("requires explicit consent and only allows the owner to read or edit an uploaded resume", async () => {
    const docx = await createDocx("Built secure APIs and automated document processing.");
    const missingConsent = await request(app)
      .post("/api/v1/resumes/upload")
      .set("Authorization", `Bearer ${candidateToken}`)
      .attach("file", docx, {
        filename: "resume.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    expect(missingConsent.status).toBe(403);

    const bypassAttempt = await request(app)
      .post("/api/v1/resumes/upload")
      .set("Authorization", `Bearer ${candidateToken}`)
      .field("consent", "true")
      .attach("file", docx, {
        filename: "resume.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    expect(bypassAttempt.status).toBe(403);

    const spoofedVersion = await request(app)
      .put("/api/v1/candidates/me/consents")
      .set("Authorization", `Bearer ${candidateToken}`)
      .send({
        purpose: "resume_processing",
        policyVersion: "resume-processing-v99",
        granted: true,
      });
    expect(spoofedVersion.status).toBe(400);

    const grant = await request(app)
      .put("/api/v1/candidates/me/consents")
      .set("Authorization", `Bearer ${candidateToken}`)
      .send({
        purpose: "resume_processing",
        granted: true,
      });
    expect(grant.status).toBe(200);
    expect(grant.body.data.policyVersion).toBe("resume-processing-v3");
    expect(grant.body.data.recordedAt).toBeTypeOf("string");
    const status = await request(app)
      .get("/api/v1/candidates/me/consents/status")
      .set("Authorization", `Bearer ${candidateToken}`);
    expect(status.status).toBe(200);
    expect(status.body.data.find((item: { purpose: string }) => item.purpose === "resume_processing"))
      .toMatchObject({ accepted: true, policyVersion: "resume-processing-v3" });

    const uploaded = await request(app)
      .post("/api/v1/resumes/upload")
      .set("Authorization", `Bearer ${candidateToken}`)
      .attach("file", docx, {
        filename: "resume.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.data.resume.extractedText).toContain("Built secure APIs");

    const resumeId = uploaded.body.data.resume.id as string;
    const pdfUpload = await request(app)
      .post("/api/v1/resumes/upload")
      .set("Authorization", `Bearer ${candidateToken}`)
      .attach("file", createPdf("Designed scalable database services."), {
        filename: "resume.pdf",
        contentType: "application/pdf",
      });
    expect(pdfUpload.status).toBe(201);
    expect(pdfUpload.body.data.resume.extractedText).toContain("Designed scalable database services");

    const forbiddenRead = await request(app)
      .get(`/api/v1/resumes/${resumeId}`)
      .set("Authorization", `Bearer ${otherCandidateToken}`);
    expect(forbiddenRead.status).toBe(404);

    const updated = await request(app)
      .patch(`/api/v1/resumes/${resumeId}`)
      .set("Authorization", `Bearer ${candidateToken}`)
      .send({ title: "Backend Engineer" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.resume.title).toBe("Backend Engineer");

    const revoked = await request(app)
      .put("/api/v1/candidates/me/consents")
      .set("Authorization", `Bearer ${candidateToken}`)
      .send({
        purpose: "resume_processing",
        granted: false,
      });
    expect(revoked.status).toBe(200);
    const history = await request(app)
      .get("/api/v1/candidates/me/consents")
      .set("Authorization", `Bearer ${candidateToken}`);
    expect(history.body.data).toHaveLength(2);
    expect(history.body.data[0].granted).toBe(false);
    expect(history.body.data[1].granted).toBe(true);

    const rejectedAfterRevocation = await request(app)
      .post("/api/v1/resumes/upload")
      .set("Authorization", `Bearer ${candidateToken}`)
      .attach("file", docx, {
        filename: "resume.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    expect(rejectedAfterRevocation.status).toBe(403);
  });

  it("rejects spoofed and oversized documents with explicit client errors", async () => {
    await recordResumeConsent();
    const token = candidateToken;
    const spoofed = await request(app)
      .post("/api/v1/resumes/upload")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from("not a PDF"), {
        filename: "resume.pdf",
        contentType: "application/pdf",
      });
    expect(spoofed.status).toBe(415);

    const oversized = await request(app)
      .post("/api/v1/resumes/upload")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.alloc(2049, 65), {
        filename: "large.pdf",
        contentType: "application/pdf",
      });
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe("UPLOAD_TOO_LARGE");
  });

  it("requires renewed consent when the policy version changes", async () => {
    await database.collection("consents").insertOne({
      _id: new ObjectId(),
      ownerId: new ObjectId("65f0c0a3f6b8a7b123456789"),
      purpose: "resume_processing",
      policyVersion: "resume-processing-v1",
      granted: true,
      recordedAt: new Date(),
      revokedAt: null,
      source: "settings",
    });

    const status = await request(app)
      .get("/api/v1/candidates/me/consents/status")
      .set("Authorization", `Bearer ${candidateToken}`);
    expect(status.body.data.find((item: { purpose: string }) => item.purpose === "resume_processing"))
      .toMatchObject({ accepted: false, policyVersion: "resume-processing-v3" });

    const upload = await request(app)
      .post("/api/v1/resumes/upload")
      .set("Authorization", `Bearer ${candidateToken}`)
      .attach("file", await createDocx("Built secure APIs."), {
        filename: "resume.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    expect(upload.status).toBe(403);
  });

  it("fails closed when stored consent cannot be retrieved", async () => {
    await recordResumeConsent();
    await closeMongo();
    const upload = await request(app)
      .post("/api/v1/resumes/upload")
      .set("Authorization", `Bearer ${candidateToken}`)
      .attach("file", await createDocx("Built secure APIs."), {
        filename: "resume.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    expect(upload.status).toBe(500);
    expect(upload.body.error.code).toBe("INTERNAL_ERROR");

    database = await connectMongo();
    await ensureIndexes();
  });

  it("persists pasted job descriptions and returns owner-scoped queued job status", async () => {
    const invalid = await request(app)
      .post("/api/v1/jobs/analyze")
      .set("Authorization", `Bearer ${candidateToken}`)
      .send({ text: "too short" });
    expect(invalid.status).toBe(400);

    const submitted = await request(app)
      .post("/api/v1/jobs/analyze")
      .set("Authorization", `Bearer ${candidateToken}`)
      .send({
        text: "Senior backend engineer: build secure APIs, maintain MongoDB services, and automate deployments.",
      });
    expect(submitted.status).toBe(202);
    expect(submitted.body.data.status).toBe("queued");

    const { jobId, jobDescriptionId } = submitted.body.data as {
      jobId: string;
      jobDescriptionId: string;
    };
    const status = await request(app)
      .get(`/api/v1/jobs/status/${jobId}`)
      .set("Authorization", `Bearer ${candidateToken}`);
    expect(status.status).toBe(200);
    expect(status.body.data.status).toBe("queued");
    expect(status.body.data.resultId).toBe(jobDescriptionId);

    const detail = await request(app)
      .get(`/api/v1/jobs/${jobDescriptionId}`)
      .set("Authorization", `Bearer ${candidateToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.text).toContain("Senior backend engineer");

    const otherOwnerStatus = await request(app)
      .get(`/api/v1/jobs/status/${jobId}`)
      .set("Authorization", `Bearer ${otherCandidateToken}`);
    expect(otherOwnerStatus.status).toBe(404);

    const uploaded = await request(app)
      .post("/api/v1/jobs/analyze")
      .set("Authorization", `Bearer ${candidateToken}`)
      .attach("file", await createDocx("An uploaded job description with enough text to analyze."), {
        filename: "role.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    expect(uploaded.status).toBe(202);
    const uploadedDescription = await request(app)
      .get(`/api/v1/jobs/${uploaded.body.data.jobDescriptionId as string}`)
      .set("Authorization", `Bearer ${candidateToken}`);
    expect(uploadedDescription.status).toBe(200);
    expect(uploadedDescription.body.data.sourceType).toBe("upload");
    expect(uploadedDescription.body.data.text).toContain("uploaded job description");
  });
});

async function recordResumeConsent(): Promise<void> {
  await database.collection("consents").insertOne({
    _id: new ObjectId(),
    ownerId: new ObjectId("65f0c0a3f6b8a7b123456789"),
    purpose: "resume_processing",
    policyVersion: "resume-processing-v3",
    granted: true,
    recordedAt: new Date(),
    revokedAt: null,
    source: "settings",
  });
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
      `<w:body><w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
  );
  return archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function createPdf(text: string): Buffer {
  const content = `BT /F1 18 Tf 72 720 Td (${text.replace(/[\\()]/g, "\\$&")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`,
  ];
  let document = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(document, "ascii"));
    document += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(document, "ascii");
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    document += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document, "ascii");
}

function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (character) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      '"': "&quot;",
    };
    return entities[character];
  });
}
