# ATK Deck V2 — Changelog

## v2.0.0 (2026-11-17)
- Initial clean-room architecture for ATK Deck V2 with 4 separated layers (Presentation, Domain, Storage, Portability).
- Provisioned dedicated Firebase project (`thin-math-p5xj8`), Firestore database (`ai-studio-82dadaa0-64b9-482f-8544-bf02b7b7b7f9`), Google Authentication, and private Storage rules.
- Implemented centralised light/dark design system (`src/index.css`) and shared UI component library.
- Implemented all 8 pages: Dashboard, Daily Journal, Daily / Session Records, Trades, Calendar, Analytics, Reviews, and Settings & Export.
- Implemented ATK-UTDS v1.0 export/import (ZIP with SHA-256 manifest + attachments, JSON, CSV, XLSX).
- Authored `firestore.rules`, `firebase-blueprint.json`, `security_spec.md`, `firestore.rules.test.ts`, and domain unit test suite.
