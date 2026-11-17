# Low-Level Design

## Backend module contract

Each domain module follows the existing repository pattern:

```text
modules/<domain>/
  <domain>.routes.ts
  <domain>.controller.ts
  <domain>.service.ts
  <domain>.repository.ts
  <domain>.schema.ts
  <domain>.model.ts
```

- Routes apply authentication, role guards, and Zod validation.
- Controllers are limited to HTTP mapping.
- Services enforce ownership, invoke domain rules/agents, and coordinate persistence.
- Repositories contain MongoDB operations and always scope candidate data by `ownerId`.
- Domain functions are pure wherever practical.
- Agents accept typed input and return schema-validated output; they have no database dependency.

## Persistence conventions

- MongoDB `ObjectId` is used for document IDs and references.
- Timestamps are BSON `Date` values in storage and ISO-8601 strings in JSON.
- Candidate-owned documents use `ownerId: ObjectId`.
- Email values are normalized to lowercase and uniquely indexed.
- API responses never expose password hashes, storage filesystem paths, secrets, or internal checkpoint contents.
- Every candidate-owned lookup uses both resource ID and owner ID. A caller cannot infer another candidate's resource via an unscoped query.

## API conventions

- Base path: `/api/v1`.
- JSON success envelope: `{ "success": true, "data": ... }`.
- Error envelope: `{ "success": false, "error": { "code": "...", "message": "...", "details"?: ... }, "requestId": "..." }`.
- `400` means invalid input, `401` missing/invalid authentication, `403` insufficient role, `404` absent/inaccessible resource, `409` invalid state/conflict, `413` oversized upload, `415` unsupported file, `429` rate limit, and `500` unexpected server failure.
- Long tasks return `202 Accepted` and a job ID; the client polls `GET /jobs/status/{jobId}`.
- Pagination uses opaque cursor tokens; do not expose arbitrary Mongo query syntax.

## Identity and authorization

- Public registration can create `candidate` only; ignore no privileged role field—reject unexpected fields.
- Coaches/admins are provisioned through a controlled administrative/bootstrap process, not public signup.
- JWT claims include `sub`, normalized email, role, issuer, audience, and expiration.
- Access-token duration is short in production; refresh/revocation design is required before public deployment.
- Coach access is limited to assigned review items. Admin access to candidate content is denied by default.

## Async job lifecycle

`queued -> running -> succeeded | failed | cancelled`

The job document stores owner, type, safe progress, timestamps, attempt count, and a typed result reference. Public status responses do not disclose raw provider errors. Retries are bounded and only applied to transient failures. A retry must be idempotent and must not duplicate user-visible results.

## Agent runtime

`runAgent` validates inputs, loads a versioned prompt, calls the configured provider with a timeout, validates output, applies at most one bounded schema-repair retry, runs code guardrails, and records execution metadata. If validation or guardrails fail, the service returns an explicit failure/review state rather than a fabricated fallback.

## Upload processing

The upload pipeline validates authenticated ownership, maximum size, extension plus magic bytes, and allowed PDF/DOCX content types. Files are stored under opaque generated keys. Original filenames are metadata only and are sanitized for display. Extracted text is stored with provenance; parser output is not treated as ground truth.

## Interview state invariants

- A session belongs to exactly one candidate.
- One answer is accepted for the current expected question only.
- Answer submission is idempotent by client request ID.
- A follow-up count is capped at one per base question.
- `completed` and `abandoned` sessions do not accept new answers.
- Graph state carries IDs/order/status; interview answer text remains in `interview_answers`.

## Review state invariants

- A review has exactly one target and one owner.
- Pending items are visible to eligible coaches; decisions require a coach role and are audited.
- Only `pending_review`/`in_review` items can receive a decision.
- Approval, edit, or rejection stores reviewer ID, timestamp, reason, and final version where applicable.
- Candidate-visible output clearly reflects its current AI/human review status.
