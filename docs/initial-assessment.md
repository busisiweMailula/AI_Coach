# Initial Repository Assessment

Assessment date: 2026-11-16

## Current state

The repository is a greenfield application scaffold. Its original project artifact is `AI-Resume-Interview-Coach-Architecture.md`. A Phase 3 backend foundation now exists under `backend/`; Phase 4 domain APIs, a frontend, and AI workflows have not been implemented.

## Observed stack and scripts

| Area | Current implementation |
|---|---|
| Backend | Node.js 20.19+, Express 4, TypeScript (strict mode) |
| Persistence | MongoDB Node.js driver 6; connection bootstrap and user indexes |
| Configuration | Zod-validated environment variables |
| Authentication | bcrypt password hashing; signed JWTs; public registration is candidate-only |
| Authorization | Authentication, role guard, and ownership helper primitives |
| HTTP controls | Helmet, CORS allow-list, JSON body limit, request ID, rate limiting, centralized errors |
| Logging | Pino with sensitive-field redaction and request completion logs |
| Tests | Vitest and Supertest |
| Local orchestration | Docker Compose for API and MongoDB |

Backend commands (`backend/package.json`):

- `npm run dev`
- `npm run build`
- `npm start`
- `npm test`

## Existing files and reusable code

- The root architecture brief defines project capabilities, layering, MongoDB collections, API surface, and approval-gated phases.
- `backend/src/config/` contains environment validation and logger setup.
- `backend/src/infra/db/` contains MongoDB connection lifecycle and index bootstrap.
- `backend/src/middleware/` contains JWT authentication, role checks, validation, request IDs, rate limiting, request logging, and centralized error handling.
- `backend/src/modules/` currently contains health, auth, and current-user routes.
- `backend/tests/` covers configuration validation, health and error responses, candidate-only self-registration, unauthenticated access, and RBAC status behavior.

## Validation evidence and limitations

The Phase 3 scaffold was built and checked with:

- `npm test`: 14 tests passed.
- `npm run build`: passed.
- `npm audit`: zero reported vulnerabilities for the installed dependency tree.

Docker was unavailable in the implementation environment, so Compose configuration and container startup were not exercised. A live MongoDB integration test was also not run. The test suite verifies HTTP behavior that does not require a database, not persistence behavior against a running MongoDB instance.

## Gaps against the target architecture

1. No frontend or typed frontend API client.
2. No resume/JD storage, file upload, extraction, or consent module.
3. No async task collection/worker or job polling endpoint.
4. No repository/service modules for matching, skills, suggestions, interviews, reviews, progress, privacy, or admin.
5. No LLM adapter, agents, prompts, output/evidence guardrails, or AI evaluation fixtures.
6. No LangGraph workflows or persistent graph checkpointer.
7. No API specification, database design package, or versioned scoring/rubric configuration before this assessment package.
8. No CI pipeline, deployment configuration, or end-to-end browser tests.

## Current design alignment and follow-up

- The backend is a modular monolith and the current domain rules remain outside Express handlers where applicable.
- User records are stored in MongoDB; the previous draft's in-memory user store is not used.
- Public registration cannot select a privileged role. Coach/admin provisioning needs a controlled workflow before those roles can be used.
- The current JWT lifetime is configurable and defaults to seven days. The production security design should use a short-lived access token and define a refresh/revocation strategy before real candidate data is used.
- Resume storage must be private and outside the public web root. The storage adapter, upload content sniffing, and consent flow belong to Phase 4.
- Compose and database behavior remain unverified in this environment because Docker/MongoDB were not available.

## Open decisions to carry into review

- Confirm LangGraph.js for the two stateful workflows.
- Confirm coach provisioning (invite/admin promotion) and initial admin bootstrap procedure.
- Confirm instructor approval of the proposed scoring weights and rubric calibration.
- Confirm LLM provider/model and permitted data processing/retention terms before sending candidate content to an external provider.
- Confirm whether candidate exports should be JSON or a downloadable archive.
- Speech-to-text is excluded from the initial scope; typed answers are the baseline.

## Assessment conclusion

The repository has a usable Phase 3 backend foundation but is not yet a complete application. Phase 2 design documents and contracts are now provided separately under `docs/`; Phase 4+ implementation should follow their decisions and the approval gates in the source brief.
