# AI Resume and Interview Coach

The core backend is implemented for authentication, secure intake, consent, AI preparation workflows, human review, and interview practice. Application records and uploaded source files are stored in the configured remote MongoDB deployment; upload binaries use GridFS. Semantic resume-to-job retrieval uses Mistral embeddings and local cosine ranking. Graph checkpoints remain in process memory.

Interview practice accepts typed answers or editable browser speech transcripts, with a two-minute recording timer that runs only while speech or video is being recorded and pauses when recording stops. Candidates can make up to three speech recordings per question. Optional video practice records camera and microphone locally for preview or download. A clip is uploaded to private local storage only when the candidate submits the interview for coach review. Browser speech recognition may use the browser's speech service.

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
- A hosted MongoDB deployment (including Atlas) with GridFS enabled
- Python 3.13 for the Presidio service

## Local development

1. Copy `.env.example` to `.env`, set `JWT_SECRET` and `PRESIDIO_API_TOKEN` to random values of at least 32 characters, and provide `INCEPTION_API_KEY`, `GROQ_API_KEY`, and `MISTRAL_API_KEY`. `EMBEDDING_PROVIDER=mistral` enables semantic matching. The configured `inception` provider uses Mercury 3 first and falls back to Groq's `openai/gpt-oss-120b` on network failures, timeouts, HTTP 410/429, or 5xx responses. To migrate to Groq before Inception's shutdown, set `LLM_PROVIDER=groq`; the app then uses `GROQ_MODEL`. Set `LLM_PROVIDER=disabled` to disable AI workflows. OpenAI API usage is billed separately from ChatGPT and is not enabled by this configuration. The Inception Mercury API is scheduled to stop serving requests after December 28, 2026; migrate before then. External processing also requires the candidate's `external_model_processing` consent. The API anonymizes serialized AI inputs, resume chunks, and embedding queries through Presidio before sending them to any external LLM or embedding provider; failures stop processing without an unredacted fallback. The `mock` provider is reserved for tests.
2. Set `MONGODB_URI` to your hosted MongoDB connection string, `MONGODB_DB_NAME`, and `POSTGRES_URL` to your hosted PostgreSQL connection string in `.env`. The API requires both remote databases and connects to them before listening. Structured app records and uploaded files are stored in MongoDB/GridFS; audit events are written to PostgreSQL's `audit_logs` table. The admin audit-log view reads from PostgreSQL and resolves actor/subject emails from MongoDB.
3. Configure `PRESIDIO_SPACY_MODEL` (default `en_core_web_sm`) and `PRESIDIO_PERSON_CONFIDENCE_THRESHOLD` (default `0.6`) if needed. The service loads its validated, case-insensitive person allow-list from `presidio-service/person_allowlist.json`; deploy a valid JSON string array at that path or set `PRESIDIO_PERSON_ALLOWLIST_PATH`. Create and install the Presidio Python virtual environment:

   ```powershell
   Set-Location presidio-service
   py -3.13 -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install --upgrade pip
   python -m pip install -r requirements.txt
   $env:PRESIDIO_API_TOKEN = "use-the-same-random-token-from-the-root-env-file"
   python .\app.py
   ```

   The service binds to loopback by default. It analyzes English text with Presidio and the `en_core_web_sm` spaCy model. Detection is not guaranteed to find every personal detail; review the output and configure/test recognizers for your use case.
4. Install and start the API in a separate terminal:

   ```powershell
   Set-Location backend
   npm install
   npm run dev
   ```

5. Check `http://localhost:4000/api/v1/health`.
6. In a separate terminal, install and start the React frontend:

   ```powershell
   Set-Location frontend
   npm install
   npm run dev
   ```

7. Open `http://localhost:3000/`, sign in, review the privacy notice, and accept the current consent before uploading a CV. Consent is stored in MongoDB against the authenticated account; the upload endpoint independently checks it. The Vite development server proxies API requests to `http://localhost:4000`.

The API connects to the configured MongoDB and PostgreSQL deployments before it starts listening; startup fails if either database is unavailable. It does not use a local JSON database or local upload directory at runtime. Resume AI workflows send extracted text to the local Presidio service first; if that service is unavailable or returns an invalid response, the workflow fails without sending CV text to an AI model.

Resume evidence chunks and Mistral vectors are stored in MongoDB and ranked locally using cosine similarity, scoped to the selected owner and resume. LangGraph checkpoints remain in process memory and are lost when the API restarts.

To migrate an existing JSON store, build the backend, then run a dry-run first from `backend`:

```powershell
npm run migrate:json-to-mongodb -- --source ".data/ai-coach.json"
npm run migrate:json-to-mongodb -- --source ".data/ai-coach.json" --merge --apply
```

The migration leaves the source file unchanged. Use `--merge` when the hosted database already contains records; existing records with the same `_id` are skipped. Conflicting user emails with different IDs stop the import so account references are not silently changed. The source JSON file is never deleted automatically.

After the JSON records are copied, copy referenced legacy uploads into GridFS:

```powershell
npm run migrate:uploads-to-gridfs -- --source-dir ".data/uploads"
npm run migrate:uploads-to-gridfs -- --source-dir ".data/uploads" --apply
```

Both migration scripts default to dry-run. Upload migration only copies files and is safe to rerun; it never deletes local files. Verify destination users, resume records, and uploaded files before removing the local JSON file or upload directory. Keep a backup until the remote data has been checked.

Audit events created after deployment are stored in PostgreSQL. To move historical audit entries currently in MongoDB, run the MongoDB-to-PostgreSQL command below with `--collection audit_logs` after the legacy JSON records have been imported into MongoDB. Existing MongoDB audit records are not deleted.

If running in Docker, the legacy JSON and upload files must be made available at the specified paths through a secure temporary mount; do not add them to the image. Run both migration commands while the API is stopped:

```powershell
docker compose stop api
docker compose run --rm api npm run migrate:json-to-mongodb -- --source /app/.data/ai-coach.json --merge
docker compose run --rm api npm run migrate:json-to-mongodb -- --source /app/.data/ai-coach.json --merge --apply
docker compose run --rm api npm run migrate:uploads-to-gridfs -- --source-dir /app/.data/uploads
docker compose run --rm api npm run migrate:uploads-to-gridfs -- --source-dir /app/.data/uploads --apply
docker compose up -d api
```

### MongoDB to PostgreSQL data copy

The backend uses MongoDB for application data and PostgreSQL for audit logs. This script optionally copies MongoDB collections to PostgreSQL; that copy does not switch other runtime data to PostgreSQL. Set `POSTGRES_URL` in `.env`, verify `MONGODB_URI` and `MONGODB_DB_NAME` point to the source database, then run from `backend`:

```powershell
npm run build
npm run migrate:mongodb-to-postgres
npm run migrate:mongodb-to-postgres -- --apply
npm run migrate:mongodb-to-postgres -- --collection audit_logs
npm run migrate:mongodb-to-postgres -- --collection audit_logs --apply
```

The default is a dry run. Use `--collection audit_logs` to copy only existing audit events. The script creates one PostgreSQL table per selected Mongo collection and maps top-level fields to typed SQL columns (`ObjectId` references become text); nested objects and arrays are stored as JSONB. Without a collection selector, it copies all collections except `resume_vector_chunks` (kept in MongoDB for vector search) and `interview_answers` (raw candidate answers are not copied). PostgreSQL rows retain the Mongo `_id` as `mongo_id`. Existing rows with the same `mongo_id` are left unchanged, so re-running the copy is safe; source MongoDB data is never updated or deleted. Resume metadata and parsed/structured resume records are copied; GridFS upload binaries remain in MongoDB.

The dry run reports collection counts and counts of users by role without printing user content. If candidate or coach accounts are missing from the selected MongoDB database, the script warns but cannot recreate accounts that are not present in the source. Verify the source database and dry-run report before applying. Because interview answers are omitted, copied interview sessions may retain answer ID references with no corresponding answer rows. The migration does not stop the running application from writing answers to MongoDB.

## Docker Compose

Copy `.env.example` to `.env`, set hosted `MONGODB_URI`, `MONGODB_DB_NAME`, and `POSTGRES_URL`, replace `JWT_SECRET` and `PRESIDIO_API_TOKEN` with random secrets, add the selected LLM keys and `MISTRAL_API_KEY`, then run:

```powershell
docker compose up --build
```

Open the frontend at `http://localhost:3000`; the frontend web server proxies `/api` requests to the backend. Docker Compose connects the API to the hosted MongoDB and PostgreSQL deployments from `.env`; it does not start local databases or persist candidate data in a Compose volume.

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
- `POST /api/v1/interviews/generate`, `GET /api/v1/interviews/question-sets/:questionSetId`
- `POST /api/v1/interviews`, `GET /api/v1/interviews/:sessionId`, `POST /api/v1/interviews/:sessionId/answer`, `POST /api/v1/interviews/:sessionId/evaluate`, `GET /api/v1/interviews/:sessionId/results`
- `GET /api/v1/candidates/me/progress`
- `POST /api/v1/reviews/request`, `GET /api/v1/reviews/pending`, `GET /api/v1/reviews/:reviewId`, `POST /api/v1/reviews/:reviewId/decision`

### Postman collection

Import [`postman/AI-Resume-Interview-Coach.postman_collection.json`](./postman/AI-Resume-Interview-Coach.postman_collection.json) into Postman. The collection defaults to the local API at `http://localhost:4000` and Presidio at `http://127.0.0.1:5002`; update its collection variables if your services use different addresses.

Run **API health**, **Register candidate**, then **Login candidate**. Login saves the bearer token for candidate requests. Grant both resume-processing and external-model-processing consent before trying CV workflows. For file uploads, choose a local PDF/DOCX file in the request's `file` form field. Pasted job descriptions are sent as JSON. AI workflows also require an enabled/configured AI provider. Coach and admin requests need their respective tokens set in the collection variables; those roles must be provisioned separately.

To run **Start match analysis**, first upload a CV and create a job description while signed in as the same candidate. Alternatively, run **List resumes** and **List job descriptions** to copy the latest owned IDs into the collection variables. The `resumeId` and `jobDescriptionId` values must each be 24-character MongoDB ObjectIds.

Resume uploads accept PDF/DOCX, validate file signatures and extract source text, then store the file in the private MongoDB GridFS bucket. Upload requires active resume-processing consent. Job descriptions accept pasted text or PDF/DOCX/TXT uploads and create persisted analysis jobs. Parsing, matching, skill-gap analysis, factual resume suggestions, question generation, and interview evaluation use validated AI outputs and persisted job status. Matching scores are calculated in code; uncertain or flagged results can be sent for human review. Candidate data endpoints are owner-scoped, and interview/review workflow state is checkpointed without storing answer bodies in graph state.

The consent and upload interface is a React + TypeScript SPA in `frontend/`. Candidates separately consent to CV processing and sending only the Presidio-processed text to an external model. Consent policy versions are controlled by the server, and each grant or withdrawal creates a new history record. The updated policies require renewed consent; the application does not claim POPIA compliance.

The Presidio service is a separate Python component with its own `presidio-service/requirements.txt` and virtual environment; it does not install or run the TypeScript API or React frontend. It replaces only person, email, South African mobile, and valid South African ID detections with `<PERSON>`, `<EMAIL_ADDRESS>`, `<PHONE_NUMBER>`, and `<ZA_ID_NUMBER>`. Other CV text is retained. Docker Compose keeps the service on the private Compose network and requires a shared API token. Presidio is a detection-and-replacement tool, not a guarantee of complete anonymization or legal compliance.

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

Use the email and password you entered to sign in as admin. In the admin workspace, manage account status, directly register new coaches, and view audit activity. Candidate accounts cannot be promoted to coach; register coaches directly. Deactivated candidates and coaches cannot sign in or use existing access tokens. Admin accounts require controlled provisioning. The bootstrap command is for local development only; never use demo credentials in production.

## Validation

```powershell
Set-Location backend
npm install
npm test
npm run build
```

The backend test runner starts a disposable MongoDB 7.0.14 on loopback for the phase 4/5 integration tests and stops it after the run. Tests run in a single forked worker and the test server's WiredTiger cache is capped at 256 MB to keep resource use bounded. The first run downloads the MongoDB test binary. Set `MONGODB_TEST_URI` to use an existing test-only MongoDB deployment instead, or set `MONGODB_TEST_VERSION` to select another compatible binary version. Integration suites use isolated, randomly named databases; do not point `MONGODB_TEST_URI` at production data.

```powershell
Set-Location frontend
npm install
npm run build
```

