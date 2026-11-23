export interface ResumeDraftSuggestion {
  originalText: string;
  proposedText: string;
}

interface Replacement {
  start: number;
  end: number;
  text: string;
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
  const source = normalizeWithOffsets(sourceText);
  const anonymized = normalizeWithOffsets(anonymizedText);
  const replacements: Replacement[] = [];
  const unplacedSuggestions: string[] = [];

  for (const suggestion of suggestions) {
    const originalText = normalizeWithOffsets(suggestion.originalText).value;
    const anonymizedStart = findUniqueOccurrence(anonymized.value, originalText);
    const sourceRange = anonymizedStart === null
      ? null
      : findUniqueRange(source, originalText) ??
        mapRangeToSource(anonymized, source, anonymizedStart, anonymizedStart + originalText.length);
    if (sourceRange) replacements.push({ ...sourceRange, text: suggestion.proposedText });
    else unplacedSuggestions.push(suggestion.proposedText);
  }

  const ordered = [...replacements].sort((left, right) => left.start - right.start);
  const overlapping = new Set<Replacement>();
  for (let left = 0; left < ordered.length; left += 1) {
    for (let right = left + 1; right < ordered.length && ordered[right].start < ordered[left].end; right += 1) {
      overlapping.add(ordered[left]);
      overlapping.add(ordered[right]);
    }
  }
  const safeReplacements = ordered.filter((replacement) => !overlapping.has(replacement));
  unplacedSuggestions.push(...[...overlapping].map((replacement) => replacement.text));

  let draft = sourceText;
  for (const replacement of [...safeReplacements].reverse()) {
    draft = `${draft.slice(0, replacement.start)}${replacement.text}${draft.slice(replacement.end)}`;
  }

  const normalizedDraft = normalizeWithOffsets(draft).value;
  const updates = [...new Set(unplacedSuggestions)].filter((text) =>
    !normalizedDraft.includes(normalizeWithOffsets(text).value));
  if (updates.length === 0) return draft;
  const acceptedUpdates = updates.map((text) => `- ${text}`).join("\n");
  return `${draft.trimEnd()}\n\nAccepted CV updates\n${acceptedUpdates}`;
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

    value += text[index];
    startOffsets.push(index);
    endOffsets.push(index + 1);
    index += 1;
  }

  if (value.endsWith(" ")) {
    value = value.slice(0, -1);
    startOffsets.pop();
    endOffsets.pop();
  }
  return { value, startOffsets, endOffsets };
}

function findUniqueRange(text: NormalizedText, value: string): { start: number; end: number } | null {
  const first = text.value.indexOf(value);
  if (first < 0 || text.value.indexOf(value, first + value.length) >= 0) return null;
  return {
    start: text.startOffsets[first],
    end: text.endOffsets[first + value.length - 1],
  };
}

function findUniqueOccurrence(text: string, value: string): number | null {
  const first = text.indexOf(value);
  if (first < 0 || text.indexOf(value, first + value.length) >= 0) {
    return null;
  }
  return first;
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
