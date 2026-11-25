# Database Design

Status: The current implementation stores collection-shaped JSON in `.data/ai-coach.json`; MongoDB is a planned later migration. This local file store is temporary, single-process, unencrypted, and not suitable for production. Confirm retention periods and deployment-specific behavior before production.

## Conventions

- Runtime IDs and references use `ObjectId`; timestamps use `Date`. The JSON file encodes these as tagged objects (`{"$oid":"..."}` and `{"$date":"..."}`) so they can be restored to their runtime types.
- The file is a top-level object whose properties are collection names and whose values are arrays of documents. `JSON_DB_PATH` selects the file path.
- Candidate-owned documents carry `ownerId: ObjectId`; candidate-facing repository operations filter by both `_id` and `ownerId`.
- Application enums are validated at the service boundary and stored as strings.
- Optional values are omitted or explicitly `null` consistently within a collection.
- `sourceText`, resumes, answer bodies, and provider inputs are sensitive personal data. The current JSON file is not encrypted; restrict access to the file and backups, and exclude sensitive values from logs.
- TTL values below are proposed defaults, not legal retention advice. User deletion cascades to owned content and files. Audit retention is separately justified and never retains raw candidate content.
- Resume-processing consent is versioned by the server and stored as append-only records. Upload and CV-based AI jobs require a current grant. CV text is sent to the private Presidio service before model processing; jobs fail closed if anonymization fails, and only the service's returned text may be sent to a model. Presidio detection is not guaranteed to find all personal information.

## Collections

### `users`

Authentication identities.

Fields: `_id:ObjectId` required; `email:string` required, normalized lowercase; `passwordHash:string` required; `role:"candidate"|"coach"|"admin"` required; `status:"active"|"disabled"` (legacy records without status are treated as active); `createdAt:Date`, `updatedAt:Date` required; `lastLoginAt:Date` optional.

Indexes: unique `{email:1}`; `{role:1,status:1}`.

Ownership/access: user can read their safe profile; no public query returns `passwordHash`; coach accounts are created by admins, candidates cannot be promoted, and admins can deactivate/reactivate candidate and coach accounts. Deactivated users cannot sign in or use existing access tokens; admin account status remains controlled provisioning.

Sample:
```json
{
  "_id": { "$oid": "665000000000000000000001" },
  "email": "candidate@example.com",
  "passwordHash": "$2b$12$<bcrypt-hash>",
  "role": "candidate",
  "status": "active",
  "createdAt": { "$date": "2026-01-01T10:00:00Z" },
  "updatedAt": { "$date": "2026-01-01T10:00:00Z" }
}
```

Retention: delete/anonymize on account deletion after required security/audit handling; never retain plaintext credentials.

### `candidates`

Candidate profile and preferences, separate from authentication.

Fields: `_id:ObjectId`; `userId:ObjectId` required; `displayName:string` optional; `locale:string` optional; `timezone:string` optional; `createdAt:Date`, `updatedAt:Date`; `deletedAt:Date|null` optional.

Indexes: unique `{userId:1}`; `{deletedAt:1}`.

Ownership/access: `userId` is the candidate; coaches/admins receive no general profile access.

Sample:
```json
{ "_id": { "$oid": "665000000000000000000002" }, "userId": { "$oid": "665000000000000000000001" }, "locale": "en", "createdAt": { "$date": "2026-01-01T10:00:00Z" }, "updatedAt": { "$date": "2026-01-01T10:00:00Z" } }
```

Retention: cascade with user deletion.

### `resumes`

Original uploaded file metadata and private storage reference.

Implemented fields include `_id:ObjectId`; `ownerId:ObjectId`; `originalFileName:string`; `contentType:string`; `sizeBytes:number`; `sha256:string`; `storageKey:string`; `extractedText:string`; `textExtractionStatus:"extracted"|"empty"`; `parseStatus:"uploaded"|"queued"|"parsed"|"failed"`; optional `parseJobId`, `parsedResumeDataId`, `parserVersion`, candidate-editable `title` and `notes`; `createdAt:Date`, `updatedAt:Date`. Phase 5 parsing stores versioned structured output in `parsed_resume_data`.

Indexes: `{ownerId:1,createdAt:-1}`.

Ownership/access: candidate owner only, except a coach may access a resume explicitly attached to an assigned review item and only for that review.

Sample:
```json
{ "_id": { "$oid": "665000000000000000000010" }, "ownerId": { "$oid": "665000000000000000000001" }, "originalFileName": "resume.pdf", "contentType": "application/pdf", "sizeBytes": 42810, "sha256": "<sha256>", "storageKey": "private/6650/opaque-key", "parseStatus": "queued", "createdAt": { "$date": "2026-01-01T10:05:00Z" }, "updatedAt": { "$date": "2026-01-01T10:05:00Z" } }
```

Retention: remove source file and metadata on user deletion or configured expiry; purge backups according to backup policy.

### `resume_vector_chunks`

Original resume excerpts and Mistral vectors used for semantic evidence retrieval. Original chunk text is retained for retrieval and owner-facing evidence; only the embedding request payload is sanitized for the four configured PII types.

Implemented fields: `_id:ObjectId`; `ownerId:ObjectId`; `resumeId:ObjectId`; `chunkIndex:number`; `content:string` (original extracted resume text); `embedding:number[]` (1024 dimensions for `mistral-embed`, generated from four-PII-sanitized text); `embeddingModel:string`; `createdAt:Date`; `updatedAt:Date`.

The JSON adapter enforces unique `{ownerId:1,resumeId:1,chunkIndex:1}` and ranks the selected owner's resume chunks in-process using cosine similarity over the stored vectors. MongoDB Atlas Vector Search is a possible future replacement.

Ownership/access: vector queries pre-filter by both `ownerId` and `resumeId`; these records are never returned directly by candidate-facing endpoints. Current implementation upserts chunks during matching; account/resume deletion and vector cleanup remain follow-up work.

### `parsed_resume_data`

Versioned parse output and source evidence.

Fields: `_id:ObjectId`; `ownerId:ObjectId`; `resumeId:ObjectId`; `parserVersion:string`; `sourceText:string`; `summary:string`; `claims:array<{claimId:string,category:string,text:string,sourceSnippet:string,startOffset:number,endOffset:number,confidence:number}>`; `skills:array<{name:string,evidenceClaimIds:string[]}>`; `workHistory:array<object>`; `education:array<object>`; `certifications:array<object>`; `uncertaintyFlags:string[]`; `createdAt:Date`.

Indexes: unique `{ownerId:1,resumeId:1,parserVersion:1}`; `{ownerId:1,createdAt:-1}`.

Ownership/access: candidate owner and assigned coach review scope only.

Sample:
```json
{ "_id": { "$oid": "665000000000000000000011" }, "ownerId": { "$oid": "665000000000000000000001" }, "resumeId": { "$oid": "665000000000000000000010" }, "parserVersion": "resume-parser-v1", "sourceText": "Built internal reporting APIs using TypeScript.", "summary": "Backend development experience", "claims": [{ "claimId": "c1", "category": "experience", "text": "Built reporting APIs", "sourceSnippet": "Built internal reporting APIs", "startOffset": 0, "endOffset": 28, "confidence": 0.9 }], "skills": [{ "name": "TypeScript", "evidenceClaimIds": ["c1"] }], "workHistory": [], "education": [], "certifications": [], "uncertaintyFlags": [], "createdAt": { "$date": "2026-01-01T10:06:00Z" } }
```

Retention: delete with parent resume/account; source text must not outlive the source retention decision.

### `job_descriptions`

Candidate-provided target job and analysis.

Implemented fields include `_id:ObjectId`; `ownerId:ObjectId`; `sourceType:"paste"|"upload"`; `sourceFileKey:string|null`; `rawText:string`; `normalizedText:string`; `analysisStatus:"queued"|"running"|"succeeded"|"failed"|"cancelled"`; `analysisJobId:ObjectId`; optional parsed role, experience, required/preferred skills, responsibilities, analyzer version, and execution IDs; `createdAt:Date`, `updatedAt:Date`. The Phase 5 worker persists analysis results and terminal job status.

Indexes: `{ownerId:1,createdAt:-1}`; `{ownerId:1,analysisStatus:1}`.

Ownership/access: candidate owner only except assigned review scope when the job is part of the reviewed result.

Sample:
```json
{ "_id": { "$oid": "665000000000000000000020" }, "ownerId": { "$oid": "665000000000000000000001" }, "sourceType": "paste", "sourceFileKey": null, "rawText": "Senior engineer. Requires TypeScript and API design.", "normalizedText": "Senior engineer. Requires TypeScript and API design.", "analysisStatus": "succeeded", "analysisJobId": { "$oid": "6650000000000000000000c0" }, "roleTitle": "Senior engineer", "requiredSkills": [{ "name": "TypeScript", "evidenceSnippet": "Requires TypeScript" }], "preferredSkills": [], "responsibilities": [], "analyzerVersion": "jd-analyzer-v1", "createdAt": { "$date": "2026-01-01T10:10:00Z" }, "updatedAt": { "$date": "2026-01-01T10:10:00Z" } }
```

Retention: delete with candidate data or configured expiry.

### `job_matches`

Evidence-checked match output and deterministic score.

Fields: `_id:ObjectId`; `ownerId:ObjectId`; `resumeId:ObjectId`; `jobDescriptionId:ObjectId`; `score:number` (0-100); `scoreBreakdown:object<string,number>`; `skillResults:array<{skill:string,status:"matched"|"partial"|"no_evidence_found",evidenceClaimIds:string[]}>`; `disclaimer:string`; `scoreConfigVersion:string`; `agentExecutionIds:ObjectId[]`; `reviewStatus:string`; `createdAt:Date`.

Indexes: `{ownerId:1,createdAt:-1}`; `{ownerId:1,jobDescriptionId:1,createdAt:-1}`; `{ownerId:1,reviewStatus:1}`.

Ownership/access: owner and assigned coach review scope.

Sample:
```json
{ "_id": { "$oid": "665000000000000000000030" }, "ownerId": { "$oid": "665000000000000000000001" }, "resumeId": { "$oid": "665000000000000000000010" }, "jobDescriptionId": { "$oid": "665000000000000000000020" }, "score": 72, "scoreBreakdown": { "requiredSkillCoverage": 80, "preferredSkillCoverage": 50, "responsibilityEvidence": 65, "experienceAlignment": 70, "evidenceQuality": 75 }, "skillResults": [{ "skill": "TypeScript", "status": "matched", "evidenceClaimIds": ["c1"] }], "disclaimer": "Indicative preparation assessment; not a hiring decision.", "scoreConfigVersion": "1.0.0", "agentExecutionIds": [], "reviewStatus": "not_required", "createdAt": { "$date": "2026-01-01T10:12:00Z" } }
```

Retention: delete on account data deletion.

### `skill_gaps`

Learning-oriented gap analysis linked to a match.

Fields: `_id:ObjectId`; `ownerId:ObjectId`; `matchId:ObjectId`; `categories:array<{name:string,items:array<{skill:string,evidenceStatus:"partial"|"no_evidence_found",suggestedActions:string[]}>}>`; `languagePolicyVersion:string`; `createdAt:Date`.

Indexes: unique `{ownerId:1,matchId:1}`; `{ownerId:1,createdAt:-1}`.

Ownership/access: owner and assigned coach review scope.

Sample:
```json
{ "_id": { "$oid": "665000000000000000000031" }, "ownerId": { "$oid": "665000000000000000000001" }, "matchId": { "$oid": "665000000000000000000030" }, "categories": [{ "name": "Backend systems", "items": [{ "skill": "Distributed systems", "evidenceStatus": "no_evidence_found", "suggestedActions": ["Review a distributed-systems design exercise"] }] }], "languagePolicyVersion": "1.0.0", "createdAt": { "$date": "2026-01-01T10:12:05Z" } }
```

Retention: delete with match/account.

### `resume_suggestions`

Candidate-reviewable factual resume edits.

Fields: `_id:ObjectId`; `ownerId:ObjectId`; `resumeId:ObjectId`; `jobDescriptionId:ObjectId|null`; `originalText:string`; `proposedText:string`; `reason:string`; `evidenceClaimIds:string[]`; `status:"pending"|"accepted"|"rejected"`; `guardrailVersion:string`; `reviewStatus:string`; `createdAt:Date`, `updatedAt:Date`.

Indexes: `{ownerId:1,status:1,createdAt:-1}`; `{ownerId:1,resumeId:1}`.

Ownership/access: candidate owns decision; assigned coach can review only if flagged/assigned.

Sample:
```json
{ "_id": { "$oid": "665000000000000000000040" }, "ownerId": { "$oid": "665000000000000000000001" }, "resumeId": { "$oid": "665000000000000000000010" }, "jobDescriptionId": { "$oid": "665000000000000000000020" }, "originalText": "Worked on APIs", "proposedText": "Built internal reporting APIs using TypeScript", "reason": "Makes the existing work more specific without adding new claims.", "evidenceClaimIds": ["c1"], "status": "pending", "guardrailVersion": "1.0.0", "reviewStatus": "not_required", "createdAt": { "$date": "2026-01-01T10:20:00Z" }, "updatedAt": { "$date": "2026-01-01T10:20:00Z" } }
```

Retention: delete with resume/account; accepted edits remain attributable to their evidence while retained.

### `interview_questions`

Generated question bank entries, scoped to a candidate/job.

Fields: `_id:ObjectId`; `ownerId:ObjectId`; `jobDescriptionId:ObjectId`; `questionText:string`; `category:string`; `difficulty:"introductory"|"intermediate"|"advanced"`; `competency:string`; `rubricVersion:string`; `generatorVersion:string`; `createdAt:Date`.

Indexes: `{ownerId:1,jobDescriptionId:1,createdAt:-1}`.

Ownership/access: owner and assigned review scope.

Sample:
```json
{ "_id": { "$oid": "665000000000000000000050" }, "ownerId": { "$oid": "665000000000000000000001" }, "jobDescriptionId": { "$oid": "665000000000000000000020" }, "questionText": "Describe a trade-off you considered when designing an API.", "category": "technical", "difficulty": "intermediate", "competency": "API design", "rubricVersion": "1.0.0", "generatorVersion": "question-generator-v1", "createdAt": { "$date": "2026-01-01T10:30:00Z" } }
```

Retention: delete with candidate/job data.

### `interview_sessions`

Candidate-owned interview lifecycle and graph linkage.

Fields: `_id:ObjectId`; `ownerId:ObjectId`; `jobDescriptionId:ObjectId`; `questionIds:ObjectId[]`; `currentIndex:number`; `followUpCount:number`; `status:"in_progress"|"evaluating"|"completed"|"abandoned"`; `graphThreadId:string`; `rubricVersion:string`; `createdAt:Date`, `updatedAt:Date`, `completedAt:Date|null`.

Indexes: `{ownerId:1,createdAt:-1}`; unique `{graphThreadId:1}`; `{ownerId:1,status:1}`.

Ownership/access: owner; assigned coach only when review is requested/flagged.

Sample:
```json
{ "_id": { "$oid": "665000000000000000000060" }, "ownerId": { "$oid": "665000000000000000000001" }, "jobDescriptionId": { "$oid": "665000000000000000000020" }, "questionIds": [{ "$oid": "665000000000000000000050" }], "currentIndex": 0, "followUpCount": 0, "status": "in_progress", "graphThreadId": "665000000000000000000060", "rubricVersion": "1.0.0", "createdAt": { "$date": "2026-01-01T10:31:00Z" }, "updatedAt": { "$date": "2026-01-01T10:31:00Z" }, "completedAt": null }
```

Retention: delete with candidate data; terminal-session expiry may be configurable.

### `interview_answers`

Typed candidate answer records.

Fields: `_id:ObjectId`; `ownerId:ObjectId`; `sessionId:ObjectId`; `questionId:ObjectId`; `answerText:string`; `sequence:number`; `requestId:string`; `submittedAt:Date`.

Indexes: unique `{ownerId:1,sessionId:1,sequence:1}`; unique sparse `{ownerId:1,requestId:1}`; `{ownerId:1,sessionId:1}`.

Ownership/access: owner and specifically assigned coach review scope.

Sample:
```json
{ "_id": { "$oid": "665000000000000000000061" }, "ownerId": { "$oid": "665000000000000000000001" }, "sessionId": { "$oid": "665000000000000000000060" }, "questionId": { "$oid": "665000000000000000000050" }, "answerText": "I compared latency and maintainability before choosing the design.", "sequence": 0, "requestId": "client-generated-id", "submittedAt": { "$date": "2026-01-01T10:32:00Z" } }
```

Retention: delete with session/account; do not include answer text in logs.

### `interview_evaluations`

Rubric-based feedback for a session/answer.

Fields: `_id:ObjectId`; `ownerId:ObjectId`; `sessionId:ObjectId`; `answerId:ObjectId`; `rubricVersion:string`; `scores:{relevance:number,completeness:number,reasoning:number,examples:number,communication:number}`; `overallScore:number`; `strengths:string[]`; `improvements:string[]`; `exampleAnswer:string`; `confidence:number`; `reviewStatus:string`; `createdAt:Date`.

Indexes: unique `{ownerId:1,answerId:1,rubricVersion:1}`; `{ownerId:1,sessionId:1}`; `{ownerId:1,reviewStatus:1}`.

Ownership/access: owner and assigned coach review scope.

Sample:
```json
{ "_id": { "$oid": "665000000000000000000062" }, "ownerId": { "$oid": "665000000000000000000001" }, "sessionId": { "$oid": "665000000000000000000060" }, "answerId": { "$oid": "665000000000000000000061" }, "rubricVersion": "1.0.0", "scores": { "relevance": 3, "completeness": 2, "reasoning": 3, "examples": 2, "communication": 3 }, "overallScore": 2.6, "strengths": ["Explained a trade-off"], "improvements": ["Add a concrete outcome if one is available"], "exampleAnswer": "Illustrative example only.", "confidence": 0.82, "reviewStatus": "not_required", "createdAt": { "$date": "2026-01-01T10:33:00Z" } }
```

Retention: delete with session/account.

### `candidate_progress`

Derived progress summary; source sessions/evaluations remain authoritative.

Implemented fields: `_id:ObjectId`; `ownerId:ObjectId`; `completedInterviews:number`; `completedEvaluations:number`; `averageRubricScore:number|null`; `skillGapCount:number`; `updatedAt:Date`.

Indexes: unique `{ownerId:1}`; `{ownerId:1,lastActivityAt:-1}`.

Ownership/access: candidate only; admin sees operational metadata only.

Sample:
```json
{ "_id": { "$oid": "665000000000000000000070" }, "ownerId": { "$oid": "665000000000000000000001" }, "completedInterviews": 1, "averageRubricScores": { "relevance": 3, "completeness": 2 }, "practiceAreas": ["Add concrete examples"], "lastActivityAt": { "$date": "2026-01-01T10:33:00Z" }, "updatedAt": { "$date": "2026-01-01T10:33:00Z" }, "sourceVersion": "progress-v1" }
```

Retention: delete with candidate data; rebuildable from retained evaluations.

### `consents`

Consent history with policy/purpose provenance.

Implemented fields: `_id:ObjectId`; `ownerId:ObjectId` (authenticated user's ID); `purpose:"resume_processing"|"external_model_processing"|"analytics"`; `policyVersion:string` (chosen by server); `granted:boolean`; `recordedAt:Date`; `revokedAt:Date|null`; `source:"registration"|"upload"|"settings"`. Every grant and withdrawal inserts a new record; policy versions are never accepted from the client.

Indexes: `{ownerId:1,purpose:1,recordedAt:-1}`.

Ownership/access: candidate can view/revoke; restricted audit access.

Sample:
```json
{ "_id": { "$oid": "665000000000000000000080" }, "ownerId": { "$oid": "665000000000000000000001" }, "purpose": "resume_processing", "policyVersion": "privacy-v1", "granted": true, "recordedAt": { "$date": "2026-01-01T10:04:00Z" }, "revokedAt": null, "source": "upload" }
```

Retention: retain minimal consent evidence for the approved legal/accountability period; do not store resume content here.

### `agent_executions`

Operational trace for agent runs.

Fields: `_id:ObjectId`; `ownerId:ObjectId|null`; `jobId:ObjectId|null`; `workflowId:string`; `agentName:string`; `provider:string`; `model:string`; `promptVersion:string`; `schemaVersion:string`; `status:"running"|"succeeded"|"failed"`; `startedAt:Date`; `finishedAt:Date|null`; `durationMs:number|null`; `inputTokens:number|null`; `outputTokens:number|null`; `errorCode:string|null`.

Indexes: `{ownerId:1,startedAt:-1}`; `{status:1,startedAt:-1}`; `{jobId:1}`.

Ownership/access: restricted operations/admin metadata; no raw prompts, source text, secrets, or unnecessary personal data.

Sample:
```json
{ "_id": { "$oid": "665000000000000000000090" }, "ownerId": { "$oid": "665000000000000000000001" }, "jobId": { "$oid": "665000000000000000000091" }, "workflowId": "resume-parse", "agentName": "resume-parser", "provider": "configured-provider", "model": "configured-model", "promptVersion": "resume-parser-v1", "schemaVersion": "1", "status": "succeeded", "startedAt": { "$date": "2026-01-01T10:06:00Z" }, "finishedAt": { "$date": "2026-01-01T10:06:02Z" }, "durationMs": 2000, "inputTokens": null, "outputTokens": null, "errorCode": null }
```

Retention: proposed 90-day operational retention, subject to security and instructor review.

### `audit_logs`

Append-only record of security/privacy-sensitive actions.

Fields: `_id:ObjectId`; `actorUserId:ObjectId|null`; `actorRole:string|null`; `action:string`; `resourceType:string`; `resourceId:ObjectId|string|null`; `ownerId:ObjectId|null`; `reason:string|null`; `requestId:string`; `metadata:object` (allow-listed and redacted); `createdAt:Date`.

Indexes: `{createdAt:-1}`; `{actorUserId:1,createdAt:-1}`; `{ownerId:1,createdAt:-1}`; `{resourceType:1,resourceId:1}`.

Ownership/access: restricted security/audit access; administrators see metadata, never raw candidate content.

Sample:
```json
{ "_id": { "$oid": "6650000000000000000000a0" }, "actorUserId": { "$oid": "665000000000000000000001" }, "actorRole": "candidate", "action": "resume.uploaded", "resourceType": "resume", "resourceId": { "$oid": "665000000000000000000010" }, "ownerId": { "$oid": "665000000000000000000001" }, "reason": null, "requestId": "request-id", "metadata": { "contentType": "application/pdf", "sizeBytes": 42810 }, "createdAt": { "$date": "2026-01-01T10:05:00Z" } }
```

Retention: proposed 1 year, subject to policy/legal confirmation; avoid payload/content retention.

### `review_items`

Human review queue and final decision.

Fields: `_id:ObjectId`; `ownerId:ObjectId`; `targetType:"job_match"|"resume_suggestion"|"interview_evaluation"`; `targetId:ObjectId`; `flags:string[]`; `riskLevel:"low"|"medium"|"high"`; `status:"pending_review"|"in_review"|"approved"|"edited"|"rejected"`; `assignedCoachId:ObjectId|null`; `requestReason:string|null`; `decisionReason:string|null`; `decisionText:string|null`; `decidedBy:ObjectId|null`; `createdAt:Date`; `updatedAt:Date`; `decidedAt:Date|null`.

Indexes: `{status:1,createdAt:1}`; `{assignedCoachId:1,status:1,createdAt:1}`; `{ownerId:1,createdAt:-1}`; unique partial `{targetType:1,targetId:1}` for open review states.

Ownership/access: candidate may see their review status; only assigned coach/authorized reviewer sees content and decides.

Sample:
```json
{ "_id": { "$oid": "6650000000000000000000b0" }, "ownerId": { "$oid": "665000000000000000000001" }, "targetType": "job_match", "targetId": { "$oid": "665000000000000000000030" }, "flags": ["low_confidence"], "riskLevel": "medium", "status": "pending_review", "assignedCoachId": null, "requestReason": null, "decisionReason": null, "decisionText": null, "decidedBy": null, "createdAt": { "$date": "2026-01-01T10:13:00Z" }, "updatedAt": { "$date": "2026-01-01T10:13:00Z" }, "decidedAt": null }
```

Retention: retain decision metadata with the target; delete candidate content with account deletion unless an approved obligation requires otherwise.

### `jobs`

JSON-file-backed asynchronous work status.

Implemented fields: `_id:ObjectId`; `ownerId:ObjectId`; `type:string`; `status:"queued"|"running"|"succeeded"|"failed"|"cancelled"`; `progress:number`; `attempt:number`; optional `payload:object<string,string>`; `resultType:string|null`; `resultId:ObjectId|null`; `safeErrorCode:string|null`; `createdAt:Date`; `updatedAt:Date`. Idempotency and expiry fields are not currently implemented.

Indexes: `{ownerId:1,createdAt:-1}`; `{status:1,createdAt:1}`; unique sparse `{ownerId:1,idempotencyKey:1}`; TTL `{expiresAt:1}` when set.

Ownership/access: owner; workers operate under server identity and preserve `ownerId`.

Sample:
```json
{ "_id": { "$oid": "6650000000000000000000c0" }, "ownerId": { "$oid": "665000000000000000000001" }, "type": "resume_parse", "status": "queued", "progress": 0, "attempt": 0, "resultType": "parsed_resume_data", "resultId": null, "safeErrorCode": null, "createdAt": { "$date": "2026-01-01T10:05:00Z" }, "updatedAt": { "$date": "2026-01-01T10:05:00Z" } }
```

Retention: proposed 30 days after terminal state; expiresAt is assigned only after success/failure/cancellation.

### `langgraph_checkpoints` (future MongoDB migration)

The current implementation keeps LangGraph checkpoints in process memory; they are lost when the API restarts. This is a proposed future durable collection for a MongoDB migration.

Fields: `_id:ObjectId`; `threadId:string`; `checkpointId:string`; `workflow:"mock_interview"|"review_escalation"`; `ownerId:ObjectId`; `state:object` containing IDs, indices, and status only; `createdAt:Date`; `expiresAt:Date|null`.

Indexes: unique `{threadId:1,checkpointId:1}`; `{ownerId:1,threadId:1}`; TTL `{expiresAt:1}` when set.

Ownership/access: graph service only; candidate and coach access occurs through owner-scoped application services, not direct checkpoint reads.

Sample:
```json
{ "_id": { "$oid": "6650000000000000000000d0" }, "threadId": "interview-session-id", "checkpointId": "checkpoint-id", "workflow": "mock_interview", "ownerId": { "$oid": "665000000000000000000001" }, "state": { "sessionId": "665000000000000000000060", "currentIndex": 0, "status": "waiting_for_answer" }, "createdAt": { "$date": "2026-01-01T10:31:00Z" }, "expiresAt": null }
```

Retention: delete when the linked workflow is terminal and its approved retention period expires; checkpoint state must not duplicate resume/answer text.

## Relationship summary

- `users._id` has a one-to-one relationship with `candidates.userId`.
- `resumes` has one or more `parsed_resume_data` versions.
- `job_descriptions` and `resumes` are referenced by `job_matches`; a match may produce `skill_gaps` and `resume_suggestions`.
- `interview_sessions` references `job_descriptions` and ordered `interview_questions`; `interview_answers` reference session/question; `interview_evaluations` reference answer/session.
- `candidate_progress` is derived from completed interviews and evaluations.
- `review_items.targetType/targetId` references a supported result; `jobs.resultType/resultId` is a typed result reference.
- `agent_executions` records AI execution metadata; `audit_logs` records security/privacy actions.

## Retention and deletion policy

Proposed product behavior: user deletion starts an auditable cascade across candidate-owned collections and private storage. Jobs are cancelled where possible. Graph checkpoints and backups expire under their own retention windows. Exact legal retention for audit/consent records, backup expiry, and external provider retention must be confirmed before production.
