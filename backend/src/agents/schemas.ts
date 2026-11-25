import { z } from "zod";

export const ResumeParseSchema = z.object({
  summary: z.string().max(2000),
  skills: z.array(z.object({
    name: z.string().min(1).max(100),
    evidenceSnippet: z.string().min(1).max(1000),
  })).max(100),
  workHistory: z.array(z.object({
    title: z.string().max(200).nullable(),
    employer: z.string().max(200).nullable(),
    dates: z.string().max(100).nullable(),
    evidenceSnippet: z.string().min(1).max(2000),
  })).max(100),
  education: z.array(z.object({
    qualification: z.string().max(200).nullable(),
    institution: z.string().max(200).nullable(),
    evidenceSnippet: z.string().min(1).max(2000),
  })).max(100),
  uncertaintyFlags: z.array(z.string().max(200)).max(50),
}).strict();

export const JobAnalysisSchema = z.object({
  roleTitle: z.string().max(200).nullable(),
  requiredSkills: z.array(z.object({
    name: z.string().min(1).max(100),
    evidenceSnippet: z.string().min(1).max(1000),
  })).max(100),
  preferredSkills: z.array(z.object({
    name: z.string().min(1).max(100),
    evidenceSnippet: z.string().min(1).max(1000),
  })).max(100),
  responsibilities: z.array(z.object({
    text: z.string().min(1).max(1000),
    evidenceSnippet: z.string().min(1).max(1000),
  })).max(100),
}).strict();

export const SkillAnalysisSchema = z.object({
  skills: z.array(z.object({
    name: z.string().min(1).max(100),
    status: z.enum(["matched", "partial", "no_evidence_found"]),
    evidenceSnippet: z.string().max(1000).optional(),
  })).max(200),
  categories: z.array(z.object({
    category: z.string().min(1).max(100),
    skills: z.array(z.string().max(100)).max(100),
    actions: z.array(z.string().min(1).max(500)).max(20),
  })).max(50),
  confidence: z.number().min(0).max(1),
}).strict();

export const ResumeSuggestionsSchema = z.object({
  suggestions: z.array(z.object({
    originalText: z.string().min(1).max(2000),
    proposedText: z.string().min(1).max(2000),
    reason: z.string().min(1).max(1000),
    sourceSnippet: z.string().min(1).max(2000),
  })).max(30),
}).strict();

export const QuestionsSchema = z.object({
  questions: z.array(z.object({
    prompt: z.string().min(1).max(2000),
    competency: z.string().min(1).max(100),
    type: z.enum(["technical", "behavioral"]),
    difficulty: z.enum(["easy", "medium", "hard"]),
  })).min(1).max(30),
}).strict();

export const AnswerEvaluationSchema = z.object({
  dimensions: z.array(z.object({
    dimension: z.enum(["relevance", "completeness", "reasoning", "examples", "communication"]),
    score: z.number().finite().min(0).max(4),
    feedback: z.string().min(1).max(1000),
  })).length(5),
  strengths: z.array(z.string().max(500)).max(20),
  improvements: z.array(z.string().max(500)).max(20),
  exampleAnswer: z.string().max(5000).nullable(),
  confidence: z.number().min(0).max(1),
}).strict().superRefine((value, context) => {
  const dimensions = value.dimensions.map((item) => item.dimension);
  if (new Set(dimensions).size !== 5) {
    context.addIssue({ code: "custom", message: "Each rubric dimension must occur exactly once" });
  }
});

export const CareerGuidanceSchema = z.object({
  recommendations: z.array(z.object({
    title: z.string().min(1).max(200),
    rationale: z.string().min(1).max(1000),
    actions: z.array(z.string().min(1).max(500)).max(20),
  })).max(30),
}).strict();

export type ResumeParse = z.infer<typeof ResumeParseSchema>;
export type JobAnalysis = z.infer<typeof JobAnalysisSchema>;
export type SkillAnalysis = z.infer<typeof SkillAnalysisSchema>;
export type ResumeSuggestions = z.infer<typeof ResumeSuggestionsSchema>;
export type GeneratedQuestions = z.infer<typeof QuestionsSchema>;
export type AnswerEvaluation = z.infer<typeof AnswerEvaluationSchema>;
