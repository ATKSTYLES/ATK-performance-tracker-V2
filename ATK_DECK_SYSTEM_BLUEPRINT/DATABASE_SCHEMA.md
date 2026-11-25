# ATK Deck V2 — Database Schema

Canonical intermediate representation is maintained in `/firebase-blueprint.json`.

## Root Structure
All user records reside exclusively under `/users/{uid}/...` with `schemaVersion: 2`.

## Subcollections (14)
1. `accounts/{accountId}` — Trading accounts (`TradingAccount`)
2. `daily_journals/{YYYY-MM-DD}` — One day-level record per date (`DailyJournal`)
3. `sessions/{sessionId}` — Trading sessions (`TradingSession`)
4. `session_events/{eventId}` — Session timeline events (`SessionEvent`)
5. `trades/{tradeId}` — Independent trade records (`Trade`)
6. `trade_events/{eventId}` — Trade management and closure events (`TradeEvent`)
7. `trade_groups/{groupId}` — Multi-account trade groupings (`TradeGroup`)
8. `attachments/{attachmentId}` — Private screenshot metadata (`AttachmentMeta`)
9. `session_templates/{templateId}` — Half-open `[start, end)` session windows (`SessionTemplate`)
10. `checklists/{checklistId}` — Independent `daily` and `session` checklist defaults (`ChecklistConfig`)
11. `instruments/{instrumentId}` — Tracked symbols (`InstrumentConfig`)
12. `preferences/default` — Profile, timezone, currency, theme, logger config (`UserProfilePreferences`)
13. `reviews/{reviewId}` — Daily, weekly, monthly, strategy reviews (`TradingReview`)
14. `audit_logs/{logId}` — Error diagnostics audit trail (`AuditLogEntry`)

## Composite Indexes (`/firestore.indexes.json`)
- `sessions`: `(date DESC, createdAt DESC)`
- `session_events`: `(sessionId ASC, timestamp ASC)`
- `trades`: `(date DESC, createdAt DESC)` and `(sessionId ASC, createdAt ASC)`
- `trade_events`: `(tradeId ASC, timestamp ASC)`
- `reviews`: `(reviewType ASC, date DESC)`
