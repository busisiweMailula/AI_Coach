# API Specification

Status: Phases 1–5 endpoints listed below are implemented unless explicitly identified as target-only. The OpenAPI document also contains planned privacy and administration operations that are not all implemented.

## Conventions

- Base path: `/api/v1`; JSON over HTTPS except multipart uploads.
- Protected routes require `Authorization: Bearer <JWT>`.
- Success response: `{ "success": true, "data": ... }`.
- Error response: `{ "success": false, "error": { "code": "...", "message": "...", "details"?: ... }, "requestId": "..." }`.
- Candidate-owned resources are scoped to the authenticated user. Unauthorized cross-owner access does not reveal whether the resource exists.
- Long-running analysis, generation, and evaluation return `202 Accepted` with a job ID; poll `/jobs/status/{jobId}`. Resume text extraction occurs during upload; structured parsing and AI workflows run asynchronously. AI workflows require a configured provider and active `external_model_processing` consent.
- `GET /candidates/me/consents/status` returns the server's current policy versions and whether the authenticated candidate accepted them. `PUT /candidates/me/consents` accepts only `purpose` and `granted`; the server chooses the policy version and appends a history record. Upload consent is checked from the local JSON data file before multipart parsing; a multipart consent flag is not accepted.
- Scores are indicative coaching feedback, not hiring decisions. Every match skill result includes evidence or is labeled `no_evidence_found`.

## Endpoint catalog

| Method and path | Access | Behavior |
|---|---|---|
| `GET /health` | Public | Liveness/status response |
| `POST /auth/register` | Public | Candidate-only registration |
| `POST /auth/login` | Public | Authenticate and issue access token |
| `GET /users/me` | Candidate, coach, admin | Return safe current-user profile |
| `POST /resumes/upload` | Candidate | Require resume-processing consent, validate and extract PDF/DOCX text, and store the source privately |
| `GET /resumes` | Candidate | List own resumes |
| `GET /resumes/{resumeId}` | Candidate owner | Get metadata, extraction status, and extracted source text |
| `PATCH /resumes/{resumeId}` | Candidate owner | Update candidate-editable title/notes |
| `POST /jobs/analyze` | Candidate | Persist pasted text or validated PDF/DOCX/TXT and queue analysis status |
| `GET /jobs` | Candidate | List own job descriptions |
| `GET /jobs/{jobDescriptionId}` | Candidate owner | Get one own job description |
| `GET /jobs/status/{jobId}` | Job owner | Poll job state/result reference |
| `POST /matching/analyze` | Candidate | Start resume/JD match and scoring |
| `GET /matches/{matchId}` | Candidate owner | Retrieve evidence-backed match and score |
| `POST /skills/gaps` | Candidate | Start learning-oriented gap analysis |
| `GET /skills/gaps/{gapId}` | Candidate owner | Retrieve gap categories and learning actions |
| `POST /resumes/optimize` | Candidate | Generate factual suggestions for candidate review |
| `GET /suggestions` | Candidate | List own resume suggestions and decisions |
| `POST /suggestions/{suggestionId}/decision` | Candidate owner | Accept/reject one suggestion |
| `POST /interviews/generate` | Candidate | Generate interview question set |
| `GET /interviews/question-sets/{questionSetId}` | Candidate owner | Retrieve generated questions |
| `POST /interviews` | Candidate | Start graph and return first question |
| `GET /interviews/{sessionId}` | Candidate owner | Return session state without another user's content |
| `POST /interviews/{sessionId}/answer` | Candidate owner | Submit the answer for the expected question and resume the graph |
| `POST /interviews/{sessionId}/evaluate` | Candidate owner | Finish early or request final evaluation |
| `GET /interviews/{sessionId}/results` | Candidate owner | Return rubric results and review state |
| `GET /candidates/me/progress` | Candidate | Return aggregate preparation progress |
| `GET /candidates/me/consents` | Candidate | Read consent history |
| `GET /candidates/me/consents/status` | Candidate | Check current server policy versions and acceptance |
| `PUT /candidates/me/consents` | Candidate | Grant/revoke a purpose; server versions and appends the history record |
| `GET /candidates/me/export` | Candidate | Request/download own data export |
| `DELETE /candidates/me/data` | Candidate | Start deletion and return job status |
| `POST /reviews/request` | Candidate owner | Request coach review of own output |
| `GET /reviews/pending` | Coach | List pending reviews; coach role is checked against the current account |
| `GET /reviews/{reviewId}` | Assigned coach or candidate owner (status-limited) | Candidate receives status metadata; coach receives owner-scoped content for review |
| `POST /reviews/{reviewId}/decision` | Assigned coach | Approve/edit/reject with reason |
| `GET /admin/users` | Admin | List up to 200 safe account records, not candidate content |
| `PATCH /admin/users/{userId}/role` | Admin | Change candidate/coach roles; admin accounts require manual provisioning |
| `GET /admin/config` | Admin | Read active non-secret configuration |
| `PATCH /admin/config` | Admin | Update validated versioned thresholds/config |
| `GET /admin/audit-logs` | Admin | Read restricted audit metadata |

Admin and coach endpoints re-check the account role against the JSON database for each privileged request, so role changes take effect without waiting for the access token to expire. Role changes are recorded in the audit log.

## Async job response

An accepted operation returns `202` with:

```json
{
  "success": true,
  "data": {
    "jobId": "6650000000000000000000c0",
    "status": "queued",
    "statusUrl": "/api/v1/jobs/status/6650000000000000000000c0"
  }
}
```

Job polling is owner-scoped. A terminal failed job returns a safe error code and message; provider stacks, prompts, and secrets are never returned.

## Interview state and ordering

An answer must match the server's current question index. Duplicate `Idempotency-Key` submissions return the existing answer/result; a stale or out-of-order answer returns `409`. A completed/abandoned session cannot accept additional answers.

## Common errors

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid body, query, or path parameter |
| 401 | `UNAUTHORIZED` | Missing/invalid/expired token |
| 403 | `FORBIDDEN` | Authenticated user lacks role/ownership |
| 404 | `NOT_FOUND` | Resource is unavailable to caller |
| 409 | `CONFLICT` | Duplicate, stale state, or invalid transition |
| 413 | `UPLOAD_TOO_LARGE` | Upload exceeds configured limit |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Unsupported or sniffed file type |
| 429 | `RATE_LIMITED` | Request limit exceeded |
| 500 | `INTERNAL_ERROR` | Unexpected server failure; include request ID |

The canonical machine-readable contract is [openapi.yaml](./openapi.yaml).
