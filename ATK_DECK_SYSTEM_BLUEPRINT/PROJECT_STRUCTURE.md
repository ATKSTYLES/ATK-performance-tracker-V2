# ATK Deck V2 — Project Structure

```
/
├── ATK_DECK_SYSTEM_BLUEPRINT/     # Permanent architectural & specification docs
├── firebase-blueprint.json        # Canonical Firestore entity & path blueprint
├── firestore.rules                # Production-hardened Eight-Pillar Firestore rules
├── firestore.indexes.json         # Composite Firestore indexes
├── storage.rules                  # Private attachment storage rules
├── firebase.json                  # Firebase & emulator configuration
├── firestore.rules.test.ts        # Rules unit testing suite
├── security_spec.md               # Phase 0 security invariants & Dirty Dozen
├── eslint.config.js               # ESLint with @firebase/eslint-plugin-security-rules
└── src/
    ├── domain/                    # Layer 2: Types, Enums, Calculations, Validation, Timezone, Errors
    ├── storage/                   # Layer 3: Firebase init, Repository, Sync Queue
    ├── portability/               # Layer 4: ATK-UTDS v1.0 ZIP/JSON/CSV/XLSX export & import
    ├── context/                   # Auth & real-time Workspace state
    ├── components/                # Layer 1: Shared UI library, Layout, Charts, Trade Modals/Drawers
    ├── pages/                     # Layer 1: All 8 workspace pages
    ├── App.tsx                    # Root shell & navigation router
    └── index.css                  # Centralised light/dark CSS tokens & typography
```
