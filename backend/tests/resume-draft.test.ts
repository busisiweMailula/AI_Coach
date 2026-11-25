import { describe, expect, it } from "vitest";
import { mapSanitizedSnippetToSource } from "../src/modules/resumes/resume-draft.js";

describe("mapSanitizedSnippetToSource", () => {
  it("maps anonymized evidence back to the original source for owner-facing display", () => {
    expect(mapSanitizedSnippetToSource(
      "Languages: English (fluent), isiZulu (fluent).",
      "Languages: English (fluent), <PERSON> (fluent).",
      "English (fluent), <PERSON> (fluent)",
    )).toBe("English (fluent), isiZulu (fluent)");
  });

  it("maps snippets when extraction uses different line breaks", () => {
    expect(mapSanitizedSnippetToSource(
      "Highlights:\nBuilt a scalable system for Example Corp.\nResult: reduced latency",
      "Highlights: Built a scalable system for <ORG>. Result: reduced latency",
      "Built a scalable system for <ORG>.",
    )).toBe("Built a scalable system for Example Corp.");
  });
});
