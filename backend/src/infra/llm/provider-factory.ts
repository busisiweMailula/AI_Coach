import { ServiceUnavailableError } from "../../common/errors.js";
import { env } from "../../config/env.js";
import { AnthropicProvider } from "./providers/anthropic.provider.js";
import { FallbackLlmProvider } from "./providers/fallback.provider.js";
import { OpenAiCompatibleProvider, OpenAiProvider } from "./providers/openai.provider.js";
import type { LlmProvider } from "./llm-provider.js";

let provider: LlmProvider | null | undefined;

export function getLlmProvider(): LlmProvider {
  if (provider === undefined) {
    if (env.LLM_PROVIDER === "openai") provider = new OpenAiProvider(env.OPENAI_API_KEY!);
    else if (env.LLM_PROVIDER === "anthropic") provider = new AnthropicProvider(env.ANTHROPIC_API_KEY!);
    else if (env.LLM_PROVIDER === "inception") {
      provider = new FallbackLlmProvider(
        new OpenAiCompatibleProvider(
          "inception",
          env.INCEPTION_API_KEY!,
          "https://api.inceptionlabs.ai/v1",
          0.5,
        ),
        new OpenAiCompatibleProvider(
          "groq",
          env.GROQ_API_KEY!,
          "https://api.groq.com/openai/v1",
        ),
        env.GROQ_MODEL,
      );
    } else if (env.LLM_PROVIDER === "groq") {
      provider = new OpenAiCompatibleProvider(
        "groq",
        env.GROQ_API_KEY!,
        "https://api.groq.com/openai/v1",
      );
    } else if (env.LLM_PROVIDER === "mock") provider = new TestMockProvider();
    else provider = null;
  }
  if (!provider) throw new ServiceUnavailableError("AI provider is not configured");
  return provider;
}

class TestMockProvider implements LlmProvider {
  readonly name = "mock";

  async generateJson(request: Parameters<LlmProvider["generateJson"]>[0]) {
    const parsedPrompt = request.userPrompt.split("\n").slice(2).join("\n");
    const input = JSON.parse(parsedPrompt) as Record<string, unknown>;
    if (request.task === "resume_parser") {
      return mockCompletion(request, {
        summary: "Parsed resume profile",
        skills: [],
        workHistory: [],
        education: [],
        uncertaintyFlags: [],
      });
    }
    if (request.task === "jd_analyzer") {
      return mockCompletion(request, {
        roleTitle: null,
        requiredSkills: [],
        preferredSkills: [],
        responsibilities: [],
      });
    }
    if (request.task === "skill_gap_analyzer") {
      const text = String(input.resumeText ?? "").toLowerCase();
      const skills = Array.isArray(input.requiredSkills) ? input.requiredSkills : [];
      return mockCompletion(request, {
        skills: skills.map((skill) => {
          const item = skill as { name?: string; evidenceSnippet?: string };
          const name = String(item.name ?? "");
          const found = text.includes(name.toLowerCase());
          return {
            name,
            status: found ? "matched" : "no_evidence_found",
            ...(found ? { evidenceSnippet: name } : {}),
          };
        }),
        categories: [],
        confidence: 0.5,
      });
    }
    if (request.task === "resume_coach") {
      if (String(input.resumeText ?? "").includes("__test_fabrication_case__")) {
        return mockCompletion(request, {
          suggestions: [{
            originalText: "__test_fabrication_case__",
            proposedText: "Delivered 900% faster API processing.",
            reason: "Add impact.",
            sourceSnippet: "__test_fabrication_case__",
          }],
        });
      }
      return mockCompletion(request, { suggestions: [] });
    }
    if (request.task === "question_generator") {
      const questionCount = Number(input.questionCount ?? 8);
      const interviewType = input.interviewType === "technical" || input.interviewType === "behavioral"
        ? input.interviewType
        : "both";
      return mockCompletion(request, {
        questions: Array.from({ length: questionCount }, (_, index) => {
          const type = interviewType === "both"
            ? index % 2 === 0 ? "technical" : "behavioral"
            : interviewType;
          return {
            prompt: type === "technical"
              ? "How would you design and test a reliable solution for a challenge in this role?"
              : "Tell me about a time you handled a challenging situation at work.",
            competency: type === "technical" ? "technical problem solving" : "behavioral experience",
            type,
            difficulty: "medium",
          };
        }),
      });
    }
    if (request.task === "answer_evaluator") {
      return mockCompletion(request, {
        dimensions: [
          "relevance",
          "completeness",
          "reasoning",
          "examples",
          "communication",
        ].map((dimension) => ({ dimension, score: 2, feedback: "Add more detail and a concrete example." })),
        strengths: [],
        improvements: ["Provide a specific example."],
        exampleAnswer: null,
        confidence: 0.5,
      });
    }
    if (request.task === "career_guidance") {
      return mockCompletion(request, { recommendations: [] });
    }
    throw new Error(`No mock response defined for task ${request.task}`);
  }
}

function mockCompletion(
  request: Parameters<LlmProvider["generateJson"]>[0],
  value: unknown,
) {
  return {
    content: JSON.stringify(value),
    provider: "mock",
    model: request.model,
  };
}
