import { createHash } from "node:crypto";
import type { ResumeSuggestionDocument } from "../ai-results/models.js";
import {
  anchoredTargetKey,
  applyAnchoredSuggestion,
  type AnchoredSuggestion,
  type StructuredCv,
} from "./structured-cv.js";

export type SuggestionApplicationStatus = "applied" | "conflict" | "needs_input" | "stale" | "not_applied";

export function structuredCvVersion(cv: StructuredCv): string {
  return createHash("sha256").update(JSON.stringify(cv)).digest("hex");
}

export function isCvReadyText(value: string): boolean {
  return value.trim().length > 0 &&
    !/\b(?:add|insert|consider|you should|you could|include|mention|replace this|write a sentence)\b/i.test(value) &&
    !/\[[^\]]+\]/.test(value) &&
    !/[?]\s*$/.test(value);
}

export function findNovelClaimWords(proposedText: string, sourceText: string): string[] {
  const sourceWords = new Set((sourceText.toLocaleLowerCase("en").match(/[\p{L}\p{N}]+/gu) ?? []));
  const ignored = new Set([
    "a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of", "on", "or",
    "the", "to", "with", "using", "built", "developed", "created", "designed", "improved",
    "implemented", "supported", "worked", "experience", "experienced", "skills", "skill",
    "project", "projects", "responsible", "responsibilities", "delivered",
  ]);
  return [...new Set((proposedText.toLocaleLowerCase("en").match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => word.length > 2 && !ignored.has(word) && !sourceWords.has(word)))];
}

export function deriveStructuredCv(
  base: StructuredCv,
  suggestions: ResumeSuggestionDocument[],
): {
  structuredCv: StructuredCv;
  applicationStates: Map<string, SuggestionApplicationStatus>;
} {
  const states = new Map<string, SuggestionApplicationStatus>();
  const accepted = suggestions
    .filter((item) => item.status === "accepted")
    .sort((left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left._id.toHexString().localeCompare(right._id.toHexString()));
  const version = structuredCvVersion(base);
  const conflicts = new Set<string>();
  const acceptedByTarget = new Map<string, ResumeSuggestionDocument[]>();

  for (const item of accepted) {
    if (item.baseVersion !== version) {
      states.set(item._id.toHexString(), "stale");
      continue;
    }
    if (!item.sectionId || !item.field || !item.operation) {
      states.set(item._id.toHexString(), "stale");
      continue;
    }
    const target = suggestionTarget(item);
    const key = anchoredTargetKey(target);
    const sameTarget = acceptedByTarget.get(key) ?? [];
    sameTarget.push(item);
    acceptedByTarget.set(key, sameTarget);
  }
  for (const [key, items] of acceptedByTarget) {
    if (items.length > 1) {
      conflicts.add(key);
      for (const item of items) states.set(item._id.toHexString(), "conflict");
    }
  }

  let structuredCv = base;
  for (const item of accepted) {
    const id = item._id.toHexString();
    if (states.has(id)) continue;
    if (item.needsUserInput && !item.userInput?.trim()) {
      states.set(id, "needs_input");
      continue;
    }
    const target = suggestionTarget(item);
    if (conflicts.has(anchoredTargetKey(target))) continue;
    const result = applyAnchoredSuggestion(structuredCv, target, id);
    states.set(id, result.applied ? "applied" : "stale");
    if (result.applied) structuredCv = result.cv;
  }
  for (const item of suggestions) {
    const id = item._id.toHexString();
    if (!states.has(id)) states.set(id, "not_applied");
  }
  return { structuredCv, applicationStates: states };
}

export function suggestionTarget(item: ResumeSuggestionDocument): AnchoredSuggestion {
  return {
    sectionId: item.sectionId ?? "",
    ...(item.entryId ? { entryId: item.entryId } : {}),
    ...(item.bulletId ? { bulletId: item.bulletId } : {}),
    field: item.field ?? "text",
    operation: item.operation ?? "replace",
    proposedText: item.proposedText,
    reason: item.reason,
    jobRequirement: item.jobRequirement ?? "",
    ...(item.needsUserInput ? { needsUserInput: item.needsUserInput } : {}),
  };
}
