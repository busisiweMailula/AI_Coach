interface NormalizedText {
  value: string;
  startOffsets: number[];
  endOffsets: number[];
}

export function mapSanitizedSnippetToSource(
  sourceText: string,
  sanitizedText: string,
  snippet: string,
): string | null {
  const source = normalizeWithOffsets(sourceText);
  const sanitized = normalizeWithOffsets(sanitizedText);
  const normalizedSnippet = normalizeWithOffsets(snippet).value.toLocaleLowerCase("en");
  if (!normalizedSnippet) return null;

  const sanitizedValue = sanitized.value.toLocaleLowerCase("en");
  const sourceValue = source.value.toLocaleLowerCase("en");
  if (!normalizedSnippet.includes("<") && sourceValue.includes(normalizedSnippet)) {
    const sourceStart = sourceValue.indexOf(normalizedSnippet);
    return sourceText.slice(
      source.startOffsets[sourceStart] ?? 0,
      source.endOffsets[sourceStart + normalizedSnippet.length - 1] ?? sourceText.length,
    );
  }
  const sanitizedStart = findUniqueOccurrence(sanitizedValue, normalizedSnippet);
  if (sanitizedStart === null) return null;
  const sourceRange = findUniqueRange({ ...source, value: sourceValue }, normalizedSnippet) ??
    mapRangeToSource(
      { ...sanitized, value: sanitizedValue },
      { ...source, value: sourceValue },
      sanitizedStart,
      sanitizedStart + normalizedSnippet.length,
    );
  return sourceRange ? sourceText.slice(sourceRange.start, sourceRange.end) : null;
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
    : findContextBoundary(anonymizedText.value.slice(end), sourceText.value, "prefix") ??
      findMatchingSuffixBoundary(anonymizedText.value.slice(end), sourceText.value);
  if (sourceStartBoundary === null || sourceEndBoundary === null) return null;

  const sourceStart = sourceStartBoundary === 0 ? 0 : sourceText.endOffsets[sourceStartBoundary - 1];
  const sourceEnd = sourceEndBoundary === sourceText.value.length
    ? (sourceText.endOffsets[sourceText.endOffsets.length - 1] ?? 0)
    : sourceText.startOffsets[sourceEndBoundary];
  if (sourceStart > sourceEnd) return null;
  return { start: sourceStart, end: sourceEnd };
}

function findMatchingSuffixBoundary(context: string, sourceText: string): number | null {
  if (!context || !sourceText) return null;
  for (let length = Math.min(context.length, 3); length > 0; length -= 1) {
    const suffix = context.slice(0, length);
    if (sourceText.endsWith(suffix)) return sourceText.length - suffix.length;
  }
  return null;
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
