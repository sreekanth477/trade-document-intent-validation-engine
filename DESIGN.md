# Design Document — Trade Document Intent Validation Engine

> This document explains the architectural decisions, design methodology, patterns, and engineering rationale behind the solution. It is intended for developers, architects, and technical stakeholders joining the project.

---

## Table of Contents

1. [Problem Framing](#1-problem-framing)
2. [Design Philosophy](#2-design-philosophy)
3. [Architecture Decision Records](#3-architecture-decision-records)
4. [Multi-Agent Design](#4-multi-agent-design)
5. [Data Model Design](#5-data-model-design)
6. [AI Safety and Hallucination Prevention](#6-ai-safety-and-hallucination-prevention)
7. [UCP 600 Compliance Strategy](#7-ucp-600-compliance-strategy)
8. [Risk Classification Design](#8-risk-classification-design)
9. [Frontend UX Design Principles](#9-frontend-ux-design-principles)
10. [Security Architecture](#10-security-architecture)
11. [Queue and Concurrency Design](#11-queue-and-concurrency-design)
12. [Audit Trail Design](#12-audit-trail-design)
13. [Phased Delivery Plan](#13-phased-delivery-plan)
14. [Key Design Trade-offs](#14-key-design-trade-offs)
15. [Future Architecture Evolution](#15-future-architecture-evolution)

---

## 1. Problem Framing

### The Core Insight: Syntax vs. Semantics

Traditional LC document checking systems are **syntactic** — they compare individual field values in isolation:
- Does the LC amount match the invoice amount?
- Does the port of loading match across documents?

This engine is **semantic** — it asks whether the **commercial story** told by all four documents together makes sense:
- Is the declared cargo physically consistent with the vessel type and route?
- Does the insurance coverage match what is actually being shipped?
- Are the party names truly the same entity despite minor name variations?
- Does the timeline of dates form a coherent, compliant sequence?

This distinction drives every design decision in the system.

### Why Multi-Agent?

A single monolithic prompt given all four documents would:
- Exceed context window limits for large document sets
- Mix extraction concerns with reasoning concerns
- Produce less accurate extractions (models perform better with focused tasks)
- Make debugging and iteration difficult (which part failed?)

The multi-agent approach separates **extraction** (what does each document say?) from **reasoning** (are the documents consistent with each other?). Each agent is a specialist. The Intent Analysis Engine is the generalist that synthesises specialist outputs.

---

## 2. Design Philosophy

The solution is built on five design principles that are applied consistently across every layer:

### Principle 1 — Evidence Before Conclusion
No finding can be raised without verbatim evidence from the source documents. This is enforced at the prompt level (the model is instructed to refuse to create findings without citing exact text) and validated at the application layer (findings without verbatim quotes are rejected). This prevents hallucination from reaching checkers.

### Principle 2 — Human Judgment is Preserved
The engine is a **decision-support tool**, not a decision-maker. Every finding can be overridden by a checker. STP (straight-through processing) only applies to clean sets with no Critical or Moderate findings, and even then requires supervisor approval. The system surfaces better information; humans make the call.

### Principle 3 — Auditability is First-Class
Every action — system or human — is logged to an immutable audit trail at the moment it occurs. The audit trail is not an afterthought; it is written first in the pipeline before findings are persisted, ensuring regulatory defensibility even if downstream steps fail.

### Principle 4 — Fail Safe, Never Silent
If the AI validation layer is unavailable, documents are queued and routed to human review with a `system-unavailable` flag. They are never silently dropped or auto-approved. This is enforced in the Bull queue with dead-letter handling and in the Express error handler.

### Principle 5 — Separation of Extraction and Reasoning
Document agents only extract structured data. They do not reason about consistency or raise findings. The Intent Analysis Engine only reasons — it does not re-extract data. This separation makes each component testable in isolation and makes the full pipeline debuggable field by field.

---

## 3. Architecture Decision Records

### ADR-001: Multi-Agent over Single-Prompt
**Decision:** Use separate AI agents per document type, feeding a central reasoning engine.
**Rationale:** Focused extraction prompts achieve higher accuracy than combined prompts. Extraction failures are isolated to one agent and do not cascade. Each agent can be independently tested against its document type corpus.
**Alternative considered:** Single prompt with all four documents. Rejected due to context window pressure and poor separation of concerns.

### ADR-002: Claude claude-sonnet-4-6 for All Agents
**Decision:** Use `claude-sonnet-4-6` for all extraction and reasoning agents.
**Rationale:** Strong semantic understanding of trade finance terminology. Context-length headroom for long LC documents with special conditions. Reliable instruction-following for verbatim citation enforcement.
**Alternative considered:** Smaller / faster models for extraction, reserving Sonnet for reasoning only. Rejected because extraction accuracy requirements (≥92%) require the same model quality throughout.

### ADR-003: Rule-Based Risk Classifier (not ML)
**Decision:** Implement the risk classifier as a rule engine with heuristic scoring, not a trained ML model.
**Rationale:** A trained ML classifier requires an annotated corpus of 200+ LC sets which does not exist at project start. The rule engine is transparent, auditable, and immediately explainable to checkers and compliance. It can be evolved into an ML model once sufficient override data accumulates.
**Alternative considered:** Fine-tuned classification model. Deferred to Phase 4 once the override feedback pipeline produces enough training data.

### ADR-004: Bull + Redis for the Processing Queue
**Decision:** Use Bull (built on Redis) as the async job queue.
**Rationale:** Bull provides per-job progress events, retry logic with backoff, dead-letter queues, and a battle-tested API for Node.js. Redis persistence ensures jobs survive server restarts.
**Alternative considered:** AWS SQS or RabbitMQ. Rejected to avoid external service dependencies for the on-premise deployment scenario.

### ADR-005: PostgreSQL for All Persistent State
**Decision:** Use PostgreSQL for findings, audit trail, users, and configuration.
**Rationale:** The audit trail is append-only and immutable — PostgreSQL's ACID guarantees and row-level locking make this reliable. JSONB columns handle the semi-structured `extracted_data` and `event_data` without a separate document store.
**Alternative considered:** MongoDB for flexible document storage + PostgreSQL for audit. Rejected — two databases increase operational complexity for minimal gain since JSONB covers the flexibility requirement.

### ADR-006: Verbatim Citation Enforcement in System Prompt
**Decision:** Instruct the model in the system prompt to cite exact source text for every finding, and treat any finding without a citation as invalid.
**Rationale:** This is the primary hallucination control. The model cannot fabricate a finding if it must also fabricate the supporting text — the fabricated text would contradict the actual document content and be detectable. Application-layer validation (rejecting citations not found in the source text) adds a second control layer.
**Alternative considered:** Post-hoc grounding check using a separate model. Retained as a future enhancement but not blocking for Phase 1.

---

## 4. Multi-Agent Design

### Agent Pipeline Flow

```
Document Upload (PDF / TIFF / JPEG)
          │
          ▼
  ┌───────────────┐
  │  OCR / Parser │  ← pdf-parse for digital PDFs
  │               │    AWS Textract / Azure Form Recognizer for scanned
  └───────┬───────┘
          │ Raw text + confidence score
          ▼
  ┌───────────────┐
  │   Document    │  ← Classifies: lc | invoice | bl | insurance | other
  │   Classifier  │
  └───────┬───────┘
          │
    ┌─────┴──────┬──────────────┬──────────────┐
    ▼            ▼              ▼               ▼
 LC Agent   Invoice Agent   BL Agent    Insurance Agent
    │            │              │               │
    └─────┬──────┴──────────────┴───────────────┘
          │ Structured JSON (4 extraction outputs)
          ▼
  ┌──────────────────────┐
  │  Intent Analysis     │  ← 6-dimension cross-document reasoning
  │  Engine              │    Chain-of-thought before findings
  └──────────┬───────────┘
             │ Raw findings list
             ▼
  ┌──────────────────────┐
  │  Risk Classifier     │  ← Assigns Critical / Moderate / Informational
  └──────────┬───────────┘    Computes overall risk score (0–100)
             │
             ▼
  ┌──────────────────────┐
  │  PostgreSQL           │  ← Persist findings, update presentation status
  │  Audit Trail          │    Emit audit events
  └──────────────────────┘
```

### Agent Contract (Extraction Schema)

Every document agent adheres to the same output contract. Each extracted field is an object with four properties:

```json
{
  "fieldName": {
    "value": "the extracted value",
    "verbatimSource": "exact text copied from the document",
    "confidence": 0.97,
    "ucpArticle": "Art. 18(a)"
  }
}
```

- **`value`** — normalised, usable value (date in ISO format, amount as number, etc.)
- **`verbatimSource`** — exact text as it appears in the document (not reformatted)
- **`confidence`** — 0–1 score reflecting extraction certainty
- **`ucpArticle`** — the UCP 600 article that governs this field

If a required field is absent from the document, the agent returns `"value": "NOT_FOUND"` — it never infers or substitutes a value.

### Intent Analysis Engine — Chain-of-Thought Design

The Intent Analysis Engine uses a two-phase output strategy:

**Phase 1 — Reasoning (not shown to end users)**
The model works through each of the 6 dimensions explicitly, writing `DIMENSION [N] ANALYSIS:` followed by step-by-step reasoning. This chain-of-thought improves accuracy and produces the narrative that populates the audit trail.

**Phase 2 — Structured Findings (parsed by application)**
After completing all 6 dimension analyses, the model outputs a sentinel-delimited JSON block:
```
===FINDINGS_JSON_START===
[ { finding objects } ]
===FINDINGS_JSON_END===
```

The application layer parses only the findings block. The reasoning text is stored separately for audit purposes. This sentinel approach is more robust than asking the model to output pure JSON (which is prone to markdown wrapping and truncation errors).

---

## 5. Data Model Design

### Entity Relationship Summary

```
users
  │
  ├── creates → lc_presentations
  │                │
  │                ├── has many → documents
  │                │                └── extraction_status, extracted_data (JSONB)
  │                │
  │                ├── has many → findings
  │                │                └── verbatim_quotes (JSONB), ucp_articles[]
  │                │
  │                ├── has many → audit_trail (append-only)
  │                │
  │                └── findings have many → overrides (checker decisions)
  │
  ├── creates → custom_rules (scoped to corridor / commodity)
  └── creates → fraud_typologies
```

### Key Design Decisions in the Schema

**JSONB for semi-structured data:** `extracted_data` on documents and `event_data` on audit_trail use PostgreSQL JSONB. This avoids schema migrations every time a new document field is added while retaining full query capability with GIN indexes.

**Enum types for status fields:** PostgreSQL native enums (`presentation_status`, `document_type`, `finding_severity`, etc.) enforce data integrity at the database level, not just the application level.

**Append-only audit trail:** The `audit_trail` table has no UPDATE or DELETE grants for the application user. The application service layer enforces append-only writes. A database-level trigger fires on any DELETE attempt and raises an exception.

**Versioned custom rules:** The `custom_rules` table includes a `version` integer column. Every update creates a new row (new version) rather than overwriting the existing row. This means the exact rule configuration applied to any historical LC set can always be reconstructed.

---

## 6. AI Safety and Hallucination Prevention

This is the highest-risk area of the system. Three controls are layered:

### Control 1 — Prompt-Level Citation Mandate
The system prompt for every agent and the Intent Analysis Engine contains an explicit, bolded instruction:

> *"You MUST cite verbatim source text for every claim. A finding with no verbatim evidence is strictly forbidden. If you cannot cite exact source text, do not raise a finding."*

This is reinforced with examples showing correctly and incorrectly formed outputs.

### Control 2 — Application-Level Validation
After every AI response, the application layer validates:
- Every finding has a non-empty `verbatimQuotes` array
- Each quote's `text` field is a substring of the original extracted document text (fuzzy match with 85% threshold to allow minor OCR variations)
- Findings that fail this check are flagged as `requires_manual_review` and escalated, never surfaced as AI-confirmed findings

### Control 3 — NOT_FOUND Protocol
Agents are explicitly instructed to output `"NOT_FOUND"` for any required field not present in the document. They are forbidden from inferring, estimating, or substituting a value. This prevents the model from making up field values that then propagate as "evidence" into the reasoning layer.

### Control 4 — Confidence Thresholding
Findings with confidence score below 50 are not surfaced unless their severity is Critical. Low-confidence non-critical findings are stored but filtered from the default view. Checkers can optionally reveal them.

---

## 7. UCP 600 Compliance Strategy

### Rules Mapping Architecture

All 39 UCP 600 articles are compiled into a machine-readable rules map in `backend/src/utils/ucpRules.js`. Each article entry contains:
- Article number and short title
- Full description of the rule
- Applicable document types
- Field types the article governs
- Related articles (for cross-reference)

A two-dimensional index (`FIELD_TO_ARTICLE_INDEX`) maps `documentType → fieldName → ucpArticle`, enabling the extraction agents to automatically tag each field with its governing article without the LLM needing to reason about this.

### Article 14(d) — The Legal Basis

UCP 600 Article 14(d) is the legal foundation of the entire product:

> *"Data in a document... must not conflict with data in that document, any other stipulated document or the credit."*

The Intent Analysis Engine's 6 validation dimensions are all expressions of this single article requirement, decomposed into specific, testable sub-checks. Every cross-document finding is ultimately a citation of Article 14(d) plus the more specific article governing the relevant field.

### Handling UCP Subjectivity

Some UCP 600 determinations are genuinely interpretive (e.g., what constitutes an "inconsistency" under Art. 14(d) in edge cases). The design handles this by:
1. Classifying such findings as `moderate` rather than `critical`
2. Including `"recommendedAction": "Human judgment required — refer to ICC Banking Commission opinions"` in the finding
3. Storing links to relevant ICC Banking Commission opinions in the vector store (Phase 4) for checker reference

---

## 8. Risk Classification Design

### Three-Tier Severity Model

| Tier | Colour | Trigger Condition | Action |
|---|---|---|---|
| **Critical** | Red | Clear UCP non-compliance, fraud signal, or always-Critical rule match | Mandatory human review; cannot be STP |
| **Moderate** | Amber | Discrepancy requiring judgment; plausible alternative explanation exists | Human review recommended; checker must explicitly accept |
| **Informational** | Blue | Observation, borderline item, or low-confidence signal | Shown to checker; does not block STP |

### Always-Critical Rule Overrides

Certain finding types are always Critical regardless of the classifier's confidence score. These are hardcoded in `riskClassifier.js`:

| Finding Type | UCP Basis |
|---|---|
| Beneficiary name mismatch | Art. 14(d), Art. 18(a) |
| Invoice amount exceeds LC amount | Art. 18(b) |
| BL dated after LC expiry | Art. 14(c) |
| BL dated after latest shipment date | Art. 20(a)(ii) |
| Unclean / claused BL | Art. 27 |
| Insurance value below 110% of invoice | Art. 28(f)(ii) |
| Missing required document | Art. 14(a) |
| Applicant name mismatch on invoice | Art. 18(a) |

### Overall Risk Score (0–100)

The overall risk score for a presentation is computed as a weighted aggregate:

```
score = (critical_count × 40) + (moderate_count × 15) + (informational_count × 3)
score = min(score, 100)  # capped at 100
```

**STP Candidate Criteria:**
- Zero Critical findings
- Zero Moderate findings
- Overall score ≤ 15
- All four required documents present and extracted with confidence ≥ 0.85

STP candidates are routed to a supervisor approval step — they are never auto-approved without human sign-off.

---

## 9. Frontend UX Design Principles

### Design for the Checker's Mental Model

The review interface is designed around how an experienced checker actually works:
1. **Triage first** — dashboard shows risk score and finding counts before opening a case
2. **Evidence before judgment** — the finding card shows verbatim quotes before asking for a decision
3. **Act inline** — accept/override/escalate without leaving the finding context
4. **Verify at source** — side-by-side document view lets checkers confirm AI findings against originals

### Information Hierarchy

Each finding card presents information in this deliberate order:
1. Severity (most important — checker decides whether to engage)
2. Title (what is the issue?)
3. UCP article tags (regulatory basis)
4. Affected documents and fields (scope)
5. Verbatim evidence (proof)
6. Reasoning (why the engine flagged it)
7. Recommended action (what to do)
8. Action buttons (accept / override / escalate)

This ordering ensures checkers are not asked to act before they have context.

### Override Flow Design

The override modal is deliberately friction-adding (not obstructive). Checkers must:
1. Select a reason from a controlled vocabulary (enables analysis of override patterns)
2. Write a free-text justification (minimum 20 characters — prevents one-word responses)
3. Confirm the action

This friction is intentional: overrides feed the retraining pipeline and are regulatory artefacts. They must be meaningful.

### Polling Strategy

When a presentation is in `processing` status, the ReviewScreen polls the API every 3 seconds. On completion, polling stops and the page updates. This avoids WebSocket complexity for the pilot phase while providing near-real-time feedback within the 60-second SLA.

---

## 10. Security Architecture

### Threat Model

The primary threats for a trade finance document system are:
1. **Data exfiltration** — trade documents contain commercially sensitive counterparty and financial data
2. **Unauthorised access** — checkers must only see their assigned LC sets
3. **Audit tampering** — regulatory artefacts must be immutable
4. **AI manipulation** — adversarial documents designed to confuse the extraction agents

### Controls

| Threat | Control |
|---|---|
| Data exfiltration | On-premise / private cloud deployment; `USE_MOCK_LLM=true` for air-gapped environments; TLS 1.3 in transit; AES-256 at rest |
| Unauthorised access | JWT authentication; RBAC at route and DB level; documents scoped to assigned users only |
| Audit tampering | Append-only DB grants; trigger on DELETE; export signed with server key |
| AI manipulation | Verbatim citation requirement; confidence thresholds; OCR confidence gates |
| Credential leakage | `.env` excluded from git; token stored in memory (not localStorage) in production builds |

### JWT Design

- Tokens expire after 8 hours (configurable via `JWT_EXPIRY`)
- Tokens contain: `userId`, `email`, `role`, `iat`, `exp`
- Role is read from the token at request time; a separate DB lookup is only made for sensitive operations (admin actions, export)
- Tokens are not stored server-side — stateless design simplifies horizontal scaling

---

## 11. Queue and Concurrency Design

### Two-Queue Architecture

```
document-extraction queue          intent-analysis queue
─────────────────────────          ─────────────────────
Job: extract(documentId)      →    Job: analyze(presentationId)
  └─ runs LC/Invoice/BL/             └─ runs when ALL 4 docs
     Insurance agent                    are extracted
  └─ updates document status         └─ runs Risk Classifier
  └─ checks: all docs done?           └─ persists findings
     yes → enqueue analysis           └─ updates presentation
```

### Triggering Intent Analysis

The `_checkAndTriggerAnalysis()` function in `queueService.js` is called after every document extraction completes. It queries the DB to check whether all required document types for the presentation have `extraction_status = 'completed'`. Only when all four required types are present does it enqueue the intent analysis job.

This avoids race conditions that would occur if each agent independently tried to trigger analysis after completion.

### Concurrency Limits

```javascript
// document-extraction: up to 10 parallel workers
// intent-analysis: up to 5 parallel workers (heavier, longer-running)
// Retry: 3 attempts with exponential backoff (2s, 4s, 8s)
// Job timeout: 120s for extraction, 90s for analysis
```

The concurrency limits are tuned to stay within the 60-second SLA at 50 concurrent LC sets (50 sets × 4 docs = 200 extraction jobs; at 10 parallel workers = ~20 batches × ~3s per doc = ~60s).

---

## 12. Audit Trail Design

### Event Taxonomy

The audit trail captures 10 event types in a strict sequence:

```
SUBMISSION_RECEIVED          ← document batch uploaded
EXTRACTION_STARTED           ← agent begins processing a document
EXTRACTION_COMPLETED         ← agent returns structured JSON
EXTRACTION_FAILED            ← agent error (stored with error detail)
ANALYSIS_STARTED             ← Intent Analysis Engine begins
ANALYSIS_COMPLETED           ← findings list produced
FINDING_CREATED              ← each finding persisted (one event per finding)
CHECKER_ACTION               ← checker accepts/overrides/escalates
SUPERVISOR_APPROVED          ← supervisor approves STP or escalation
FINAL_DISPOSITION            ← presentation closed (complying / non-complying)
```

### Regulatory Requirements Met

| Requirement | Implementation |
|---|---|
| 7-year retention | `locked_until` timestamp set on submission; archive to cold storage after 2 years |
| Complete evidence chain | Every agent input and output stored in `event_data` JSONB |
| User attribution | Every event stores `user_id` and `user_name` from JWT |
| Tamper evidence | Append-only grants; no UPDATE/DELETE on `audit_trail` table |
| Exportable | JSON export endpoint; structured format suitable for regulatory response |

---

## 13. Phased Delivery Plan

The build is structured in four phases matching the PRD roadmap, with clear go/no-go gates between phases.

### Phase 0 — Discovery (Weeks 1–4)
**Goal:** Validate feasibility; establish quality baseline.

| Step | Activity | Output | Gate |
|---|---|---|---|
| 1 | UCP 600 rules mapping | Machine-readable rules map (39 articles) | LC examiner sign-off |
| 2 | Benchmark corpus creation | 200 annotated LC sets | ≥85% inter-annotator agreement |
| 3 | Architecture design | System + data flow + security diagrams | CTO + Compliance sign-off |

### Phase 1 — Document Agents (Weeks 5–10)
**Goal:** Reliable structured extraction from all four document types.

| Step | Activity | Output | Gate |
|---|---|---|---|
| 4 | OCR + ingestion pipeline | Batch upload API; confidence scoring | OCR ≥85% on scanned docs |
| 5 | LC Agent | Extraction API; UCP article tagging | ≥92% field accuracy on corpus |
| 6 | Invoice, BL, Insurance Agents | Three extraction APIs | ≥92% field accuracy each |

### Phase 2 — Intent Analysis Engine (Weeks 11–18)
**Goal:** Cross-document semantic validation at production quality.

| Step | Activity | Output | Gate |
|---|---|---|---|
| 7 | Goods ontology + entity resolution | HS code mapper; party name resolver | Validated on 50 test sets |
| 8 | Intent Analysis Engine | 6-dimension reasoning; structured findings | ≥88% detection, <20% false positive |
| 9 | Risk Classifier | Critical/Moderate/Info scoring | ≥90% agreement with expert annotators |

### Phase 3 — Review UI and Pilot (Weeks 19–24)
**Goal:** Production-ready UI; validated with real checkers.

| Step | Activity | Output | Gate |
|---|---|---|---|
| 10 | Review UI | Discrepancy report; override flow | Usability test ≥4/5 |
| 11 | Audit trail + export | Regulatory-grade audit export | Compliance sign-off |
| 12 | Pilot deployment | 2-week parallel operation | Checker satisfaction ≥4/5; STP ≥40% |

### Phase 4 — Scale (Weeks 25–32)
**Goal:** Full production; multi-language; custom rules; analytics.

| Step | Activity | Output | Gate |
|---|---|---|---|
| 13 | Multi-language support | Arabic, Chinese, Spanish extraction | ≥90% accuracy per language |
| 14 | Custom rule configuration | No-code rule builder UI | Ops head sign-off |
| 15 | Retraining pipeline + dashboard | 90-day cadence; analytics dashboard | STP ≥50%; time reduction ≥60% |

---

## 14. Key Design Trade-offs

### Trade-off 1: Accuracy vs. Speed
**Tension:** Using `claude-sonnet-4-6` for all agents maximises accuracy but adds latency. A cheaper/faster model would reduce cost and latency.
**Decision:** Accuracy first for the pilot phase. Cost optimisation (routing simpler extractions to a faster model) is deferred to Phase 4 once the benchmark corpus establishes per-document-type accuracy baselines.

### Trade-off 2: Verbatim Citations vs. Naturalness
**Tension:** Requiring verbatim source text for every finding means some findings read awkwardly (the source text may be poorly formatted OCR output). Paraphrasing would be clearer but risks hallucination.
**Decision:** Verbatim citations always. Checkers are trained to interpret OCR artefacts. Trust is more important than readability.

### Trade-off 3: Rule-Based vs. ML Classifier
**Tension:** A trained ML classifier would generalise better than rule-based scoring. But it requires training data (annotated overrides) that does not exist at project start.
**Decision:** Rule-based for Phase 1–3. ML classifier introduced in Phase 4 when the override feedback pipeline has accumulated sufficient training data (target: 1,000+ annotated overrides).

### Trade-off 4: STP Automation vs. Human Sign-off
**Tension:** Full automation of clean LC sets would maximise throughput. Requiring supervisor approval for STP candidates adds a step.
**Decision:** Supervisor approval required for all STP candidates in Phase 3 pilot. This builds trust in the system and provides a safety net. Fully automated STP (with supervisor notification only) can be enabled in Phase 4 once the false positive rate is confirmed below 5%.

### Trade-off 5: Polling vs. WebSockets
**Tension:** Polling every 3 seconds is simple but creates unnecessary API load. WebSockets would provide true real-time updates.
**Decision:** Polling for Phase 3 pilot. WebSocket upgrade planned for Phase 4 when concurrent user load increases. The 3-second interval is acceptable given the 60-second SLA.

---

## 15. Future Architecture Evolution

### Phase 4+ Enhancements

| Enhancement | Rationale | Complexity |
|---|---|---|
| **Vector store (pgvector / Pinecone)** | Semantic search over ICC opinions and historical cases for finding enrichment | Medium |
| **ML risk classifier** | Replace rule engine with fine-tuned model trained on accumulated overrides | High |
| **WebSocket real-time updates** | Replace polling with push notifications for validation progress | Medium |
| **SWIFT MT700/MT799 integration** | Auto-populate LC fields from SWIFT messages, eliminating manual data entry | High |
| **Vessel registry API** | Real-time vessel validation against maritime databases (AIS data) | Medium |
| **Multi-language OCR** | Arabic, Chinese, Spanish document extraction | Medium |
| **Automated STP** | Remove supervisor approval step for presentations meeting strict STP criteria | Low |
| **Model fine-tuning** | Domain-adapted model trained on trade finance corpus for improved extraction | High |
| **Fraud typology ML matching** | Replace exact pattern matching with embedding-based similarity for typology detection | High |

### Scaling Strategy

The system is designed to scale horizontally at every stateful layer:
- **Backend:** Stateless Express instances behind a load balancer
- **Queue workers:** Bull workers are stateless; add worker instances to increase throughput
- **Database:** Read replicas for reporting queries; connection pooling via PgBouncer at scale
- **Redis:** Redis Cluster for queue HA; Sentinel for automatic failover

For the pilot (50 concurrent LC sets), a single backend instance with 10 extraction workers and 5 analysis workers is sufficient. For 500+ concurrent sets, horizontal scaling of all three tiers is required.

---

## Document History

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | April 2026 | Engineering Team | Initial design document |

---

*This document should be updated at each phase gate to reflect decisions made during implementation and any architecture changes driven by pilot findings.*
