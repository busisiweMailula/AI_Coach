import { Annotation, Command, END, START, StateGraph, interrupt } from "@langchain/langgraph";
import { z } from "zod";
import { ConflictError } from "../common/errors.js";
import { getMongoCheckpointer } from "./checkpointer.js";

const InterviewGraphState = Annotation.Root({
  sessionId: Annotation<string>,
  ownerId: Annotation<string>,
  questionIds: Annotation<string[]>,
  currentIndex: Annotation<number>,
  answerIds: Annotation<string[]>({ reducer: (left, right) => left.concat(right), default: () => [] }),
  status: Annotation<"in_progress" | "completed">,
});

const answerCommandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("answer"),
    answerId: z.string().regex(/^[\da-f]{24}$/i),
    questionIndex: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal("evaluate") }),
]);

export async function createMockInterviewGraph() {
  const checkpointer = await getMongoCheckpointer();
  return new StateGraph(InterviewGraphState)
    .addNode("await_candidate_answer", async (state) => {
      const command = answerCommandSchema.parse(
        interrupt({ sessionId: state.sessionId, questionIndex: state.currentIndex }),
      );
      if (command.kind === "evaluate") return { status: "completed" as const };
      if (command.questionIndex !== state.currentIndex) {
        throw new ConflictError("Answer does not match the current interview question");
      }
      return {
        answerIds: [command.answerId],
        currentIndex: state.currentIndex + 1,
        status: state.currentIndex + 1 >= state.questionIds.length ? "completed" as const : "in_progress" as const,
      };
    })
    .addConditionalEdges("await_candidate_answer", (state) => (
      state.status === "completed" ? END : "await_candidate_answer"
    ))
    .addEdge(START, "await_candidate_answer")
    .compile({ checkpointer });
}

export async function startInterviewGraph(input: {
  sessionId: string;
  ownerId: string;
  questionIds: string[];
}) {
  const graph = await createMockInterviewGraph();
  return graph.invoke({
    ...input,
    currentIndex: 0,
    answerIds: [],
    status: "in_progress",
  }, {
    configurable: { thread_id: input.sessionId },
  });
}

export async function resumeInterviewGraph(input: {
  sessionId: string;
  answerId: string;
  questionIndex: number;
}) {
  const graph = await createMockInterviewGraph();
  return graph.invoke(
    new Command({ resume: { kind: "answer", answerId: input.answerId, questionIndex: input.questionIndex } }),
    { configurable: { thread_id: input.sessionId } },
  );
}

export async function finishInterviewGraph(sessionId: string) {
  const graph = await createMockInterviewGraph();
  return graph.invoke(
    new Command({ resume: { kind: "evaluate" } }),
    { configurable: { thread_id: sessionId } },
  );
}
