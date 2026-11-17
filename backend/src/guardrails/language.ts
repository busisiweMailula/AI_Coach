const prohibitedPhrases = [
  /\bwill (?:get|land|secure) (?:the )?job\b/i,
  /\bguaranteed (?:to )?(?:be hired|get hired|pass)\b/i,
  /\b(?:best|ideal) candidate\b/i,
];

const protectedTraitTerms = [
  /\b(?:age|gender|nationality|ethnicity|race|religion|disability|marital status)\b/i,
];

export function findLanguageGuardrailHits(text: string): string[] {
  return prohibitedPhrases.flatMap((pattern, index) => pattern.test(text) ? [`hiring_claim_${index + 1}`] : []);
}

export function mentionsProtectedTraits(text: string): boolean {
  return protectedTraitTerms.some((pattern) => pattern.test(text));
}
