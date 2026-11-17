import { evidenceExists } from "./evidence.js";

const numericClaims = /\b\d+(?:[,.]\d+)*(?:\s?%|\s?(?:years?|months?|k|m))?\b/gi;

export interface FabricationCheck {
  safe: boolean;
  unsupportedClaims: string[];
}

export function checkFabrication(proposedText: string, sourceText: string): FabricationCheck {
  const unsupportedClaims = [...new Set(proposedText.match(numericClaims) ?? [])]
    .filter((claim) => !evidenceExists(sourceText, claim));
  return { safe: unsupportedClaims.length === 0, unsupportedClaims };
}

