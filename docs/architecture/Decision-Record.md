# Architecture Decision Record

Updated: 2026-11-19

The user approved proceeding with the Phase 2 design in the conversation. That approval is not evidence that a separate instructor review meeting occurred; any course-specific instructor sign-off remains to be recorded.

| Topic | Decision recorded for the design | Status / follow-up |
|---|---|---|
| Application shape | Node.js/Express/TypeScript modular monolith; defer microservices. | Adopted |
| Registration and roles | Public registration is candidate-only. Candidate, coach, and admin roles exist; privileged accounts require controlled provisioning/bootstrap and audit. | Adopted; bootstrap workflow is not implemented |
| Authentication | Password hashing and JWT authentication; owner checks in the service/repository path. | Adopted; production short-lived access/refresh/revocation policy must be set before deployment |
| AI provider | Keep Claude/OpenAI behind a provider adapter; select model/provider using server-side configuration. | Adapter design adopted; initial provider and data-processing terms pending |
| Temporary persistence | Store application collections as JSON in a local file until MongoDB is implemented. | Current single-process development implementation; unencrypted and not production-ready |
| Embeddings and semantic search | Use Mistral `mistral-embed` vectors with local cosine ranking for candidate-owned resume evidence retrieval. | Implemented; requires `MISTRAL_API_KEY` and external-model consent; MongoDB Atlas can replace local ranking later |
| Mock interview workflow | Use LangGraph.js for question/answer loops and pauses. | Implemented with in-memory checkpoints; durable MongoDB checkpointer is future work |
| Coach review | Asynchronous review. Flagged outputs may be shown immediately only with "AI-generated, not yet reviewed"; coach decision is recorded and audited. | User-approved design |
| Review triggers | Low confidence, evidence/guardrail failures, possible protected-trait references, candidate request/dispute, and quality sample. | Defaults are proposed in versioned config and require coach calibration |
| Administrator scope | Admin manages operational configuration, role/user metadata, retention and audit metadata; candidate content is not visible by default. | User-approved design; detailed admin workflows deferred |
| Scoring | Deterministic code computes the match score; model output is limited to schema-validated evidence classification. | Adopted; v1 weights require coach calibration |
| Interview rubric | Five equally weighted dimensions on an anchored 0-4 scale. | Proposed v1; coach calibration required |
| File storage | Private storage adapter; local development implementation may be used, with production object-storage provider selected later. | Security requirement adopted; provider pending |
| Consent and privacy | Record policy version and purpose; obtain required consent before resume and external-model processing; support export and deletion. | Adopted; exact retention/legal period pending |
| Export format | Candidate data export is required as a capability. | JSON response is the draft; JSON vs downloadable archive requires confirmation |
| Speech input | Typed answers are the baseline; speech-to-text is outside the initial implementation scope. | Adopted for initial scope; may be revisited |

## Change process

Changing a decision requires updating this record and relevant architecture/API/config documents. Score, rubric, and threshold changes receive new version identifiers; historical results retain the versions used when they were produced.
