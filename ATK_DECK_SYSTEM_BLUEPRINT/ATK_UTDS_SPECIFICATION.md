# ATK Universal Trading Data Standard (ATK-UTDS v1.0)

## Purpose
Provides a self-contained, portable, vendor-independent backup archive (`ATK_Trading_Backup.zip`) preserving all records, relationships, timezone metadata, original creation timestamps, and binary attachments.

## Archive Layout
- `manifest.json`
- `profile.json`
- `accounts.json`
- `daily_journals.json`
- `sessions.json`
- `session_events.json`
- `trades.json`
- `trade_events.json`
- `trade_groups.json`
- `reviews.json`
- `settings.json`
- `templates.json`
- `instruments.json`
- `checklists.json`
- `attachments_index.json`
- `attachments/` (binary image files named `<attachmentId>_<fileName>`)

## Manifest Schema
- `formatName`: `"ATK-UTDS"`
- `formatVersion`: `"1.0"`
- `exportTimestamp`: ISO-8601 timestamp
- `sourceApplication`: `"ATK Deck"`
- `sourceVersion`: `"2.0.0"`
- `exportScope`: `"full_workspace"` | `"json_export"`
- `recordCounts`: map of entity counts
- `attachmentCount`: number
- `checksumSha256`: SHA-256 hex digest over canonical payload JSON
