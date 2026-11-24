import { ConflictError } from "../../common/errors.js";

export interface ResumeDraftSuggestion {
  originalText: string;
  proposedText: string;
  sourceSnippet?: string;
}

interface AppliedReplacement {
  start: number;
  end: number;
  replacementLength: number;
}

interface NormalizedText {
  value: string;
  startOffsets: number[];
  endOffsets: number[];
}

export function buildResumeDraft(
  sourceText: string,
  anonymizedText: string,
  suggestions: ResumeDraftSuggestion[],
): string {
  let draft = sourceText;
  const source = normalizeWithOffsets(sourceText);
  const anonymized = normalizeWithOffsets(anonymizedText);
  const assignedRanges = new Set<string>();
  const positionedSuggestions = suggestions.map((suggestion, index) => {
    const originalText = normalizeWithOffsets(suggestion.originalText).value;
    const candidates = findReplacementRanges(source, anonymized, originalText, suggestion.sourceSnippet);
    if (candidates.length === 0) throw unmatchedSuggestionError();
    const range = candidates.find((candidate) => !assignedRanges.has(rangeKey(candidate))) ?? candidates[0];
    assignedRanges.add(rangeKey(range));
    return { suggestion, index, range };
  });
  const latestSuggestionByRange = new Map<string, typeof positionedSuggestions[number]>();
  for (const positioned of positionedSuggestions) {
    latestSuggestionByRange.set(rangeKey(positioned.range), positioned);
  }
  const orderedSuggestions = [...latestSuggestionByRange.values()].sort((left, right) =>
    left.range.start - right.range.start ||
    (right.range.end - right.range.start) - (left.range.end - left.range.start) ||
    left.index - right.index);
  const appliedReplacements: AppliedReplacement[] = [];

  for (const positioned of orderedSuggestions) {
    const { suggestion } = positioned;
    const currentDraft = normalizeWithOffsets(draft);
    const originalText = normalizeWithOffsets(suggestion.originalText).value;
    const currentRange = findReplacementRanges(
      currentDraft,
      anonymized,
      originalText,
      suggestion.sourceSnippet,
    )[0] ?? mapRangeThroughReplacements(positioned.range, appliedReplacements);
    if (!currentRange) throw unmatchedSuggestionError();
    draft = `${draft.slice(0, currentRange.start)}${suggestion.proposedText}${draft.slice(currentRange.end)}`;
    appliedReplacements.push({
      start: positioned.range.start,
      end: positioned.range.end,
      replacementLength: suggestion.proposedText.length,
    });
  }

  return draft;
}

function rangeKey(range: { start: number; end: number }): string {
  return `${range.start}:${range.end}`;
}

function mapRangeThroughReplacements(
  range: { start: number; end: number },
  replacements: AppliedReplacement[],
): { start: number; end: number } | null {
  let offset = 0;
  for (const replacement of replacements) {
    if (replacement.end <= range.start) {
      offset += replacement.replacementLength - (replacement.end - replacement.start);
    } else if (replacement.start < range.end && range.start < replacement.end) {
      return null;
    }
  }
  return { start: range.start + offset, end: range.end + offset };
}

function findReplacementRanges(
  source: NormalizedText,
  anonymized: NormalizedText,
  originalText: string,
  sourceSnippet?: string,
): Array<{ start: number; end: number }> {
  const candidates = [
    ...findRangesWithinUniqueSnippet(source, originalText, sourceSnippet),
    ...findRanges(source, originalText),
    ...findOccurrences(anonymized.value, originalText)
      .map((start) => mapRangeToSource(anonymized, source, start, start + originalText.length))
      .filter((range): range is { start: number; end: number } => range !== null),
    ...findPlaceholderRanges(source, originalText),
  ];
  return candidates.filter((candidate, index) =>
    candidates.findIndex((other) => other.start === candidate.start && other.end === candidate.end) === index);
}

function unmatchedSuggestionError(): ConflictError {
  return new ConflictError(
    "An accepted suggestion could not be matched to the current CV. Confirm the selected CV and suggestion before creating a draft.",
  );
}

function normalizeWithOffsets(text: string): NormalizedText {
  let value = "";
  const startOffsets: number[] = [];
  const endOffsets: number[] = [];

  for (let index = 0; index < text.length;) {
    if (/\s/.test(text[index])) {
      const start = index;
      while (index < text.length && /\s/.test(text[index])) index += 1;
      if (value.length > 0) {
        if (value.endsWith(" ")) {
          endOffsets[endOffsets.length - 1] = index;
        } else {
          value += " ";
          startOffsets.push(start);
          endOffsets.push(index);
        }
      }
      continue;
    }

    if (text[index] === "&") {
      for (const character of "and") {
        value += character;
        startOffsets.push(index);
        endOffsets.push(index + 1);
      }
    } else {
      value += normalizePunctuation(text, index);
      startOffsets.push(index);
      endOffsets.push(index + 1);
    }
    index += 1;
  }

  if (value.endsWith(" ")) {
    value = value.slice(0, -1);
    startOffsets.pop();
    endOffsets.pop();
  }
  return { value, startOffsets, endOffsets };
}

function normalizePunctuation(text: string, index: number): string {
  const character = text[index];
  if (character === "\u2018" || character === "\u2019" || character === "\u201B") return "'";
  if (character === "\u2013" || character === "\u2014") return "-";
  if (character === "\uFFFD") {
    const previous = text[index - 1] ?? "";
    const next = text[index + 1] ?? "";
    return /[\p{L}\p{N}]/u.test(previous) && /[\p{L}\p{N}]/u.test(next) ? "'" : "-";
  }
  return character;
}

function findRanges(text: NormalizedText, value: string): Array<{ start: number; end: number }> {
  return findOccurrences(text.value, value).map((index) => ({
    start: text.startOffsets[index],
    end: text.endOffsets[index + value.length - 1],
  }));
}

function findRangesWithinUniqueSnippet(
  source: NormalizedText,
  originalText: string,
  sourceSnippet?: string,
): Array<{ start: number; end: number }> {
  if (!sourceSnippet) return [];
  const snippet = normalizeWithOffsets(sourceSnippet).value;
  const snippetRange = findRanges(source, snippet);
  const originalStart = snippet.indexOf(originalText);
  if (
    snippetRange.length !== 1 ||
    originalStart < 0 ||
    snippet.indexOf(originalText, originalStart + originalText.length) >= 0
  ) return [];

  const start = originalStart;
  const end = start + originalText.length - 1;
  return [{
    start: source.startOffsets[findOccurrences(source.value, snippet)[0] + start],
    end: source.endOffsets[findOccurrences(source.value, snippet)[0] + end],
  }];
}

function findPlaceholderRanges(
  source: NormalizedText,
  originalText: string,
): Array<{ start: number; end: number }> {
  const parts = originalText.split(/<[A-Z][A-Z0-9_]*>/g)
    .map((part) => normalizeWithOffsets(part).value);
  const firstAnchor = parts[0]?.trim() ?? "";
  const lastAnchor = parts[parts.length - 1]?.trim() ?? "";
  if (firstAnchor.length < 4 || lastAnchor.length < 4) return [];
  const anchors = parts
    .map((part) => part.trim())
    .filter(Boolean);
  if (anchors.length < 2) return [];

  const maxSpan = Math.max(600, originalText.length * 5);
  let matches = findOccurrences(source.value, anchors[0]).map((start) => ({
    start,
    cursor: start + anchors[0].length,
  }));
  for (const anchor of anchors.slice(1)) {
    const nextMatches: typeof matches = [];
    for (const match of matches) {
      for (const occurrence of findOccurrences(source.value, anchor)) {
        const cursor = occurrence + anchor.length;
        if (occurrence < match.cursor || cursor - match.start > maxSpan) continue;
        nextMatches.push({ start: match.start, cursor });
        if (nextMatches.length >= 100) break;
      }
      if (nextMatches.length >= 100) break;
    }
    matches = nextMatches;
    if (matches.length === 0) return [];
  }

  return matches.map(({ start, cursor }) => ({
    start: source.startOffsets[start],
    end: source.endOffsets[cursor - 1],
  }));
}

function findOccurrences(text: string, value: string): number[] {
  if (!value) return [];
  const occurrences: number[] = [];
  let index = text.indexOf(value);
  while (index >= 0) {
    occurrences.push(index);
    index = text.indexOf(value, index + value.length);
  }
  return occurrences;
}

function mapRangeToSource(
  anonymizedText: NormalizedText,
  sourceText: NormalizedText,
  start: number,
  end: number,
): { start: number; end: number } | null {
  if (!sourceText.value) return null;
  const sourceStartBoundary = start === 0
    ? 0
    : findContextBoundary(anonymizedText.value.slice(0, start), sourceText.value, "suffix");
  const sourceEndBoundary = end === anonymizedText.value.length
    ? sourceText.value.length
    : findContextBoundary(anonymizedText.value.slice(end), sourceText.value, "prefix");
  if (sourceStartBoundary === null || sourceEndBoundary === null) return null;

  const sourceStart = sourceStartBoundary === 0 ? 0 : sourceText.endOffsets[sourceStartBoundary - 1];
  const sourceEnd = sourceEndBoundary === sourceText.value.length
    ? (sourceText.endOffsets[sourceText.endOffsets.length - 1] ?? 0)
    : sourceText.startOffsets[sourceEndBoundary];
  if (sourceStart > sourceEnd) return null;
  return { start: sourceStart, end: sourceEnd };
}

function findContextBoundary(
  context: string,
  sourceText: string,
  side: "prefix" | "suffix",
): number | null {
  if (!context || !sourceText) return null;
  const maxLength = Math.min(context.length, 120);
  for (let length = maxLength; length >= 4; length -= 1) {
    const anchor = side === "suffix" ? context.slice(-length) : context.slice(0, length);
    const first = sourceText.indexOf(anchor);
    if (first < 0 || sourceText.indexOf(anchor, first + 1) >= 0) continue;
    return side === "suffix" ? first + anchor.length : first;
  }
  return null;
}
