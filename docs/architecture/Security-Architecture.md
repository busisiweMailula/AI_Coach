# Security Architecture

## Authentication and authorization

- Passwords are hashed with bcrypt; plaintext passwords are never stored or logged.
- JWT verification pins the algorithm, issuer, audience, and expiry.
- Public signup is candidate-only. Coach/admin accounts require controlled provisioning and auditable role changes.
- Route-level role checks are supplemented by service/repository ownership checks.
- Candidate resources are queried by both resource ID and `ownerId`.
- Coaches can access only assigned review work. Administrators do not access candidate content by default.
- Production access tokens should be short-lived. A refresh-token rotation/revocation design is required before public deployment; the current Phase 3 seven-day default is not the final production policy.

## Input and API controls

- Zod schemas reject unknown or malformed request fields.
- Helmet, a configured CORS origin, request-size limits, rate limiting, and request IDs are applied at the API boundary.
- Error responses never include stack traces, Mongo queries, provider credentials, or raw provider output.
- Authentication and review-decision endpoints should receive stricter per-route throttles when implemented.
- CORS is not an authentication mechanism.

## File handling

- Accept only PDF/DOCX resumes, apply a conservative size limit, and verify signatures/magic bytes in addition to extension/MIME metadata.
- Store uploads under generated opaque keys in the private MongoDB GridFS bucket, outside any public static directory.
- Reject path traversal and archive expansion hazards; impose limits on extracted text and archive entries.
- Keep original filenames only as sanitized display metadata.
- Do not execute, render as active content, or serve uploaded files inline from the application origin.
- Deletion removes original and derived files and records the outcome.

## LLM and prompt-injection defenses

- Treat resume and job-description text as untrusted data, delimited from instructions.
- Use typed output schemas with strict size/range limits and bounded retries.
- Verify evidence snippets against source text; unsupported suggestions are rejected or escalated.
- Numeric match scores are calculated in deterministic code.
- Prompts never authorize external actions, database access, or tool use.
- Apply a code-level filter for hiring-decision/guarantee language and protected-trait references.
- Record provider/model/prompt/config versions and safe execution metadata. Never log secrets or full candidate content by default.
- Obtain appropriate user consent and verify provider retention/data-processing terms before sending personal data externally.

## Privacy and data lifecycle

- Capture consent and policy version before processing candidate data.
- Restrict admin views to operational metadata by default.
- Define export, deletion, backup expiry, and retention behavior per collection and storage backend.
- Deletion cascades through resume text/claims, jobs, matches, suggestions, interview content/evaluations, progress, and files. Retain only legally/operationally justified audit metadata, without raw candidate content.
- Encrypt transport; use encrypted disks/managed encrypted storage in production. Secrets come from environment/secret-management facilities, never source control.

## Logging and audit

- Structured logs include request ID, route, status, duration, and safe identifiers.
- Redact authorization headers, cookies, passwords, tokens, and sensitive fields.
- Audit role changes, consent changes, export/deletion, coach decisions, and admin configuration changes.
- Audit events store actor/resource/action/time and minimal metadata, not resume content or credentials.

## Threats and mitigations

| Threat | Required mitigation |
|---|---|
| Cross-candidate data access | Owner-scoped repository queries and negative authorization tests |
| Self-assigned coach/admin role | Candidate-only public signup; controlled provisioning; audited role changes |
| Forged file extension/MIME | Signature sniffing, allow-list, limits, private storage |
| Prompt injection in resume/JD | Delimited untrusted data, no tool authority, schema and evidence checks |
| Fabricated achievements | Evidence-backed edits and deterministic fabrication checks |
| Credential leakage | Environment secrets, log redaction, no frontend provider keys |
| Token theft/replay | HTTPS, short access-token lifetime, refresh rotation/revocation design |
| Data retention beyond consent | Explicit retention, cascade deletion, backup expiry policy |
| Malicious oversized document/archive | Upload, archive-entry, extracted-text, and processing-time limits |

## Security decisions that remain open

Production token/refresh design, provider legal/data-processing review, hosting region, storage provider, and backup retention must be confirmed before production deployment.
