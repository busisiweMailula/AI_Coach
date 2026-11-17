# Data Flow

## Resume intake and parsing

```mermaid
sequenceDiagram
  participant C as Candidate
  participant API as Express API
  participant S as Resume service
  participant F as Private storage
  participant DB as MongoDB
  participant W as Job worker
  participant P as Parser agent/provider
  C->>API: consent + multipart PDF/DOCX
  API->>API: authenticate, size limit, sniff type
  API->>S: create owned resume
  S->>F: store under opaque key
  S->>DB: resume + queued job
  API-->>C: 202 jobId, upload status
  W->>F: read private file
  W->>P: extract/structure as untrusted data
  P-->>W: typed claims with evidence and uncertainty
  W->>DB: source text, parse result, job status
  C->>API: GET job status / resume
  API-->>C: parsed result with source evidence
```

## Job description and match

1. Candidate provides pasted text or an accepted file.
2. Service persists original text and creates an analysis job.
3. Analyzer extracts role, experience, skills, and responsibilities with exact source evidence.
4. Matching service loads candidate-owned resume and job data.
5. Skill classification is checked against source snippets; pure domain code calculates the versioned score.
6. Candidate receives the score breakdown and the disclaimer that it is indicative preparation feedback, not a hiring decision.

## Interview

```mermaid
sequenceDiagram
  participant C as Candidate
  participant API as API
  participant S as Interview service
  participant G as Interview graph
  participant DB as MongoDB
  C->>API: POST /interviews
  API->>S: create session after ownership check
  S->>G: invoke with thread_id=sessionId
  G->>DB: checkpoint IDs and current state
  G-->>C: first question via API
  C->>API: POST /interviews/{id}/answer
  API->>S: validate expected question and owner
  S->>DB: persist answer
  S->>G: resume checkpoint with answer ID
  G->>G: next question or evaluation
  G->>DB: checkpoint updated state
  G-->>C: next question/status
```

## Review escalation

1. Code guardrails and configured thresholds determine review flags.
2. The AI output may be shown with an explicit "AI-generated, not yet reviewed" label; it is never described as coach-approved.
3. A review item is created for low confidence, guardrail hits, possible protected-trait content, candidate request/dispute, or quality sampling.
4. The graph interrupts while waiting for an authorized coach decision.
5. The decision, reason, reviewer, timestamp, and final version are persisted and audited.
6. Candidate receives the resulting status and version.

## Data minimization

Only IDs and workflow metadata are placed in graph checkpoints. Source content is fetched by owner-scoped services when needed. Routine logs contain identifiers and safe status metadata, not resume text, passwords, tokens, or answer bodies.
