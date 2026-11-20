import { ConflictError } from "../../common/errors.js";

export interface ResumeDraftSuggestion {
  originalText: string;
  proposedText: string;
}

interface Replacement {
  start: number;
  end: number;
  text: string;
}

export function buildResumeDraft(
  sourceText: string,
  anonymizedText: string,
  suggestions: ResumeDraftSuggestion[],
): string {
  const replacements = suggestions
    .map((suggestion) => {
      const anonymizedStart = findUniqueOccurrence(anonymizedText, suggestion.originalText);
      const anonymizedEnd = anonymizedStart + suggestion.originalText.length;
      const sourceRange = findUniqueRange(sourceText, suggestion.originalText) ??
        mapRangeToSource(anonymizedText, sourceText, anonymizedStart, anonymizedEnd);
      return { ...sourceRange, text: suggestion.proposedText };
    })
    .sort((left, right) => right.start - left.start);

  for (let index = 1; index < replacements.length; index += 1) {
    if (replacements[index - 1].start < replacements[index].end) {
      throw new ConflictError("Accepted resume suggestions overlap and cannot be applied together");
    }
  }

  let draft = sourceText;
  for (const replacement of replacements) {
    draft = `${draft.slice(0, replacement.start)}${replacement.text}${draft.slice(replacement.end)}`;
  }
  return draft;
}

function findUniqueRange(text: string, value: string): { start: number; end: number } | null {
  const first = text.indexOf(value);
  if (first < 0 || text.indexOf(value, first + value.length) >= 0) return null;
  return { start: first, end: first + value.length };
}

function findUniqueOccurrence(text: string, value: string): number {
  const first = text.indexOf(value);
  if (first < 0 || text.indexOf(value, first + value.length) >= 0) {
    throw new ConflictError("An accepted suggestion no longer matches the selected CV");
  }
  return first;
}

function mapRangeToSource(
  anonymizedText: string,
  sourceText: string,
  start: number,
  end: number,
): { start: number; end: number } {
  const sourceStart = start === 0
    ? 0
    : findContextBoundary(anonymizedText.slice(0, start), sourceText, "suffix");
  const sourceEnd = end === anonymizedText.length
    ? sourceText.length
    : findContextBoundary(anonymizedText.slice(end), sourceText, "prefix");

  if (sourceStart > sourceEnd) {
    throw new ConflictError("An accepted suggestion could not be located in the selected CV");
  }
  return { start: sourceStart, end: sourceEnd };
}

function findContextBoundary(
  context: string,
  sourceText: string,
  side: "prefix" | "suffix",
): number {
  const maxLength = Math.min(context.length, 120);
  for (let length = maxLength; length >= 8; length -= 1) {
    const anchor = side === "suffix" ? context.slice(-length) : context.slice(0, length);
    const first = sourceText.indexOf(anchor);
    if (first < 0 || sourceText.indexOf(anchor, first + 1) >= 0) continue;
    return side === "suffix" ? first + anchor.length : first;
  }
  throw new ConflictError("An accepted suggestion could not be located in the selected CV");
}
