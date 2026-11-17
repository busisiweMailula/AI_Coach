export function evidenceExists(sourceText: string, snippet: string): boolean {
  const normalizedSource = normalize(sourceText);
  const normalizedSnippet = normalize(snippet);
  return normalizedSnippet.length > 0 && normalizedSource.includes(normalizedSnippet);
}

export function normalize(text: string): string {
  return text.toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
}

