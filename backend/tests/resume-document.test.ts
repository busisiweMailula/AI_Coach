import { describe, expect, it } from "vitest";
import { createResumeWordDocument } from "../../frontend/src/features/resume/resume-document.js";

describe("createResumeWordDocument", () => {
  it("creates an editable Word document containing the formatted CV", async () => {
    const document = await createResumeWordDocument(
      "Jane Candidate\n\nCAREER INTERESTS\n- Develop practical engineering skills\n\nAccepted CV updates\n- Expand technical experience",
    );

    expect(document.type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(document.size).toBeGreaterThan(1000);
    const bytes = new Uint8Array(await document.arrayBuffer());
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });
});
