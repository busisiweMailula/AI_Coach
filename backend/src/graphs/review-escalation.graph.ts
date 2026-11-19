import { Annotation, Command, END, START, StateGraph, interrupt } from "@langchain/langgraph";
import { z } from "zod";
import { getJsonCheckpointer } from "./checkpointer.js";

const ReviewGraphState = Annotation.Root({
  reviewId: Annotation<string>,
  ownerId: Annotation<string>,
  targetId: Annotation<string>,
  status: Annotation<string>,
});

const decisionSchema = z.object({
  decisionId: z.string().regex(/^[\da-f]{24}$/i),
  status: z.enum(["approved", "edited", "rejected"]),
});

export async function createReviewEscalationGraph() {
  const checkpointer = await getJsonCheckpointer();
  return new StateGraph(ReviewGraphState)
    .addNode("await_coach_decision", async (state) => {
      const decision = decisionSchema.parse(
        interrupt({ reviewId: state.reviewId, targetId: state.targetId }),
      );
      return { status: decision.status, decisionId: decision.decisionId };
    })
    .addEdge(START, "await_coach_decision")
    .addEdge("await_coach_decision", END)
    .compile({ checkpointer });
}

export async function startReviewGraph(input: {
  reviewId: string;
  ownerId: string;
  targetId: string;
}) {
  const graph = await createReviewEscalationGraph();
  return graph.invoke({ ...input, status: "pending_review" }, {
    configurable: { thread_id: input.reviewId },
  });
}

export async function resumeReviewGraph(input: {
  reviewId: string;
  decisionId: string;
  status: "approved" | "edited" | "rejected";
}) {
  const graph = await createReviewEscalationGraph();
  return graph.invoke(
    new Command({ resume: { decisionId: input.decisionId, status: input.status } }),
    { configurable: { thread_id: input.reviewId } },
  );
}
