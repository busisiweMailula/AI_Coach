import { connectDatabase, closeDatabase, getDb } from "../src/infra/db/database.js";
import { rebuildResumeVectorIndex, splitResumeText } from "../src/infra/embeddings/resume-semantic-search.js";
import { env } from "../src/config/env.js";
import type { ResumeDocument } from "../src/modules/resumes/resume.model.js";

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  if ([...args].some((arg) => arg !== "--dry-run")) {
    throw new Error("Usage: npm run reingest:resumes -- [--dry-run]");
  }
  const dryRun = args.has("--dry-run");
  if (!dryRun && env.EMBEDDING_PROVIDER !== "mistral") {
    throw new Error("Set EMBEDDING_PROVIDER=mistral before rebuilding resume vectors");
  }

  await connectDatabase();
  try {
    const resumes = await getDb().collection<ResumeDocument>("resumes").find({}).toArray();
    let indexed = 0;
    let empty = 0;
    let chunkCount = 0;
    for (const resume of resumes) {
      if (!resume.extractedText?.trim()) {
        empty += 1;
        if (!dryRun) {
          await rebuildResumeVectorIndex({
            ownerId: resume.ownerId,
            resumeId: resume._id,
            resumeText: "",
          });
        }
        continue;
      }

      const chunks = splitResumeText(resume.extractedText);
      chunkCount += chunks.length;
      indexed += 1;
      if (!dryRun) {
        await rebuildResumeVectorIndex({
          ownerId: resume.ownerId,
          resumeId: resume._id,
          resumeText: resume.extractedText,
        });
      }
    }

    console.log(JSON.stringify({
      mode: dryRun ? "dry-run" : "reingest",
      resumes: resumes.length,
      indexedResumes: indexed,
      emptyResumes: empty,
      chunks: chunkCount,
      vectorIndex: dryRun ? "unchanged" : "rebuilt from original extracted text",
      bm25Index: "not implemented in this repository",
    }));
  } finally {
    await closeDatabase();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Resume re-ingestion failed");
  process.exitCode = 1;
});
