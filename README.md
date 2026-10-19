<!-- <p align="center">
  <a href="#" target="_blank"><img src="#" width="200" alt="logo" /></a>
</p> -->

<p align="center">
  <a href="#" target="_blank">NestJS App</a> built using Nest framework with Typescript & Postgres database.
</p>

## Description

To be specified.

## Installation

_Note: Skip this section for docker based production deployment_

```bash
# install dependencies
$ npm install
```

## Setup

Copy the contents of example.env to create .env in the root and update env variables to set server configuration to run.

First you need to run and initialize databases.

> For non docker environment

`DATABASE_URL`, `REDIS_URI` in .env will be use to connect with databases, Please make sure you have correct connection uri here.

```bash
# development
$ npm run db:init

# production
$ npm run db:migrate:deploy
$ npm run db:seed
```

> For docker environment

_Note: If you already have running required database containers then you can follow same setup as mentioned above for non docker environment._

`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`, `REDIS_PORT`, `REDIS_PASSWORD` will be use to create database containers with authentication credential from .env, So make sure `DATABASE_URL` and `REDIS_URI` have exact same user, password and port for connection.

To run production database containers you need to set `POSTGRES_DATA_VOLUME` and `REDIS_DATA_VOLUME` value to be set in .env file to mount the volume into host machine.

```bash
# development
$ npm run dev:db
$ npm run db:init

# production
$ npm run prod:db
$ npm run db:migrate:deploy
$ npm run db:seed
```

For convenience to switch between docker environment to local environment & testing, Please create host entry in your machine with following:-

```
127.0.0.1 postgres
127.0.0.1 redis
```

## Run the server in docker container

```bash
# development
$ npm run dev
$ npm run dev:stop # To shut down containers

# production
$ npm run prod
$ npm run prod:stop # To shut down containers
```

## Run the server in local machine

```bash
# development
$ npm run start:dev

# production
$ npm run start:prod
```

## Test

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Migrate/Sync Database Schema

```bash
# initialize database - push schema, add constraints & seed database
$ npm run db:init

# preview schema
$ npm run db:studio

# seed database
$ npm run db:seed

# seed specific seed file into the database
$ npm run db:seed:only <name> # i.e. `npm run db:seed:only admin` to run prisma/seeds/admin.seed.ts

# add constraints in schema (Note: Not required, If not using `db:schema:push` on staging or production env)
$ npm run db:schema:constraints

# add constraints for the specific table
$ npm run db:schema:constraints:only <table name> # i.e. `npm run db:schema:constraints:only user` to add constraints into the user table

# generate client with schema
$ npm run db:client:generate

# push schema changes to the database without migration
$ npm run db:schema:push

# generate migration for new changes
$ npm run db:migration:create

# generate migration for new changes & deploy
$ npm run db:migrate:dev

# reset database
$ npm run db:migrate:reset

# deploy all migrations
$ npm run db:migrate:deploy
```

## API Documentation

```bash
# development
http://localhost:{PORT}/api-spec

# production
{API_URL}/api-spec
```

## Monitoring

To enable metrics server update `.env` file with below variables -

```bash
ENABLE_METRICS=true
METRICS_PORT=8080
METRICS_HOST=0.0.0.0
```

Copy `example.env` file & create `.env` file in `monitoring` directory. Then use below command to start/stop monitoring tools `Prometheus` & `Grafana`

```bash
# start
$ npm run monitoring

# stop
$ npm run monitoring:stop
```

To access `Grafana` & `Prometheus` navigate to below urls -

```bash
# Grafana
http://127.0.0.1:{GFAFANA_PORT}

# Prometheus
http://127.0.0.1:{PROMETHEUS_PORT}

```

## Recruitment Automation & Google Gemini AI Integration

This application features automated recruitment processing that monitors a Gmail recruitment inbox, extracts text from resume attachments (PDF and DOCX), and screens applications using the **Google Gemini API** via the official TypeScript SDK (`@google/genai`).

### 1. Google Gemini Setup & API Key

1. **Obtain a Google Gemini API Key:**
   - Navigate to [Google AI Studio](https://aistudio.google.com/) and create an API key, or generate one in [Google Cloud Console](https://console.cloud.google.com/).
2. **Account Billing, Free Tier & Quota Limits:**
   - Google AI Studio provides a free tier for testing and development subject to rate limits (requests per minute and daily tokens) depending on the selected model.
   - For production use or high-volume batch processing, link a Google Cloud billing account to prevent HTTP 429 quota exhaustion.
     > [!IMPORTANT]
     > Free-tier availability, rate limits, and billing depend on the Google AI account, selected model, and API plan. If quota is exceeded on an unfunded account, API calls return `RESOURCE_EXHAUSTED`.
3. **Keep API Key Private:**
   > [!CAUTION]
   > Keep your organization's API key strictly private. Never expose the key in frontend code, Swagger docs, API responses, logs, or committed files.
4. **Configure Local Environment:**
   Add the following variables to your local `.env` file (which is strictly excluded from Git via `.gitignore`):

   ```bash
   # Google Gemini AI Integration
   GEMINI_API_KEY=your_gemini_api_key_here
   GEMINI_MODEL=gemini-3.8-flash
   GEMINI_MAX_RETRIES=2
   GEMINI_TIMEOUT_MS=60000
   ```

   **Supported Gemini Models:**
   - `gemini-3.8-flash` (Recommended default: balanced speed, 1M context, high reasoning and structured JSON output)
   - `gemini-3.5-flash-lite` (Fastest, low-latency, cost-effective high-throughput model)
   - `gemini-4-argon` (Most powerful model for complex multimodal reasoning)
   - You can configure any model supported by your Gemini API account via `GEMINI_MODEL`.

### 2. Testing Gemini AI Without Triggering Automatic Polling

To test Gemini screening in isolation on one resume without enabling or triggering the automatic background cron polling (`GMAIL_POLLING_ENABLED=false`), use the provided authenticated REST endpoints:

1. **Verify System and Gemini Configuration Status:**

   ```bash
   GET /mail/gmail/status
   ```

   Returns the current status of Gmail OAuth2 connection and Google Gemini AI configuration (configured status, configured model, and whether analysis is available).

2. **Inspect Messages and Test Resume Screening On Demand:**

   ```bash
   GET /mail/gmail/messages?take=3&extractResumes=true&analyzeWithGemini=true
   ```

   Retrieves recent recruitment emails, downloads and extracts resume attachments, and executes Gemini analysis on demand without marking them as processed in the background polling pipeline.

3. **Analyze a Specific Email Application by Message ID:**

   ```bash
   POST /mail/gmail/messages/{messageId}/analyze
   ```

   Extracts resume attachments for the specified message and executes Gemini screening analysis.

4. **Retrieve Stored Analysis from Redis Cache:**

   ```bash
   GET /mail/gmail/messages/{messageId}/analysis
   ```

   Returns cached analysis results stored under the `:gemini:` Redis namespace.

5. **Manually Trigger Full Recruitment Inbox Check:**
   ```bash
   POST /mail/gmail/poll
   ```
   Triggers a single manual execution of the inbox polling pipeline.

### 3. Structured Screening Schema & Logic

The analysis produces structured data adhering strictly to RFC 8259 JSON validated against runtime schema rules:

- **Candidate Contact**: Name, email, and phone (or null).
- **Application Details**: Job role, extracted skills, projects, education, and experience.
- **Match Score**: Objective 0 to 100 score evaluating candidate qualification alignment with the target role.
- **Matched Requirements**: List of verified criteria satisfied by evidence in the application.
- **Missing or Unclear Requirements**: Explicit list of unstated or ambiguous criteria.
- **Screening Decision**:
  - `SHORTLIST`: Mandatory eligibility requirements demonstrably met with sufficient evidence.
  - `REJECT`: Mandatory eligibility requirements demonstrably NOT met.
  - `MANUAL_REVIEW`: Information is ambiguous, missing, unreadable, or requires human HR judgment.
- **Evidence-Based Explanation**: Concise explanation citing specific application text.
- **HR Review Flag (`hrReviewRequired`)**: Set to `true` whenever manual review is recommended.

---

## Role-Based HR Assignment, Candidate Tracking & Email Notifications

### 1. Role-Based HR Mapping Configuration

HR assignment mappings and contact addresses are centrally configured via environment variables and `hrConfigFactory`:

| Canonical Role        | Mapped Roles / Variations                                    | Assigned HR           | Environment Variables                |
| --------------------- | ------------------------------------------------------------ | --------------------- | ------------------------------------ |
| `REACT_DEVELOPER`     | React Developer, React.js Developer, ReactJS, React Frontend | HR 1                  | `HR1_ID`, `HR1_NAME`, `HR1_EMAIL`    |
| `NODE_DEVELOPER`      | Node Developer, Node.js Developer, NodeJS, Node Backend      | HR 1                  | `HR1_ID`, `HR1_NAME`, `HR1_EMAIL`    |
| `QA_TESTER`           | QA Tester, QA Engineer, Quality Assurance, Software Tester   | HR 2                  | `HR2_ID`, `HR2_NAME`, `HR2_EMAIL`    |
| `BUSINESS_ANALYST`    | Business Analyst, BA, IT Business Analyst                    | HR 2                  | `HR2_ID`, `HR2_NAME`, `HR2_EMAIL`    |
| _Unknown / Ambiguous_ | Conflicting or unmapped roles                                | Pending Manual Review | Unassigned (`assignedHrEmail: null`) |

Configure in `.env`:

```bash
# Role-Based HR Assignment Configuration
HR1_ID=hr-1
HR1_NAME=HR 1
HR1_EMAIL=hr1@example.com
HR2_ID=hr-2
HR2_NAME=HR 2
HR2_EMAIL=hr2@example.com
```

### 2. Candidate Screening & Database Persistence

All analyzed candidates are persisted in PostgreSQL under the `candidate` table:

- **`SHORTLIST`**: Saved with match score, matched requirements, candidate summary, and HR assignment. Triggers automatic HR email notification.
- **`REJECT`**: Saved with evidence-based rejection reason. No automatic HR email is sent.
- **`MANUAL_REVIEW`**: Saved for internal review without sending an automatic notification.
- **Duplicate Prevention**: Idempotency is enforced on `[gmail_message_id, attachment_id]` via `idempotency_key`, preventing duplicate candidate entries across poller runs.

### 3. Automatic HR Email Notifications

When a candidate is `SHORTLIST` and assigned to an HR:

- Sends an email to the assigned HR (`hr1@example.com` or `hr2@example.com`).
- Embeds candidate name, applied role, contact details, match score (0–100), AI candidate summary, key matched requirements, and screening explanation.
- Attaches the verified original resume in its original PDF or DOCX format.
- Includes a direct link to the candidate's profile on the dashboard.
- Uses idempotency locks and bounded retries, tracking status as `SENT`, `FAILED`, `PENDING`, or `NOT_REQUIRED`.

### 4. Candidate Dashboard & Profile APIs

All candidate endpoints are protected by `JwtAuthGuard`, `AccessGuard`, and `RolesGuard(Admin)`:

- **Dashboard Statistics:**

  ```bash
  GET /candidates/stats
  ```

  Returns actual database counts: `{ total, shortlisted, rejected, manualReview }`.

- **Candidate Listing (with search, pagination & filters):**

  ```bash
  GET /candidates?status=SHORTLIST&role=React&search=John&skip=0&take=10
  ```

  Filters by `status` (`SHORTLIST`, `REJECT`, `MANUAL_REVIEW`), `role`, `assignedHr`, `startDate`, `endDate`, and free text `search`.

- **Candidate Profile Details:**

  ```bash
  GET /candidates/{id}
  ```

  Retrieves full candidate information and recent notification audit logs.

- **Download / Preview Original Resume:**
  ```bash
  GET /candidates/{id}/resume
  ```
  Streams the original PDF or DOCX resume attachment with proper `Content-Type` and `Content-Disposition`.
