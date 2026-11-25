# ATK Deck V2 — Deployment Guide

## Architecture Separation
The Vite React frontend and Firebase backend (`firebase-applet-config.json`) remain strictly decoupled. Rebuilding or redeploying the frontend never erases or seeds over existing Firestore records.

## Pre-Deployment Checklist
1. Verify `firebase-applet-config.json` targets the dedicated `thin-math-p5xj8` project and `ai-studio-82dadaa0-64b9-482f-8544-bf02b7b7b7f9` Firestore database.
2. Lint security rules: `npx eslint firestore.rules`.
3. Run emulator rule tests (in an environment with JRE installed): `firebase emulators:exec --only firestore "npx vitest run firestore.rules.test.ts"`.
4. Deploy `firestore.rules`, `firestore.indexes.json`, and `storage.rules`.
5. Verify Google Sign-In authorized domains in Firebase Authentication Console.
6. Build production frontend bundle: `npm run build`.
7. Verify backup export (`ATK_Trading_Backup.zip`) and restore dry-run.
