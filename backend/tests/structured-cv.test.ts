import { describe, expect, it } from "vitest";
import {
  applyAnchoredSuggestion,
  applyResumeSuggestion,
  findSuggestionTarget,
  getAnchoredOriginal,
  structureCv,
  type AnchoredSuggestion,
  type ResumeSuggestionTarget,
} from "../src/modules/resumes/structured-cv.js";
import {
  deriveStructuredCv,
  findNovelClaimWords,
  isCvReadyText,
  structuredCvVersion,
} from "../src/modules/resumes/resume-suggestions.js";
import { ObjectId } from "mongodb";

const sample = [
  "Thandiwe Mokoena",
  "PROFESSIONAL SUMMARY",
  "A concise source summary.",
  "CORE COMPETENCIES",
  "Languages: Python, TypeScript",
  "TECHNICAL SKILLS",
  "Python, SQL",
  "PROFESSIONAL EXPERIENCE",
  "Junior AI Engineer",
  "2024 – Present",
  "• Built a local model evaluation tool",
  "PROFESSIONAL EXPERIENCE (CONTINUED)",
  "AI Engineering Intern",
  "2023 – 2024",
  "• Built an internal prototype",
].join("\n");

describe("structured CV", () => {
  it("can locate a summary when the model paraphrases the source text", () => {
    const cv = structureCv("PROFESSIONAL SUMMARY\nAI / Machine Learning Engineer with 2+ years");
    const section = cv.sections[0];
    expect(section).toBeDefined();
    const target: AnchoredSuggestion = {
      sectionId: section!.id,
      field: "text",
      operation: "replace",
      proposedText: "AI / ML Engineer with 2+ years",
      reason: "Concise wording.",
      jobRequirement: "Role summary.",
    };
    expect(getAnchoredOriginal(cv, target)).toBe("AI / Machine Learning Engineer with 2+ years");
    const applied = applyAnchoredSuggestion(cv, target, "suggestion-1");
    expect(applied.applied).toBe(true);
    const resultText = JSON.stringify(applied.cv);
    expect(resultText.match(/AI \/ ML Engineer with 2\+ years/g)).toHaveLength(1);
    expect(resultText).not.toContain("AI / Machine Learning Engineer with 2+ years");
  });

  it("preserves source text, merges continued sections, and makes stable IDs", () => {
    const first = structureCv(sample);
    const second = structureCv(sample);
    expect(first.lossless).toEqual({ coverage: 1, verified: true });
    expect(first.sections.filter((section) => section.type === "experience")).toHaveLength(1);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(first)).not.toContain("(CONTINUED)");
  });

  it("applies only the targeted technical skills change", () => {
    const cv = structureCv(sample);
    const target: ResumeSuggestionTarget = {
      sectionType: "technical_skills",
      field: "text",
      operation: "replace",
      before: "Python",
      after: "Python 3",
    };
    const applied = applyResumeSuggestion(cv, target);
    expect(applied.applied).toBe(true);
    expect(applied.cv.sections.find((section) => section.type === "technical_skills")?.paragraphs[0]?.text)
      .toBe("Python 3, SQL");
    expect(applied.cv.sections.find((section) => section.type === "core_competencies")?.paragraphs[0]?.text)
      .toBe("Languages: Python, TypeScript");
  });

  it("changes only the selected experience entry bullet", () => {
    const cv = structureCv(sample);
    const target = findSuggestionTarget(cv, "Built a local model evaluation tool", "Built a model evaluation tool");
    expect(target?.sectionType).toBe("experience");
    expect(target?.entryId).toBeTruthy();
    expect(target?.bulletId).toBeTruthy();
    const applied = applyResumeSuggestion(cv, target!);
    const section = applied.cv.sections.find((item) => item.type === "experience");
    expect(section?.paragraphs.map((line) => line.text)).toContain("Built a model evaluation tool");
    expect(section?.paragraphs.map((line) => line.text)).toContain("Built an internal prototype");
  });

  it("leaves ambiguous matches unplaced", () => {
    const cv = structureCv([
      "CORE COMPETENCIES",
      "Python",
      "TECHNICAL SKILLS",
      "Python",
    ].join("\n"));
    expect(findSuggestionTarget(cv, "Python", "Python 3")).toBeNull();
  });

  it("rejects a stale or repeated target instead of applying it twice", () => {
    const cv = structureCv("PROFESSIONAL SUMMARY\nOld summary");
    const target: ResumeSuggestionTarget = {
      sectionType: "summary",
      field: "text",
      operation: "replace",
      before: "Old summary",
      after: "New summary",
    };
    const once = applyResumeSuggestion(cv, target);
    expect(once.applied).toBe(true);
    expect(applyResumeSuggestion(once.cv, target).applied).toBe(false);
  });

  it("derives only accepted edits and restores the base when a decision is reversed", () => {
    const cv = structureCv("PROFESSIONAL SUMMARY\nOriginal summary");
    const section = cv.sections[0]!;
    const suggestion = {
      _id: new ObjectId(),
      ownerId: new ObjectId(),
      resumeId: new ObjectId(),
      jobDescriptionId: new ObjectId(),
      originalText: "Original summary",
      proposedText: "Updated summary",
      reason: "Targets the role.",
      sourceSnippet: "Original summary",
      sectionId: section.id,
      field: "text" as const,
      operation: "replace" as const,
      baseVersion: structuredCvVersion(cv),
      status: "accepted" as const,
      reviewStatus: "not_required" as const,
      flags: [],
      createdAt: new Date(1),
      updatedAt: new Date(1),
    };
    const applied = deriveStructuredCv(cv, [suggestion]);
    expect(applied.applicationStates.get(suggestion._id.toHexString())).toBe("applied");
    expect(JSON.stringify(applied.structuredCv)).toContain("Updated summary");
    expect(JSON.stringify(applied.structuredCv)).not.toContain("Original summary");

    const rejected = deriveStructuredCv(cv, [{ ...suggestion, status: "rejected" }]);
    expect(rejected.applicationStates.get(suggestion._id.toHexString())).toBe("not_applied");
    expect(JSON.stringify(rejected.structuredCv)).toContain("Original summary");
  });

  it("flags conflicting accepted edits and stale base versions instead of applying either", () => {
    const cv = structureCv("PROFESSIONAL SUMMARY\nOriginal summary");
    const section = cv.sections[0]!;
    const base = {
      _id: new ObjectId(),
      ownerId: new ObjectId(),
      resumeId: new ObjectId(),
      jobDescriptionId: new ObjectId(),
      originalText: "Original summary",
      reason: "Targets the role.",
      sourceSnippet: "Original summary",
      sectionId: section.id,
      field: "text" as const,
      operation: "replace" as const,
      baseVersion: structuredCvVersion(cv),
      status: "accepted" as const,
      reviewStatus: "not_required" as const,
      flags: [],
      createdAt: new Date(1),
      updatedAt: new Date(1),
    };
    const first = { ...base, _id: new ObjectId(), proposedText: "First proposal" };
    const second = { ...base, _id: new ObjectId(), proposedText: "Second proposal", createdAt: new Date(2) };
    const conflict = deriveStructuredCv(cv, [first, second]);
    expect(conflict.applicationStates.get(first._id.toHexString())).toBe("conflict");
    expect(conflict.applicationStates.get(second._id.toHexString())).toBe("conflict");
    expect(JSON.stringify(conflict.structuredCv)).toContain("Original summary");

    const stale = deriveStructuredCv(cv, [{ ...base, proposedText: "Stale edit", baseVersion: "changed" }]);
    expect(stale.applicationStates.get(base._id.toHexString())).toBe("stale");
    expect(JSON.stringify(stale.structuredCv)).toContain("Original summary");

    const needsInput = {
      ...base,
      _id: new ObjectId(),
      proposedText: "Confirmed outcome summary.",
      needsUserInput: "Confirm the outcome metric.",
    };
    const waiting = deriveStructuredCv(cv, [needsInput]);
    expect(waiting.applicationStates.get(needsInput._id.toHexString())).toBe("needs_input");
    expect(JSON.stringify(waiting.structuredCv)).toContain("Original summary");
    const confirmed = deriveStructuredCv(cv, [{ ...needsInput, userInput: "The result is accurate." }]);
    expect(confirmed.applicationStates.get(needsInput._id.toHexString())).toBe("applied");
    expect(JSON.stringify(confirmed.structuredCv)).toContain("Confirmed outcome summary.");
  });

  it("adds beside and removes an ID-anchored bullet without changing neighboring content", () => {
    const cv = structureCv("HIGHLIGHTS\nFirst achievement\nSecond achievement");
    const section = cv.sections[0]!;
    const original = section.paragraphs[0]!;
    const added = applyAnchoredSuggestion(cv, {
      sectionId: section.id,
      bulletId: original.id,
      field: "text",
      operation: "add",
      proposedText: "New achievement",
      reason: "Adds relevant evidence.",
      jobRequirement: "Role outcome.",
    }, "new-achievement");
    expect(added.applied).toBe(true);
    expect(added.cv.sections[0]?.paragraphs.map((line) => line.text)).toEqual([
      "First achievement",
      "New achievement",
      "Second achievement",
    ]);

    const removed = applyAnchoredSuggestion(added.cv, {
      sectionId: section.id,
      bulletId: original.id,
      field: "text",
      operation: "remove",
      proposedText: "",
      reason: "Removes outdated content.",
      jobRequirement: "Role outcome.",
    }, "remove-achievement");
    expect(removed.applied).toBe(true);
    expect(removed.cv.sections[0]?.paragraphs.map((line) => line.text)).toEqual([
      "New achievement",
      "Second achievement",
    ]);
  });

  it("adds a skill at section level and leaves unknown section IDs unapplied", () => {
    const cv = structureCv("CORE COMPETENCIES\nCloud: AWS, Azure");
    const section = cv.sections[0]!;
    const added = applyAnchoredSuggestion(cv, {
      sectionId: section.id,
      field: "text",
      operation: "add",
      proposedText: "Python",
      reason: "Adds a relevant skill.",
      jobRequirement: "Python experience.",
    }, "new-skill");
    expect(added.cv.sections[0]?.groups.map((group) => group.value)).toEqual([
      "AWS, Azure",
      "Python",
    ]);

    const unknown = applyAnchoredSuggestion(cv, {
      sectionId: "unknown-section",
      field: "text",
      operation: "replace",
      proposedText: "Ignored.",
      reason: "Invalid target.",
      jobRequirement: "Role requirement.",
    }, "unknown-target");
    expect(unknown.applied).toBe(false);
    expect(unknown.cv).toBe(cv);
  });

  it("rejects instruction-like proposals and flags novel claims for confirmation", () => {
    expect(isCvReadyText("Add a sentence about production use.")).toBe(false);
    expect(isCvReadyText("[insert result here]")).toBe(false);
    expect(findNovelClaimWords("Built a production system for real users", "Built an internal pilot")).toContain("production");
  });
});
