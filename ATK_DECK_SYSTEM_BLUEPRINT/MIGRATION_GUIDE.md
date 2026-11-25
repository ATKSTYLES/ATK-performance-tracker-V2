# ATK Deck V2 — Schema Migration Guide

## Schema Versioning
Every document carries an integer `schemaVersion` (currently `2`).

## Migration Rules
1. Never silently drop unrecognised historical fields during updates.
2. Never weaken `firestore.rules` to bypass validation errors.
3. When introducing `schemaVersion: N+1`:
   - Update `/firebase-blueprint.json` and `/ATK_DECK_SYSTEM_BLUEPRINT/DATA_DICTIONARY.md` first.
   - Add an explicit deterministic upgrader function in `/src/domain/validation.ts` transforming `schemaVersion < N+1` records before committing updates.
   - Update `firestore.rules`, run `npx eslint firestore.rules`, and execute `firestore.rules.test.ts` against the Firebase Local Emulator Suite prior to deployment.
4. Original creation timestamps from imported backups are preserved in `originalCreatedAt` while Firestore server timestamps (`createdAt`, `updatedAt`) maintain write-time integrity.
