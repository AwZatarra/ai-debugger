# 🧠 AI Debugger

Backend that works as an **intelligent debugger for production incidents**.

It can detect incidents, automatically build context, analyze root causes using rules and LLMs, search for similar incidents, retrieve useful knowledge, and go all the way to a **PR proposal with human approval**.  
In the already validated flow, it can even end up creating a **real Pull Request on GitHub** with guardrails.

In short: this project aims to make production debugging **faster, more guided, and less dependent on starting manual reviews from scratch**.

---

## 🚀 What it does

The system follows a flow like this:

- ingests service logs and errors
- automatically detects incidents
- builds technical context for the incident
- runs heuristic RCA
- runs RCA with an LLM
- searches for similar incidents
- retrieves related knowledge and runbooks
- ranks probable causes
- allows human feedback
- generates a PR proposal
- requires human approval before continuing
- validates edits and local checks
- can open a **real PR on GitHub**

---

## ✨ Technical differentiators

- combines **deterministic rules + LLM**
- incorporates **human-in-the-loop**
- uses **guardrails** before interacting with GitHub
- clearly separates:
  - analysis
  - proposal
  - validation
  - execution
- provides traceability across the entire pipeline

---

## 🛠️ Technologies

- **Node.js**
- **TypeScript**
- **Express**
- **ClickHouse**
- **OpenTelemetry**
- **OpenAI Responses API**
- **GitHub REST API**
- **Docker**

---

## 📦 How to install it

### 1. Clone the repository

```bash
git clone https://github.com/AwZatarra/ai-debugger.git
cd ai-debugger
```

### 2. Install dependencies

At the root and in the corresponding services:

```bash
npm install
```

### 3. Configure environment variables

Create and adjust your `.env` / `.env.local` file according to your environment.

Relevant variables confirmed in the project flow:

```env
CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_USER=aiuser
CLICKHOUSE_PASSWORD=aipass123
LOG_INGESTOR_URL=http://localhost:3010/ingest-log
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
NODE_ENV=development
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4
EMBEDDING_MODEL=text-embedding-3-small

GITHUB_TOKEN=
GITHUB_API_BASE_URL=https://api.github.com
GITHUB_COMMITTER_NAME=AI Debugger Bot
GITHUB_COMMITTER_EMAIL=bot@ai-debugger.local
PR_PROPOSAL_DEFAULT_REPOSITORY=AwZatarra/ai-debugger
```

---

## ▶️ How to run it

### 1. Start the infrastructure

If you are using containers for observability and the database:

```bash
docker compose up -d
```

### 2. Start the backend services

Example services used in the validated flow:

- `service-a` → `http://localhost:3001`
- `service-b` → `http://localhost:3002`
- `incident-detector` → `http://localhost:3020`

Example for `service-b`:

```bash
cd services/service-b
npm run dev
```

---

## ✅ How to test it quickly

### 1. Check `service-b` health

```bash
curl http://localhost:3002/health
```

### 2. Generate a sample incident

```bash
curl http://localhost:3001/checkout
```

When the expected failure occurs, the validated flow may return something like:

```json
{
  "ok": false,
  "error": "CHECKOUT_FAILED",
  "detail": {
    "ok": false,
    "error": "DB_TIMEOUT"
  }
}
```

### 3. Detect the incident

```http
POST http://localhost:3020/detect
```

---

## 📌 Current status

Implemented and validated in the project:

- incident detection
- context builder
- heuristic RCA
- RCA with LLM
- analysis summary
- similar incidents
- knowledge retrieval
- deterministic cause ranking
- LLM cause ranking
- human feedback
- per-incident evaluation
- global stats
- minimal UI
- PR proposal with human approval
- prepare-execution
- generate-file-edits
- regenerate-file-edits
- validate-file-edits
- run-local-checks
- create-github-pr

---

## 🧱 Validated flow stack

### Backend
- Node.js + TypeScript
- Express
- ClickHouse
- OpenTelemetry
- OpenAI Responses API

### Integrations
- GitHub API for real PR creation with guardrails

---

## 🛡️ Guardrails

This project does **not** directly modify code without control.

Before creating a real PR, the flow requires:

- structured proposal
- human approval
- prepare-execution
- edit generation/regeneration
- validation against the real repository
- local checks
- branch and PR creation only at the end

---

## 💡 Project value

AI Debugger demonstrates real experience in:

- backend engineering
- AI-assisted debugging
- observability
- incident analysis
- LLM workflows
- guardrails for automation
- secure GitHub integration
- end-to-end technical pipeline design

It is not just a chatbot for logs.  
It is an operational flow that connects **incident → analysis → human decision → real PR**.

---

## 👨‍💻 Author

**Pool Rivera Molina**

- GitHub: [poolriveramolina](https://github.com/AwZatarra)
- LinkedIn: [Pool Rivera Molina](https://www.linkedin.com/in/pool-rivera-molina/)

---

## ⚡ Ultra-short quickstart

```bash
# 1. start infrastructure
docker compose up -d

# 2. start service-b
cd services/service-b
npm run dev

# 3. start service-a, incident-detector, and frontend
# (according to the repo's current scripts/config)

# 4. generate incident
curl http://localhost:3001/checkout

# 5. detect incident
curl -X POST http://localhost:3020/detect

# 6. operate from the minimal UI
# http://localhost:3000
```
