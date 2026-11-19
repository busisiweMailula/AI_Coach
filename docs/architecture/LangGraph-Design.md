# LangGraph Workflow Design

Status: Design and implementation. The backend uses LangGraph.js with an in-memory checkpointer for now; checkpoints are lost when the API restarts. Durable MongoDB-backed recovery is planned for a later migration.

## Design principles

- LangGraph orchestrates only workflows with a loop, durable pause, or human decision.
- Services remain responsible for authentication, ownership, persistence, and business invariants.
- Graph state carries IDs, indices, versions, and status; resume/answer contents stay in their domain collections.
- Every graph has a stable `thread_id`; current checkpoints persist only for the lifetime of the process.
- Graph nodes do not bypass application-service authorization or directly expose checkpoint content.

## Mock interview graph

### State contract

```ts
type InterviewState = {
  sessionId: string;
  ownerId: string;
  questionIds: string[];
  currentIndex: number;
  answerIds: string[];
  followUpCount: number;
  status: "in_progress" | "evaluating" | "completed" | "abandoned";
  evaluationId?: string;
  reviewItemId?: string;
  rubricVersion: string;
  executionIds: string[];
};
```

The answer body and source resume are not copied into checkpoint state. The service persists each answer and resumes the graph with its ID.

### Nodes and transitions

| Node | Responsibility | Next |
|---|---|---|
| `loadSession` | Load session through owner-scoped service; verify active status and immutable question plan | `selectNextQuestion` |
| `selectNextQuestion` | Select `questionIds[currentIndex]`, or determine the session is finished | `presentQuestion` or `evaluateSession` |
| `presentQuestion` | Return the current question and record expected index | `awaitCandidateAnswer` |
| `awaitCandidateAnswer` | Interrupt and wait for an answer command | `recordAnswer` |
| `recordAnswer` | Confirm current index, persist answer once, append answer ID | `decideNext` |
| `decideNext` | Decide follow-up, next base question, or completion | `generateFollowUp`, `selectNextQuestion`, or `evaluateSession` |
| `generateFollowUp` | Generate at most one follow-up for the current base question | `presentQuestion` |
| `evaluateSession` | Call answer-evaluator agent for persisted answer IDs and rubric version | `guardrailCheck` |
| `guardrailCheck` | Validate output ranges, evidence, language, and confidence | `reviewEscalation` or `complete` |
| `reviewEscalation` | Invoke the review subgraph only when a configured trigger fires | `complete` after release/pause policy |
| `complete` | Persist terminal status and result reference | `END` |

### Interrupts and REST behavior

- `POST /interviews` creates a session, invokes the graph with `thread_id = sessionId`, and pauses at `awaitCandidateAnswer`.
- `POST /interviews/{sessionId}/answer` validates owner, active status, current question, and idempotency before persisting the answer and resuming the same thread.
- Duplicate idempotency keys return the prior operation. Stale/out-of-order answer submissions return `409`.
- `POST /interviews/{sessionId}/evaluate` ends early and resumes through evaluation; only valid active states may take this transition.
- The candidate can abandon an active session through a separately authorized state transition.

## Coach review escalation graph

### State contract

```ts
type ReviewState = {
  reviewId: string;
  ownerId: string;
  targetType: "job_match" | "resume_suggestion" | "interview_evaluation";
  targetId: string;
  flags: string[];
  riskLevel: "low" | "medium" | "high";
  status: "pending_review" | "in_review" | "approved" | "edited" | "rejected";
  assignedCoachId?: string;
  decisionId?: string;
  finalVersionId?: string;
  executionIds: string[];
};
```

### Nodes and transitions

| Node | Responsibility | Next |
|---|---|---|
| `computeFlags` | Apply versioned confidence, evidence, guardrail, candidate-request, and sampling rules | `routeReview` |
| `routeReview` | If no trigger, mark `not_required`; otherwise create a review item | `releaseUnreviewed` or `queueReview` |
| `queueReview` | Persist `pending_review` item and assign/route to coach queue | `releaseUnreviewed` |
| `releaseUnreviewed` | Make output available with the correct review label | `awaitCoachDecision` or `END` |
| `awaitCoachDecision` | Interrupt until authorized coach action arrives | `validateDecision` |
| `validateDecision` | Verify role, assignment, target version, and decision schema in service layer | `applyDecision` |
| `applyDecision` | Persist approval/edit/rejection, reviewer, reason, timestamp, and audit event | `notifyCandidate` |
| `notifyCandidate` | Record notification intent and final status | `END` |

Candidate-facing output may be released before review, but must say "AI-generated, not yet reviewed." Rejected output is hidden or replaced according to policy; it is never represented as approved.

### Human interrupt security

Coach identity is not accepted from request body or graph input. Authentication middleware supplies actor identity; the service verifies coach role and assignment before resuming the checkpoint. Replayed decisions and decisions against stale target versions return `409`.

## Checkpointing, durability, and privacy

- Current implementation uses LangGraph's in-memory `MemorySaver`; it is not durable across API restarts.
- `thread_id` is the interview session ID or review item ID; each checkpoint is associated with owner/workflow metadata.
- Store IDs/state only; do not duplicate resume text, answer text, prompts, tokens, or provider secrets.
- Checkpoint writes follow successful source-record writes; operations are idempotent within the running process.
- Use an explicit checkpoint retention policy and delete checkpoints when linked data expires.
- A future MongoDB checkpointer migration must validate collection/index behavior, retention, and transaction requirements.

## Failure behavior

- Schema/guardrail failures mark the operation failed or route it for review; there is no success-shaped fallback.
- Transient provider errors may retry once under the shared agent-runtime policy; duplicate side effects are prevented by idempotency.
- If an interrupt cannot be resumed because the checkpoint is missing or stale, return a documented `409`/`404` and preserve audit evidence.
