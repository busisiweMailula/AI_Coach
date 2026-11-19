import { ObjectId } from "mongodb";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/async-handler.js";
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "../../common/errors.js";
import { finishInterviewGraph, resumeInterviewGraph, startInterviewGraph } from "../../graphs/mock-interview.graph.js";
import type { AsyncJobDocument } from "../../infra/jobs/job.model.js";
import { enqueueAgentJob } from "../../infra/jobs/job-queue.js";
import { getLlmProvider } from "../../infra/llm/provider-factory.js";
import { getDb } from "../../infra/db/database.js";
import { authMiddleware, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import type {
  InterviewAnswerDocument,
  InterviewEvaluationDocument,
  InterviewQuestionDocument,
  InterviewSessionDocument,
  QuestionSetDocument,
} from "../ai-results/models.js";

const startSchema = z.object({
  jobDescriptionId: z.string().regex(/^[\da-f]{24}$/i).optional(),
  questionSetId: z.string().regex(/^[\da-f]{24}$/i).optional(),
}).strict().refine((value) => value.questionSetId || value.jobDescriptionId, "A question set or job description is required");

const answerSchema = z.object({
  answerText: z.string().trim().min(1).max(20_000),
  questionIndex: z.number().int().nonnegative().optional(),
}).strict();

export const interviewsRouter = Router();
interviewsRouter.use("/interviews", authMiddleware, requireRole("candidate"));

interviewsRouter.post(
  "/interviews",
  validateBody(startSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const ownerId = new ObjectId(req.auth.userId);
    const questionSet = await resolveQuestionSet(req.body, ownerId);
    if (!questionSet || questionSet.questionIds.length === 0) {
      throw new NotFoundError("Generated interview questions not found");
    }

    const now = new Date();
    const session: InterviewSessionDocument = {
      _id: new ObjectId(),
      ownerId,
      questionIds: questionSet.questionIds,
      currentIndex: 0,
      answerIds: [],
      status: "in_progress",
      followUpCount: 0,
      rubricVersion: "1.0.0",
      evaluationId: null,
      reviewStatus: "not_required",
      createdAt: now,
      updatedAt: now,
    };
    await getDb().collection<InterviewSessionDocument>("interview_sessions").insertOne(session);
    try {
      await startInterviewGraph({
        sessionId: session._id.toHexString(),
        ownerId: ownerId.toHexString(),
        questionIds: session.questionIds.map((id) => id.toHexString()),
      });
    } catch (error) {
      await getDb().collection<InterviewSessionDocument>("interview_sessions").deleteOne({
        _id: session._id,
        ownerId,
      });
      throw error;
    }
    res.status(201).json({ success: true, data: await sessionResponse(session) });
  }),
);

interviewsRouter.get(
  "/interviews/:sessionId",
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const session = await findSession(req.params.sessionId, req.auth.userId);
    res.status(200).json({ success: true, data: await sessionResponse(session) });
  }),
);

interviewsRouter.post(
  "/interviews/:sessionId/answer",
  validateBody(answerSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const key = req.get("Idempotency-Key")?.trim();
    if (!key || key.length < 8 || key.length > 128) {
      throw new ValidationError("A valid Idempotency-Key header is required");
    }
    const session = await findSession(req.params.sessionId, req.auth.userId);
    const ownerId = new ObjectId(req.auth.userId);
    const answerCollection = getDb().collection<InterviewAnswerDocument>("interview_answers");
    const priorAnswer = await answerCollection.findOne({
      ownerId,
      sessionId: session._id,
      idempotencyKey: key,
    });
    if (priorAnswer) {
      if (priorAnswer.answerText !== req.body.answerText) {
        throw new ConflictError("Idempotency key was already used for a different answer");
      }
      res.status(200).json({ success: true, data: await answerResponse(session, ownerId) });
      return;
    }
    if (session.status !== "in_progress") throw new ConflictError("Interview is not accepting answers");
    if (req.body.questionIndex !== undefined && req.body.questionIndex !== session.currentIndex) {
      throw new ConflictError("Answer is out of order");
    }
    const questionId = session.questionIds[session.currentIndex];
    if (!questionId) throw new ConflictError("No current interview question");
    const answer: InterviewAnswerDocument = {
      _id: new ObjectId(),
      ownerId,
      sessionId: session._id,
      questionId,
      questionIndex: session.currentIndex,
      answerText: req.body.answerText,
      idempotencyKey: key,
      createdAt: new Date(),
    };
    await answerCollection.insertOne(answer);

    const update = await getDb().collection<InterviewSessionDocument>("interview_sessions").updateOne(
      { _id: session._id, ownerId, currentIndex: session.currentIndex, status: "in_progress" },
      {
        $set: {
          currentIndex: session.currentIndex + 1,
          answerIds: [...session.answerIds, answer._id],
          updatedAt: new Date(),
        },
      },
    );
    if (update.matchedCount === 0) {
      await answerCollection.deleteOne({ _id: answer._id, ownerId });
      throw new ConflictError("Interview state changed; reload before answering");
    }
    await resumeInterviewGraph({
      sessionId: session._id.toHexString(),
      answerId: answer._id.toHexString(),
      questionIndex: answer.questionIndex,
    });

    let updatedSession = await findSession(session._id.toHexString(), req.auth.userId);
    if (updatedSession.currentIndex >= updatedSession.questionIds.length) {
      updatedSession = await beginEvaluation(updatedSession, ownerId);
    }
    res.status(200).json({ success: true, data: await answerResponse(updatedSession, ownerId) });
  }),
);

interviewsRouter.post(
  "/interviews/:sessionId/evaluate",
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const session = await findSession(req.params.sessionId, req.auth.userId);
    if (session.status === "evaluating") throw new ConflictError("Interview evaluation is already in progress");
    if (session.status !== "in_progress") throw new ConflictError("Interview cannot be evaluated in its current state");
    if (session.answerIds.length === 0) throw new ValidationError("Submit at least one answer before evaluation");
    const ownerId = new ObjectId(req.auth.userId);
    await finishInterviewGraph(session._id.toHexString());
    const evaluating = await beginEvaluation(session, ownerId);
    const job = await getDb().collection<AsyncJobDocument>("jobs").findOne({
      ownerId,
      type: "interview_evaluation",
      "payload.sessionId": session._id.toHexString(),
    }, { sort: { createdAt: -1 } });
    res.status(202).json({
      success: true,
      data: {
        sessionId: evaluating._id.toHexString(),
        status: "evaluating",
        ...(job ? { jobId: job._id.toHexString(), statusUrl: `/api/v1/jobs/status/${job._id.toHexString()}` } : {}),
      },
    });
  }),
);

interviewsRouter.get(
  "/interviews/:sessionId/results",
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const session = await findSession(req.params.sessionId, req.auth.userId);
    if (!session.evaluationId) throw new ConflictError("Interview evaluation is not complete");
    const evaluation = await getDb().collection<InterviewEvaluationDocument>("interview_evaluations")
      .findOne({ _id: session.evaluationId, ownerId: session.ownerId });
    if (!evaluation) throw new NotFoundError("Interview evaluation not found");
    res.status(200).json({
      success: true,
      data: {
        sessionId: session._id.toHexString(),
        status: session.status,
        evaluations: [evaluationResponse(evaluation, session.reviewStatus)],
        reviewStatus: session.reviewStatus,
      },
    });
  }),
);

async function resolveQuestionSet(
  input: z.infer<typeof startSchema>,
  ownerId: ObjectId,
): Promise<QuestionSetDocument | null> {
  const collection = getDb().collection<QuestionSetDocument>("interview_question_sets");
  if (input.questionSetId) {
    return collection.findOne({ _id: parseId(input.questionSetId), ownerId });
  }
  if (!input.jobDescriptionId) return null;
  return collection.find({ jobDescriptionId: parseId(input.jobDescriptionId), ownerId })
    .sort({ createdAt: -1 })
    .limit(1)
    .next();
}

async function findSession(sessionId: string, ownerId: string): Promise<InterviewSessionDocument> {
  const session = await getDb().collection<InterviewSessionDocument>("interview_sessions").findOne({
    _id: parseId(sessionId),
    ownerId: new ObjectId(ownerId),
  });
  if (!session) throw new NotFoundError("Interview session not found");
  return session;
}

async function beginEvaluation(
  session: InterviewSessionDocument,
  ownerId: ObjectId,
): Promise<InterviewSessionDocument> {
  getLlmProvider();
  const result = await getDb().collection<InterviewSessionDocument>("interview_sessions").findOneAndUpdate(
    { _id: session._id, ownerId, status: "in_progress" },
    { $set: { status: "evaluating", updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!result) {
    const updated = await getDb().collection<InterviewSessionDocument>("interview_sessions")
      .findOne({ _id: session._id, ownerId });
    if (!updated) throw new NotFoundError("Interview session not found");
    return updated;
  }
  try {
    await enqueueAgentJob({
      ownerId,
      type: "interview_evaluation",
      resultType: "interview_evaluation",
      payload: { sessionId: session._id.toHexString() },
    });
  } catch (error) {
    await getDb().collection<InterviewSessionDocument>("interview_sessions").updateOne(
      { _id: session._id, ownerId, status: "evaluating" },
      { $set: { status: "in_progress", updatedAt: new Date() } },
    );
    throw error;
  }
  return result;
}

async function sessionResponse(session: InterviewSessionDocument) {
  const questionId = session.questionIds[session.currentIndex];
  const question = questionId
    ? await getDb().collection<InterviewQuestionDocument>("interview_questions").findOne({
        _id: questionId,
        ownerId: session.ownerId,
      })
    : null;
  return {
    id: session._id.toHexString(),
    status: session.status,
    currentIndex: session.currentIndex,
    currentQuestion: question ? questionResponse(question, session.currentIndex) : null,
    reviewStatus: session.reviewStatus,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

async function answerResponse(session: InterviewSessionDocument, ownerId: ObjectId) {
  return {
    status: session.status === "evaluating" ? "evaluating"
      : session.status === "completed" ? "completed" : "waiting_for_answer",
    nextQuestion: session.status === "in_progress" ? (await sessionResponse(session)).currentQuestion : null,
    ...(session.evaluationId ? {
      evaluation: await getDb().collection<InterviewEvaluationDocument>("interview_evaluations")
        .findOne({ _id: session.evaluationId, ownerId })
        .then((item) => item ? evaluationResponse(item, session.reviewStatus) : null),
    } : {}),
  };
}

function evaluationResponse(
  evaluation: InterviewEvaluationDocument,
  reviewStatus: InterviewSessionDocument["reviewStatus"],
) {
  return {
    rubricVersion: evaluation.rubricVersion,
    scores: Object.fromEntries(evaluation.dimensions.map((item) => [item.dimension, item.score])),
    dimensionFeedback: evaluation.dimensions,
    overallScore: evaluation.overallScore,
    strengths: evaluation.strengths,
    improvements: evaluation.improvements,
    exampleAnswer: evaluation.exampleAnswer,
    confidence: evaluation.confidence,
    reviewStatus,
  };
}

function questionResponse(question: InterviewQuestionDocument, index: number) {
  return {
    id: question._id.toHexString(),
    text: question.prompt,
    category: question.competency,
    difficulty: question.difficulty,
    index,
  };
}

function parseId(value: string): ObjectId {
  if (!ObjectId.isValid(value)) throw new NotFoundError("Resource not found");
  return new ObjectId(value);
}
