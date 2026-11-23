import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Express } from "express";
import JSZip from "jszip";
import { ObjectId } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const storageRoot = path.join(os.tmpdir(), `ai-coach-phase4-${randomUUID()}`);
const databasePath = path.join(os.tmpdir(), `ai-coach-phase4-${randomUUID()}.json`);
let app: Express;
let database: import("../src/infra/db/json-database.js").JsonDatabase;
let candidateToken: string;
let otherCandidateToken: string;
let connectDatabase: typeof import("../src/infra/db/database.js").connectDatabase;
let closeDatabase: typeof import("../src/infra/db/database.js").closeDatabase;
let ensureIndexes: typeof import("../src/infra/db/indexes.js").ensureIndexes;
let signAccessToken: typeof import("../src/middleware/auth.js").signAccessToken;
let bootstrapDemoAdmin: typeof import("../src/modules/users/demo-admin-bootstrap.js").bootstrapDemoAdmin;

beforeAll(async () => {
  process.env.JSON_DB_PATH = databasePath;
  process.env.FILE_STORAGE_DIR = storageRoot;
  process.env.MAX_UPLOAD_BYTES = "2048";

  const [databaseModule, indexModule, appModule, authModule, bootstrapModule] = await Promise.all([
    import("../src/infra/db/database.js"),
    import("../src/infra/db/indexes.js"),
    import("../src/app.js"),
    import("../src/middleware/auth.js"),
    import("../src/modules/users/demo-admin-bootstrap.js"),
  ]);
  connectDatabase = databaseModule.connectDatabase;
  closeDatabase = databaseModule.closeDatabase;
  ensureIndexes = indexModule.ensureIndexes;
  signAccessToken = authModule.signAccessToken;
  bootstrapDemoAdmin = bootstrapModule.bootstrapDemoAdmin;
  database = await connectDatabase();
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
  await closeDatabase();
  await rm(storageRoot, { recursive: true, force: true });
  await rm(databasePath, { force: true });
});

describe("Phase 4 intake APIs", () => {
  it("bootstraps a development-only admin without changing existing accounts", async () => {
    const credentials = {
      nodeEnv: "development",
      email: "Demo.Admin@example.com",
      password: "local-demo-admin-password",
    };

    expect(await bootstrapDemoAdmin(credentials)).toBe("created");
    expect(await bootstrapDemoAdmin(credentials)).toBe("already_exists");
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "demo.admin@example.com", password: credentials.password });
    expect(login.status).toBe(200);
    expect(login.body.data.user.role).toBe("admin");
    await expect(bootstrapDemoAdmin({ ...credentials, nodeEnv: "production" }))
      .rejects.toThrow("only available in development");

    await database.collection("users").insertOne({
      _id: new ObjectId(),
      email: "candidate-owner@example.com",
      passwordHash: "not-used-in-this-test",
      role: "candidate",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(bootstrapDemoAdmin({
      ...credentials,
      email: "candidate-owner@example.com",
    })).rejects.toThrow("already used by a non-admin account");
  });

  it("allows candidates to register and then sign in", async () => {
    const email = `candidate-${randomUUID()}@example.com`;
    const password = "candidate-password-123";
    const registration = await request(app)
      .post("/api/v1/auth/register")
      .send({ email, password });

    expect(registration.status).toBe(201);
    expect(registration.body.data.user).toMatchObject({ email, role: "candidate", status: "active" });
    expect(registration.body.data.user.passwordHash).toBeUndefined();

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password });
    expect(login.status).toBe(200);
    expect(login.body.data.accessToken).toBeTruthy();
  });

  it("rejects self-selected roles during registration and blocks candidates from admin management", async () => {
    const registration = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: `self-coach-${randomUUID()}@example.com`, password: "candidate-password-123", role: "coach" });
    expect(registration.status).toBe(400);

    const adminPage = await request(app)
      .get("/api/v1/admin/users")
      .set("Authorization", `Bearer ${candidateToken}`);
    expect(adminPage.status).toBe(403);
  });

  it("keeps candidates from becoming coaches and lets admins deactivate and reactivate accounts", async () => {
    const adminId = new ObjectId("65f0c0a3f6b8a7b123456786");
    const now = new Date();
    for (const user of [
      {
        _id: adminId,
        email: "admin@example.com",
        passwordHash: "not-used-in-this-test",
        role: "admin",
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: new ObjectId("65f0c0a3f6b8a7b123456789"),
        email: "candidate@example.com",
        passwordHash: "not-used-in-this-test",
        role: "candidate",
        createdAt: now,
        updatedAt: now,
      },
    ]) await database.collection("users").insertOne(user);
    const adminToken = signAccessToken({
      userId: adminId.toHexString(),
      email: "admin@example.com",
      role: "admin",
    });
    const candidateAdminAccess = await request(app)
      .get("/api/v1/admin/audit-logs")
      .set("Authorization", `Bearer ${candidateToken}`);
    expect(candidateAdminAccess.status).toBe(403);
    const candidateCoachRegistration = await request(app)
      .post("/api/v1/admin/users")
      .set("Authorization", `Bearer ${candidateToken}`)
      .send({ email: "self-assigned-coach@example.com", password: "coach-initial-password-123" });
    expect(candidateCoachRegistration.status).toBe(403);

    const list = await request(app)
      .get("/api/v1/admin/users")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.users).toHaveLength(2);
    expect(list.body.data.users.every((user: { passwordHash?: string; status: string }) => (
      user.passwordHash === undefined && user.status === "active"
    ))).toBe(true);

    const candidateRoleChange = await request(app)
      .patch("/api/v1/admin/users/65f0c0a3f6b8a7b123456789/role")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role: "coach" });
    expect(candidateRoleChange.status).toBe(404);
    expect((await database.collection("users").findOne({ _id: new ObjectId("65f0c0a3f6b8a7b123456789") }))?.role).toBe("candidate");

    const registeredCoach = await request(app)
      .post("/api/v1/admin/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "new-coach@example.com", password: "coach-initial-password-123" });
    expect(registeredCoach.status).toBe(201);
    expect(registeredCoach.body.data.user).toMatchObject({ email: "new-coach@example.com", role: "coach", status: "active" });
    expect(registeredCoach.body.data.user.passwordHash).toBeUndefined();
    const coachLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "new-coach@example.com", password: "coach-initial-password-123" });
    expect(coachLogin.status).toBe(200);
    expect(coachLogin.body.data.user.role).toBe("coach");

    const cannotRegisterAdmin = await request(app)
      .post("/api/v1/admin/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "another-admin@example.com", password: "coach-initial-password-123", role: "admin" });
    expect(cannotRegisterAdmin.status).toBe(400);

    const deactivateCandidate = await request(app)
      .patch("/api/v1/admin/users/65f0c0a3f6b8a7b123456789/status")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "disabled" });
    expect(deactivateCandidate.status).toBe(200);
    expect(deactivateCandidate.body.data.user).toMatchObject({ role: "candidate", status: "disabled" });
    expect((await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${candidateToken}`)).status).toBe(401);
    const reactivateCandidate = await request(app)
      .patch("/api/v1/admin/users/65f0c0a3f6b8a7b123456789/status")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });
    expect(reactivateCandidate.status).toBe(200);
    expect((await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${candidateToken}`)).status).toBe(200);

    const adminCannotDeactivateAdmin = await request(app)
      .patch(`/api/v1/admin/users/${adminId.toHexString()}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "disabled" });
    expect(adminCannotDeactivateAdmin.status).toBe(409);

    const coachId = new ObjectId(registeredCoach.body.data.user.id);
    const coachToken = coachLogin.body.data.accessToken as string;
    const deactivateCoach = await request(app)
      .patch(`/api/v1/admin/users/${coachId.toHexString()}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "disabled" });
    expect(deactivateCoach.status).toBe(200);
    expect((await request(app)
      .get("/api/v1/reviews/pending")
      .set("Authorization", `Bearer ${coachToken}`)).status).toBe(401);
    expect((await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "new-coach@example.com", password: "coach-initial-password-123" })).status).toBe(401);
    const reactivateCoach = await request(app)
      .patch(`/api/v1/admin/users/${coachId.toHexString()}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });
    expect(reactivateCoach.status).toBe(200);
    expect((await request(app)
      .get("/api/v1/reviews/pending")
      .set("Authorization", `Bearer ${coachToken}`)).status).toBe(200);

    expect(await database.collection("audit_logs").countDocuments({ action: "user_account_status_changed" })).toBe(4);
    const auditLogs = await request(app)
      .get("/api/v1/admin/audit-logs")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(auditLogs.status).toBe(200);
    expect(auditLogs.body.data.items.some((item: { action: string }) => item.action === "coach_account_registered")).toBe(true);
    expect(auditLogs.body.data.items.some((item: { action: string; previousStatus?: string; newStatus?: string }) => (
      item.action === "user_account_status_changed" && item.previousStatus === "active" && item.newStatus === "disabled"
    ))).toBe(true);
  });

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
    await closeDatabase();
    const upload = await request(app)
      .post("/api/v1/resumes/upload")
      .set("Authorization", `Bearer ${candidateToken}`)
      .attach("file", await createDocx("Built secure APIs."), {
        filename: "resume.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    expect(upload.status).toBe(500);
    expect(upload.body.error.code).toBe("INTERNAL_ERROR");

    database = await connectDatabase();
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
