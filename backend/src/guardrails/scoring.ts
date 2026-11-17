import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { normalize } from "./evidence.js";

const scoringConfigSchema = z.object({
  version: z.string(),
  weights: z.object({
    requiredSkillCoverage: z.number().min(0).max(1),
    preferredSkillCoverage: z.number().min(0).max(1),
    responsibilityEvidence: z.number().min(0).max(1),
    experienceAlignment: z.number().min(0).max(1),
    evidenceQuality: z.number().min(0).max(1),
  }),
}).refine((value) => Math.abs(Object.values(value.weights).reduce((sum, weight) => sum + weight, 0) - 1) < 0.000001);

const configPath = fileURLToPath(new URL("../../config/scoring.v1.json", import.meta.url));

export interface MatchScoreInput {
  requiredSkillValues: number[] | null;
  preferredSkillValues: number[] | null;
  responsibilityValues: number[] | null;
  experienceAlignment: number | null;
  evidenceQuality: number | null;
}

export interface MatchScoreResult {
  score: number;
  breakdown: Record<string, number>;
  configVersion: string;
}

let scoringConfig: z.infer<typeof scoringConfigSchema> | undefined;

export async function calculateMatchScore(input: MatchScoreInput): Promise<MatchScoreResult> {
  const config = await getScoringConfig();
  const rawBreakdown = {
    requiredSkillCoverage: average(input.requiredSkillValues),
    preferredSkillCoverage: average(input.preferredSkillValues),
    responsibilityEvidence: average(input.responsibilityValues),
    experienceAlignment: optionalScore(input.experienceAlignment),
    evidenceQuality: optionalScore(input.evidenceQuality),
  };
  const active = Object.entries(config.weights).filter(
    ([key]) => rawBreakdown[key as keyof typeof rawBreakdown] !== null,
  );
  const activeWeight = active.reduce((sum, [, weight]) => sum + weight, 0);
  if (activeWeight === 0) throw new Error("Cannot score a match without evidence categories");
  const weighted = active.reduce(
    (sum, [key, weight]) => sum + rawBreakdown[key as keyof typeof rawBreakdown]! * weight,
    0,
  ) / activeWeight;
  const breakdown = Object.fromEntries(
    Object.entries(rawBreakdown)
      .filter((entry): entry is [string, number] => entry[1] !== null)
      .map(([key, value]) => [key, value]),
  );
  return {
    score: Math.round(clamp(weighted) * 100),
    breakdown: Object.fromEntries(Object.entries(breakdown).map(([key, value]) => [key, Math.round(value * 100)])),
    configVersion: config.version,
  };
}

async function getScoringConfig(): Promise<z.infer<typeof scoringConfigSchema>> {
  if (!scoringConfig) {
    const raw = JSON.parse(await readFile(configPath, "utf8")) as unknown;
    scoringConfig = scoringConfigSchema.parse(raw);
  }
  return scoringConfig;
}

export function scoreForEvidence(status: "matched" | "partial" | "no_evidence_found"): number {
  return status === "matched" ? 1 : status === "partial" ? 0.5 : 0;
}

function average(values: number[] | null): number | null {
  if (values === null || values.length === 0) return null;
  return clamp(values.reduce((sum, value) => sum + clamp(value), 0) / values.length);
}

function optionalScore(value: number | null): number | null {
  return value === null ? null : clamp(value);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function normalizedText(value: string): string {
  return normalize(value);
}
