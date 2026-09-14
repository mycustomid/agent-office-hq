# Contractor AI PMO

This repository now contains a first-class PMO domain for wood contractors, custom furniture, cabinetry, and interior fit-out projects. The Iron Director remains the durable AI execution kernel; project state is stored separately so AI execution cannot silently become the source of truth for commercial/production status.

## Project lifecycle

The canonical flow is:

1. `INQUIRY`
2. `DISCOVERY`
3. `SITE_SURVEY`
4. `DESIGN_SCOPE`
5. `ESTIMATION`
6. `QUOTATION`
7. `CUSTOMER_APPROVAL`
8. `DP_PAYMENT`
9. `PROCUREMENT`
10. `FABRICATION`
11. `FINISHING_QC`
12. `INSTALLATION`
13. `HANDOVER`
14. `COMPLETED`

`ON_HOLD` and `CANCELLED` are explicit exception states.

Every new project receives a contractor checklist covering survey measurements, shop drawing/scope lock, BOQ/RAB, quotation, DP, material release, fabrication, finishing/QC, site readiness, installation, punch list, BAST, warranty documentation, and final payment.

## Fail-closed gates

The following transitions require persisted approval evidence:

- `CUSTOMER_APPROVAL -> DP_PAYMENT`: `CUSTOMER_SCOPE_APPROVED`
- `DP_PAYMENT -> PROCUREMENT`: `DP_VERIFIED`
- `PROCUREMENT -> FABRICATION`: `MATERIAL_RELEASED`
- `FINISHING_QC -> INSTALLATION`: `QC_RELEASE`
- `HANDOVER -> COMPLETED`: `HANDOVER_SIGNED` + `FINAL_PAYMENT_VERIFIED`

This prevents the dashboard or an AI agent from advancing high-risk work just because a model said it was done.

## WhatsApp gateway integration

The adapter is designed for the existing `customerservicecrm` gateway contract and supports the documented CRM-facing paths:

- `POST /api/v1/gateway/send-message`
- `GET /api/v1/gateway/conversation`
- inbound PMO aliases: `POST /webhook/incoming` and `POST /webhook/whatsapp`

Required environment variables:

```bash
WA_GATEWAY_BASE_URL=https://your-customer-service-backend.example.com
WA_GATEWAY_TENANT_KEY=change-me
WA_GATEWAY_WEBHOOK_SECRET=change-me-too
```

Optional compatibility variables:

```bash
WA_GATEWAY_API_TOKEN=
WA_GATEWAY_SEND_PATH=/api/v1/gateway/send-message
WA_GATEWAY_CONVERSATION_PATH=/api/v1/gateway/conversation
WA_GATEWAY_RECIPIENT_FIELD=to
WA_GATEWAY_MESSAGE_FIELD=message
WA_GATEWAY_TIMEOUT_MS=12000
```

The gateway must send `X-Webhook-Secret` to the PMO inbound webhook. Unknown individual WhatsApp senders are converted into `INQUIRY` projects with source `WHATSAPP`; subsequent messages are attached to the most recent active project for that phone number.

Group messages are intentionally ignored by the inbound parser.

## PMO API

Authenticated endpoints:

- `GET /api/pmo/overview`
- `GET|POST /api/pmo/projects`
- `GET /api/pmo/projects/:id`
- `POST /api/pmo/projects/:id/transition`
- `POST /api/pmo/projects/:id/risks`
- `POST /api/pmo/projects/:id/approvals`
- `POST /api/pmo/projects/:id/tasks/:taskId`
- `POST /api/pmo/projects/:id/whatsapp`
- `POST /api/pmo/projects/:id/ai-plan`
- `GET /api/pmo/approvals`
- `POST /api/pmo/approvals/:id/decision`

The AI plan endpoint uses Iron Director as a read-only PMO planner. It does not mutate project stage, approval, payment, procurement, QC, or completion state.

## Storage

The PMO vertical slice uses Node's built-in SQLite database at `data/pmo/pmo.db`, with WAL, FULL synchronous mode, busy timeout, foreign keys, activity events, project tasks, risks, approvals, and communications.

For a future multi-user/multi-company deployment, PostgreSQL should become the canonical PMO store while the Iron Director ledger remains the execution/governance subsystem.
