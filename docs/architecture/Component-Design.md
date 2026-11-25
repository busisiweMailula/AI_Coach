# Component Design

## Components and contracts

| Component | Owns | Calls | Must not |
|---|---|---|---|
| Auth middleware | JWT validation and request identity | User/auth configuration | Accept caller-supplied identity |
| Routes/controllers | HTTP transport and status codes | Services, validators | Query the persistence adapter or call an LLM |
| Application services | Use-case orchestration and ownership | Repositories, domain, agents, jobs | Leak cross-user data |
| Domain | Score calculation, evidence and language rules, rubric aggregation | Pure typed inputs | Import Express, persistence, or provider SDKs |
| Repositories | MongoDB persistence | Shared MongoDB database connection | Call agents or make authorization decisions without owner criteria |
| Storage adapter | Private original/derived files | MongoDB GridFS | Serve uploads as public static files |
| Job runner | Queue/status/retry lifecycle | Services/agents, job repository | Treat transient failure as success |
| Agent runtime | Prompt/provider/schema/execution lifecycle | `LlmProvider`, execution repository | Access domain repositories directly |
| LLM provider adapter | Provider-specific request/response | Vendor SDK/API | Expose API keys to browser or log prompt secrets |
| Embedding and vector retrieval | Embed anonymized resume chunks and retrieve owner-scoped evidence | Mistral API and local cosine ranking | Send raw resume text or query another candidate's vectors |
| Interview graph | Interview state transitions and pause/resume | Interview services, evaluator agent, checkpointer | Own HTTP semantics or duplicate answer records |
| Review graph | Review escalation and coach interrupt | Review service, audit repository, checkpointer | Approve itself or bypass role/ownership guards |

## Core interfaces (design contract)

```ts
interface LlmProvider {
  readonly name: string;
  generateJson<T>(
    request: {
      model: string;
      systemPrompt: string;
      userPrompt: string;
      outputSchema: unknown;
      timeoutMs: number;
    },
  ): Promise<{ value: T; usage?: { inputTokens?: number; outputTokens?: number } }>;
}

interface FileStorage {
  put(input: { key: string; bytes: Buffer; contentType: string }): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
```

These are design contracts; the backend implementations live under `backend/src/infra/`, `backend/src/agents/`, and `backend/src/graphs/`. Provider-specific live behavior still requires configured credentials and integration validation.

## Cross-cutting behavior

- Authentication precedes protected operations.
- Input validation precedes service execution.
- Ownership checks happen before content is read or changed.
- Request IDs are returned and included in structured logs.
- Secrets, password values, file contents, and candidate answer text are excluded from routine logs.
- All mutations affecting roles, review decisions, consent, or candidate data deletion produce audit events.

## Error behavior

Expected domain failures use typed errors and documented HTTP codes. Unexpected errors are logged with a request ID and return a generic `500` response. Provider, JSON-file, and file-storage errors do not disclose stack traces or credentials.
