# Trade Document Intent Validation Engine

> AI-powered cross-document semantic validation for Letter of Credit (LC) operations — detecting fraud signals and discrepancies that rule-based checklist systems cannot find.

---

## Overview

The Trade Document Intent Validation Engine is a **multi-agent AI system** that validates commercial intent across four trade documents — Letter of Credit, Commercial Invoice, Bill of Lading, and Insurance Certificate. It operates at the **semantic layer**, reasoning across all documents to detect inconsistencies that skilled checkers currently catch only through years of experience and intuition.

Traditional LC document checking is **syntactic**: it asks whether individual field values match. This engine asks whether the **commercial narrative** across all documents is coherent, physically plausible, and consistent with known trade patterns.

Every AI finding is anchored to **verbatim source text** from the original documents and tagged to the relevant **UCP 600 article** — providing a complete, defensible audit trail for every examination decision.

---

## Key Features

- **Multi-agent AI pipeline** — dedicated extraction agents per document type (LC, Invoice, BL, Insurance) powered by Claude claude-sonnet-4-6
- **Cross-document semantic validation** across 6 dimensions: commercial coherence, entity resolution, logistics feasibility, coverage alignment, temporal coherence, and trade pattern anomaly
- **Verbatim citation enforcement** — every finding must cite exact source text; hallucination is architecturally prevented
- **UCP 600 compliance tagging** — all findings linked to relevant ICC UCP 600 articles
- **Risk classification** — Critical / Moderate / Informational with 0–100 confidence scores and always-Critical rule overrides
- **Straight-through processing (STP)** — clean LC sets auto-flagged for supervisor approval, targeting 50–60% STP rate
- **Immutable audit trail** — full evidence chain exportable as PDF or JSON for regulatory response
- **Human override loop** — checker overrides captured with timestamp, user ID, and reason; feeds retraining pipeline
- **Custom rule configuration** — no-code interface for corridor/commodity-specific rules
- **Fraud typology library** — 6 pre-seeded typologies (Ghost Shipment, Over-Invoicing, Document Fabrication, etc.)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    React / Vite Frontend                     │
│   Upload │ Review Queue │ Discrepancy Report │ Audit Trail   │
└──────────────────────┬──────────────────────────────────────┘
                       │ REST API
┌──────────────────────▼──────────────────────────────────────┐
│                  Node.js + Express Backend                   │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ LC Agent │  │ Invoice  │  │  BL Agent│  │ Insurance │  │
│  │          │  │  Agent   │  │          │  │   Agent   │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬─────┘  │
│       │              │              │               │        │
│  ┌────▼──────────────▼──────────────▼───────────────▼─────┐ │
│  │           Intent Analysis Engine                        │ │
│  │   (6-dimension cross-document reasoning · CoT)          │ │
│  └────────────────────────┬────────────────────────────────┘ │
│                           │                                  │
│  ┌────────────────────────▼────────────────────────────────┐ │
│  │              Risk Classifier                             │ │
│  │   Critical │ Moderate │ Informational + confidence score │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  Bull / Redis Queue        PostgreSQL Audit DB               │
└─────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| AI Agents | Claude claude-sonnet-4-6 (Anthropic) | Document extraction and cross-document reasoning |
| Backend | Node.js + Express | API orchestration, pipeline management |
| Queue | Redis + Bull | Async document processing, retry logic |
| Database | PostgreSQL | Audit trail, findings, overrides, users |
| Frontend | React 18 + Vite + TypeScript | Review UI, discrepancy report, audit viewer |
| Styling | Tailwind CSS | Component styling |
| Containers | Docker + Docker Compose | Deployment and service orchestration |

---

## Project Structure

```
trade-document-intent-validation-engine/
├── backend/
│   ├── src/
│   │   ├── agents/
│   │   │   ├── lcAgent.js               # LC extraction agent
│   │   │   ├── invoiceAgent.js          # Invoice extraction agent
│   │   │   ├── blAgent.js               # Bill of Lading agent
│   │   │   ├── insuranceAgent.js        # Insurance agent
│   │   │   └── intentAnalysisEngine.js  # Cross-document reasoning
│   │   ├── services/
│   │   │   ├── riskClassifier.js        # Critical/Moderate/Info classification
│   │   │   ├── queueService.js          # Bull/Redis queue management
│   │   │   ├── auditService.js          # Immutable audit trail
│   │   │   └── documentProcessor.js    # Full pipeline orchestrator
│   │   ├── routes/
│   │   │   ├── documents.js             # Upload and ingestion endpoints
│   │   │   ├── validations.js           # Validation and findings endpoints
│   │   │   ├── audit.js                 # Audit trail endpoints
│   │   │   ├── auth.js                  # Authentication endpoints
│   │   │   └── config.js               # Custom rules and typologies
│   │   ├── db/
│   │   │   ├── schema.sql               # PostgreSQL schema (8 tables)
│   │   │   ├── connection.js            # DB pool and query helpers
│   │   │   └── migrate.js               # Schema migration runner
│   │   ├── middleware/
│   │   │   ├── auth.js                  # JWT authentication + RBAC
│   │   │   └── errorHandler.js          # Centralised error handling
│   │   └── utils/
│   │       ├── ucpRules.js              # All 39 UCP 600 articles + field index
│   │       └── logger.js               # Winston logger
│   ├── Dockerfile
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx            # Review queue + stats
│   │   │   ├── UploadPage.tsx           # Document upload with drag-and-drop
│   │   │   ├── ReviewScreen.tsx         # Main checker review interface
│   │   │   └── AuditPage.tsx           # Audit trail timeline
│   │   ├── components/
│   │   │   ├── FindingCard.tsx          # Finding with verbatim evidence
│   │   │   ├── OverrideModal.tsx        # Checker override flow
│   │   │   ├── DiscrepancyReport.tsx    # Print-ready bank report
│   │   │   ├── DocumentCard.tsx         # Document extraction status
│   │   │   ├── ReviewQueue.tsx          # Queue table component
│   │   │   └── Navbar.tsx               # Top navigation
│   │   ├── api/client.ts               # Axios API client
│   │   ├── hooks/useAuth.ts            # Auth hook + JWT management
│   │   └── types/index.ts              # Full TypeScript domain types
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── docker-compose.yml
└── README.md
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 16+
- Redis 7+
- An [Anthropic API key](https://console.anthropic.com/)
- Docker + Docker Compose (for containerised setup)

### Option A — Docker Compose (Recommended)

```bash
# 1. Clone the repository
git clone https://github.com/sreekanth477/trade-document-intent-validation-engine.git
cd trade-document-intent-validation-engine

# 2. Configure the backend environment
cp backend/.env.example backend/.env
# Edit backend/.env and set:
#   ANTHROPIC_API_KEY=sk-ant-...
#   JWT_SECRET=<random 64-char string>

# 3. Start all services (PostgreSQL, Redis, backend, frontend)
docker-compose up -d

# 4. Open the app
# Frontend: http://localhost
# Backend API: http://localhost:3001
# Health check: http://localhost:3001/health
```

### Option B — Local Development

```bash
# --- Backend ---
cd backend
cp .env.example .env          # fill in ANTHROPIC_API_KEY and JWT_SECRET
npm install
npm run migrate               # creates all tables
npm run dev                   # starts on port 3001 (nodemon)

# --- Frontend (new terminal) ---
cd frontend
npm install
npm run dev                   # starts on port 5173
```

---

## Environment Variables

Copy `backend/.env.example` to `backend/.env` and set the following:

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude agents |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `JWT_SECRET` | Yes | Secret for signing JWTs (min 64 chars) |
| `PORT` | No | Backend port (default: 3001) |
| `UPLOAD_DIR` | No | Directory for uploaded documents |
| `USE_MOCK_LLM` | No | Set `true` to bypass Anthropic API for testing |
| `LOG_LEVEL` | No | `info` (default), `debug`, `error` |
| `CORS_ORIGIN` | No | Allowed frontend origin |

---

## API Endpoints

### Documents
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/documents/upload` | Upload up to 20 trade documents |
| `GET` | `/api/documents/:presentationId` | Get all documents for a presentation |
| `GET` | `/api/documents/:documentId/status` | Get extraction status |

### Validations
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/validations/:presentationId/start` | Trigger cross-document validation |
| `GET` | `/api/validations/:presentationId` | Get full validation result |
| `GET` | `/api/validations/:presentationId/findings` | Get findings list (filterable) |
| `POST` | `/api/validations/findings/:findingId/override` | Submit checker override |
| `GET` | `/api/validations/queue` | Get review queue ordered by risk score |

### Audit
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/audit/:presentationId` | Get audit trail |
| `GET` | `/api/audit/:presentationId/export` | Export audit trail as JSON |

### Configuration
| Method | Endpoint | Description |
|---|---|---|
| `GET/POST` | `/api/config/rules` | List / create custom validation rules |
| `PUT` | `/api/config/rules/:id` | Update a custom rule |
| `GET/POST` | `/api/config/typologies` | Manage fraud typology library |

---

## Validation Dimensions

The Intent Analysis Engine reasons across **six semantic dimensions** for every LC set:

| # | Dimension | What it checks |
|---|---|---|
| 1 | **Commercial Coherence** | Goods descriptions consistent across LC, Invoice, BL, Insurance; HS codes aligned; quantities and weights plausible |
| 2 | **Party & Entity Resolution** | Beneficiary = Invoice seller; Applicant = Invoice buyer; BL consignee and notify party match LC instructions; no jurisdictional anomalies |
| 3 | **Logistics Feasibility** | Trade route physically plausible; vessel type appropriate for cargo; transit time consistent with declared dates; port codes valid (UN/LOCODE) |
| 4 | **Coverage Alignment** | Insurance value ≥ 110% of invoice value (UCP Art. 28); perils covered match cargo type; effective date before BL on-board date |
| 5 | **Temporal Coherence** | Shipment within LC validity; BL date ≤ latest shipment date; insurance effective before shipment; presentation within LC expiry |
| 6 | **Trade Pattern Anomaly** | Statistically unusual commodity/route/counterparty/jurisdiction combinations; known TBML red flags |

---

## Risk Classification

| Severity | Colour | Meaning |
|---|---|---|
| **Critical** | Red | Potential fraud signal or clear UCP non-compliance — requires immediate human review |
| **Moderate** | Amber | Judgment call — plausible explanations exist but checker attention needed |
| **Informational** | Blue | Observation or minor note — unlikely to affect compliance |

**Always-Critical rules** (override classifier score):
- Beneficiary / applicant name mismatch
- Invoice amount exceeds LC amount
- BL dated after LC expiry
- Claused / unclean BL presented
- Insurance coverage below 110% of invoice value
- Missing required document

---

## User Roles

| Role | Access |
|---|---|
| `checker` | Upload documents, view assigned LC sets, accept/override/escalate findings |
| `supervisor` | All checker access + approve STP candidates, view full queue, assign cases |
| `compliance` | Read-only access to all LC sets, full audit trail export |
| `admin` | Full access including user management, custom rules, typology library |

---

## Database Schema

Eight PostgreSQL tables:

- **`lc_presentations`** — master record per LC set with status and risk score
- **`documents`** — individual uploaded files with extraction status and JSON output
- **`findings`** — validation findings with verbatim quotes, reasoning, and UCP citations
- **`overrides`** — immutable checker decisions (accept / override / escalate)
- **`audit_trail`** — append-only event log for every system and user action
- **`users`** — user accounts with RBAC roles
- **`custom_rules`** — versioned, no-code validation rules per corridor/commodity
- **`fraud_typologies`** — updatable fraud pattern library

---

## Performance Targets

| Metric | Target |
|---|---|
| End-to-end validation (4-doc LC set) | < 60 seconds (p95) |
| Concurrent LC sets | 50 without SLA degradation |
| Discrepancy detection rate | ≥ 95% on benchmark corpus |
| False positive rate | < 10% (checker override rate) |
| Extraction accuracy (digital PDF) | ≥ 92% |
| Extraction accuracy (scanned) | ≥ 85% |
| STP rate (clean LC sets) | 50–60% |
| System availability | 99.5% during banking hours |

---

## Security

- All documents encrypted at rest (AES-256) and in transit (TLS 1.3)
- JWT-based authentication with role-based access control
- Documents scoped to assigned checkers only — no cross-team visibility
- Immutable audit log for all user actions and system decisions
- `USE_MOCK_LLM=true` flag available for on-premise environments where documents must not leave the network
- `.env` excluded from version control via `.gitignore`

---

## Regulatory Basis

This engine implements the cross-document consistency requirement of **UCP 600 Article 14(d)**:

> *"Data in a document, when read in context with the credit, the document itself and international standard banking practice, need not be identical to, but must not conflict with, data in that document, any other stipulated document or the credit."*

The engine also incorporates FATF guidance on **Trade-Based Money Laundering (TBML)** red flags and ICC Banking Commission opinions on standard examination practice.

---

## Roadmap

| Phase | Status | Deliverables |
|---|---|---|
| Phase 0 — Discovery | Planned | UCP 600 rules mapping, benchmark corpus, architecture sign-off |
| Phase 1 — Foundation | **Built** | OCR pipeline, 4 document agents, extraction API |
| Phase 2 — Core Engine | **Built** | Intent Analysis Engine, risk classifier, basic review UI |
| Phase 3 — Pilot | Planned | Production hardening, audit trail, parallel operation pilot |
| Phase 4 — Scale | Planned | Multi-language (Arabic, Chinese, Spanish), custom rules UI, analytics dashboard |

---

## License

Proprietary — Trade Finance Technology. All rights reserved.

---

*Built with [Claude Code](https://claude.ai/claude-code) · Powered by [Claude claude-sonnet-4-6](https://www.anthropic.com/claude)*
