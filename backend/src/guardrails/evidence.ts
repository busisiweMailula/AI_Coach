export function evidenceExists(sourceText: string, snippet: string): boolean {
  const normalizedSource = normalizeEvidence(sourceText);
  const normalizedSnippet = normalizeEvidence(snippet);
  return normalizedSnippet.length > 0 && normalizedSource.includes(normalizedSnippet);
}

export function normalize(text: string): string {
  return text.toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
}

function normalizeEvidence(text: string): string {
  return normalize(text)
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

