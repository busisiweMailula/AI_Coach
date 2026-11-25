# AI Resume and Interview Coach

The core backend is implemented for authentication, secure intake, consent, AI preparation workflows, human review, and interview practice. For now, application data is persisted to a local JSON file; MongoDB is a planned later migration. Semantic resume-to-job retrieval uses Mistral embeddings and local cosine ranking. JSON persistence and in-memory graph checkpoints are intended for single-process development only, not production.

## Project documentation

- [Initial repository assessment](docs/initial-assessment.md)
- [Architecture overview](docs/architecture/Architecture.md)
- [Architecture decision record](docs/architecture/Decision-Record.md)
- [High-level design](docs/architecture/HLD.md)
- [Low-level design](docs/architecture/LLD.md)
- [Component design](docs/architecture/Component-Design.md)
- [Data flow](docs/architecture/Data-Flow.md)
- [Database design](docs/architecture/Database-Design.md)
- [Security architecture](docs/architecture/Security-Architecture.md)
- [LangGraph workflow design](docs/architecture/LangGraph-Design.md)
- [Scoring and rubric decisions](docs/architecture/Scoring-and-Rubric.md)
- [API specification](docs/api/API-Specification.md) and [OpenAPI draft](docs/api/openapi.yaml)

## Requirements

- Node.js 20.19 or newer and npm
- Python 3.13 for the Presidio service

## Local development

1. Copy `.env.example` to `.env`, set `JWT_SECRET` and `PRESIDIO_API_TOKEN` to random values of at least 32 characters, and provide `INCEPTION_API_KEY`, `GROQ_API_KEY`, and `MISTRAL_API_KEY`. `EMBEDDING_PROVIDER=mistral` enables semantic matching. The configured `inception` provider uses Mercury 3 first and falls back to Groq's `openai/gpt-oss-120b` on network failures, timeouts, HTTP 410/429, or 5xx responses. To migrate to Groq before Inception's shutdown, set `LLM_PROVIDER=groq`; the app then uses `GROQ_MODEL`. Set `LLM_PROVIDER=disabled` to disable AI workflows. OpenAI API usage is billed separately from ChatGPT and is not enabled by this configuration. The Inception Mercury API is scheduled to stop serving requests after December 28, 2026; migrate before then. External processing also requires the candidate's `external_model_processing` consent. The app stores original resume text and evidence locally; only text processed by Presidio, masking the four configured PII types, is sent to Mistral for embeddings or to an LLM. The `mock` provider is reserved for tests.
2. The backend creates `.data/ai-coach.json` automatically. Set `JSON_DB_PATH` to change its location. Keep this file and its backups private: it contains candidate information and is not encrypted. Run only one API process against a JSON data file. This temporary store does not provide production-grade concurrency, durability, or database protections.
3. Create and install the Presidio Python virtual environment:

   ```powershell
   Set-Location presidio-service
   py -3.13 -m venv .venv
   .\.venv\Scripts\Activate.ps1
   .\.venv\Scripts\python.exe -m pip install --upgrade pip
   .\.venv\Scripts\python.exe -m pip install -r .\requirements.txt
   $env:PRESIDIO_API_TOKEN = "use-the-same-random-token-from-the-root-env-file"
   .\.venv\Scripts\python.exe .\app.py
   ```

   The service binds to loopback by default. It masks email addresses, South African mobile numbers, detected person names, and checksum/date-validated 13-digit South African ID numbers. The `PERSON` threshold defaults to `0.6`; the editable `person_allowlist.json` prevents common CV and technology terms from being masked. The default `en_core_web_sm` model is smaller and faster; `en_core_web_lg` is a larger optional model that needs separate installation and more memory, and is not guaranteed to eliminate name errors. Set `PRESIDIO_SPACY_MODEL` and `PRESIDIO_PERSON_SCORE_THRESHOLD` to configure the service. Check the running code with `Invoke-RestMethod http://127.0.0.1:5002/health`; its version combines the Git commit and source hash.
   To restart a previously launched local service from this terminal, stop the existing listener, load the API token from the root `.env`, then start the updated source:

   ```powershell
   $listeners = Get-NetTCPConnection -LocalPort 5002 -State Listen -ErrorAction SilentlyContinue
   $listeners | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ }
   $tokenLine = Get-Content ..\.env | Where-Object { $_ -match '^PRESIDIO_API_TOKEN=' } | Select-Object -First 1
   $env:PRESIDIO_API_TOKEN = $tokenLine.Substring('PRESIDIO_API_TOKEN='.Length).Trim().Trim('"')
   .\.venv\Scripts\python.exe .\app.py
   ```
4. Install and start the API in a separate terminal:

   ```powershell
   Set-Location backend
   npm install
   npm run dev
   ```

### Rebuild resume search data

Older match results and vector chunks may contain broad-redaction placeholders. Resume uploads retain original extracted text locally, so reindexing rebuilds vectors from that source. The embedding request still masks only the four PII types; the original chunks are retained for owner-scoped retrieval and evidence display. There is no BM25 index in this repository. Existing match/evidence results remain historical until you run matching again after reindexing.

Run from the `backend` directory after Presidio and Mistral configuration are available:

```powershell
npm run reingest:resumes -- --dry-run
npm run reingest:resumes
```

The script is idempotent and reports resume/chunk counts without printing CV contents. If a resume has no stored `extractedText` (for example, because it was deleted or never persisted), it must be re-uploaded before its index can be rebuilt.

5. Check `http://localhost:4000/api/v1/health`.
6. In a separate terminal, install and start the React frontend:

   ```powershell
   Set-Location frontend
   npm install
   npm run dev
   ```

7. Open `http://localhost:3000/`, sign in, review the privacy notice, and accept the current consent before uploading a CV. Consent is stored against the authenticated account in the JSON file; the upload endpoint independently checks it. The Vite development server proxies API requests to `http://localhost:4000`.

The API opens the JSON file before it starts listening. Startup fails with a logged error if the data file is unreadable or a required provider configuration is unavailable. Resume AI workflows send extracted text to the local Presidio service first; if that service is unavailable or returns an invalid response, the workflow fails without sending CV text to an AI model.

Resume evidence chunks and Mistral vectors are stored in the JSON data file and ranked locally using cosine similarity, scoped to the selected owner and resume. LangGraph checkpoints remain in process memory and are lost when the API restarts.

## Docker Compose

Copy `.env.example` to `.env`, replace `JWT_SECRET` and `PRESIDIO_API_TOKEN` with random secrets, add the selected LLM keys and `MISTRAL_API_KEY`, then run:

```powershell
docker compose up --build
```

Open the frontend at `http://localhost:3000`; the frontend web server proxies `/api` requests to the backend.

## Implemented API routes

- `GET /api/v1/health`
- `POST /api/v1/auth/register` (candidate self-registration only)
- `POST /api/v1/auth/login`
- `GET /api/v1/users/me` (Bearer token required)
- `PUT /api/v1/candidates/me/consents` and `GET /api/v1/candidates/me/consents`
- `POST /api/v1/resumes/upload`, `GET /api/v1/resumes`, `GET /api/v1/resumes/:resumeId`, `PATCH /api/v1/resumes/:resumeId`
- `POST /api/v1/jobs/analyze`, `GET /api/v1/jobs`, `GET /api/v1/jobs/:jobDescriptionId`, `GET /api/v1/jobs/status/:jobId`
- `POST /api/v1/matching/analyze`, `GET /api/v1/matches/:matchId`
- `POST /api/v1/skills/gaps`, `GET /api/v1/skills/gaps/:gapId`
- `POST /api/v1/resumes/optimize`, `GET /api/v1/suggestions`, `POST /api/v1/suggestions/:suggestionId/decision`
- `GET /api/v1/resumes/:resumeId/cv/preview`, `GET /api/v1/resumes/:resumeId/cv/download`
- `POST /api/v1/interviews/generate`, `GET /api/v1/interviews/question-sets/:questionSetId`
- `POST /api/v1/interviews`, `GET /api/v1/interviews/:sessionId`, `POST /api/v1/interviews/:sessionId/answer`, `POST /api/v1/interviews/:sessionId/evaluate`, `GET /api/v1/interviews/:sessionId/results`
- `GET /api/v1/candidates/me/progress`
- `POST /api/v1/reviews/request`, `GET /api/v1/reviews/pending`, `GET /api/v1/reviews/:reviewId`, `POST /api/v1/reviews/:reviewId/decision`

### Postman collection

Import [`postman/AI-Resume-Interview-Coach.postman_collection.json`](./postman/AI-Resume-Interview-Coach.postman_collection.json) into Postman. The collection defaults to the local API at `http://localhost:4000` and Presidio at `http://127.0.0.1:5002`; update its collection variables if your services use different addresses.

Run **API health**, **Register candidate**, then **Login candidate**. Login saves the bearer token for candidate requests. Grant both resume-processing and external-model-processing consent before trying CV workflows. For file uploads, choose a local PDF/DOCX file in the request's `file` form field. Pasted job descriptions are sent as JSON. AI workflows also require an enabled/configured AI provider. Coach and admin requests need their respective tokens set in the collection variables; those roles must be provisioned separately.

To run **Start match analysis**, first upload a CV and create a job description while signed in as the same candidate. Alternatively, run **List resumes** and **List job descriptions** to copy the latest owned IDs into the collection variables. The `resumeId` and `jobDescriptionId` values must each be 24-character MongoDB ObjectIds.

Resume uploads accept PDF/DOCX, validate file signatures and extract source text, then store the file in private local storage. Upload requires active resume-processing consent. Job descriptions accept pasted text or PDF/DOCX/TXT uploads and create persisted analysis jobs. Parsing, matching, skill-gap analysis, factual resume suggestions, question generation, and interview evaluation use validated AI outputs and persisted job status. Matching scores are calculated in code; uncertain or flagged results can be sent for human review. Candidate data endpoints are owner-scoped, and interview/review workflow state is checkpointed without storing answer bodies in graph state.

Resume suggestions target structured CV section, entry, and bullet IDs rather than searching model-generated “before” text. Accept/reject decisions are reversible; the preview and editable DOCX download are derived from the stored source CV and accepted suggestions. Suggestions that need facts from the candidate or conflict with another accepted edit remain unapplied until resolved.

The consent and upload interface is a React + TypeScript SPA in `frontend/`. Candidates separately consent to CV processing and sending only the Presidio-processed text to an external model. Consent policy versions are controlled by the server, and each grant or withdrawal creates a new history record. The updated policies require renewed consent; the application does not claim POPIA compliance.

The Presidio service is a separate Python component with its own `presidio-service/requirements.txt` and virtual environment; it does not install or run the TypeScript API or React frontend. Docker Compose keeps the service on the private Compose network and requires a shared API token. Presidio is a detection-and-replacement tool, not a guarantee of complete anonymization or legal compliance.

Registration cannot assign coach or admin roles. Provisioning those roles is intentionally reserved for a controlled administrative workflow.

### Local demo admin

For local development only, set `DEMO_ADMIN_EMAIL` and `DEMO_ADMIN_PASSWORD` in your untracked root `.env` file. When the development API starts, it creates the initial admin account before listening. The account is not reset if it already exists, and a non-admin account with that email causes startup to fail rather than changing its role. The same operation can be run manually from `backend`; the command refuses to run unless `NODE_ENV=development`:

```powershell
Set-Location backend
$env:DEMO_ADMIN_EMAIL = "admin@example.com"
$securePassword = Read-Host "Choose a local demo admin password" -AsSecureString
$env:DEMO_ADMIN_PASSWORD = [System.Net.NetworkCredential]::new("", $securePassword).Password
npm run bootstrap:demo-admin
Remove-Item Env:\DEMO_ADMIN_EMAIL
Remove-Item Env:\DEMO_ADMIN_PASSWORD
Remove-Variable securePassword
```

Use the email and password you entered to sign in as admin. In the admin workspace, manage account status, directly register new coaches, and view audit activity. Candidate accounts cannot be promoted to coach; register coaches directly. Deactivated candidates and coaches cannot sign in or use existing access tokens. Admin accounts require controlled provisioning. The bootstrap command is for the local JSON database only; never use demo credentials in production.

## Validation

```powershell
Set-Location backend
npm install
npm test
npm run build
```

```powershell
Set-Location frontend
npm install
npm run build
```

