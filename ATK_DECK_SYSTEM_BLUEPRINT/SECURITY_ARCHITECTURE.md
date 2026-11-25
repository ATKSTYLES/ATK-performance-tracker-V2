# ATK Deck V2 — Security Architecture

## Authentication & Isolation
- Private Google Sign-In via Firebase Authentication (`signInWithPopup`).
- Security rules mandate `request.auth != null && request.auth.token.email_verified == true && request.auth.uid == userId`.
- Default-deny catch-all at root of `firestore.rules` and `storage.rules`.

## Eight Pillars Enforcement
1. **Default-Deny & Owner Gate**: Every subcollection checks `isOwner(userId)` and `resource.data.userId == request.auth.uid` on `list`.
2. **Validation Blueprints**: Dedicated `isValid[Entity]()` functions validate `keys().hasAll(...)` and `keys().hasOnly(...)`, types, max string sizes, and canonical enum allowlists.
3. **Path Variable Hardening**: `isValidId()` restricts document IDs to `^[a-zA-Z0-9_-]+$` up to 128 chars.
4. **Action-Based Updates**: Every `allow update` branches by lifecycle action using `affectedKeys().hasOnly(...)`.
5. **Array Guarding**: All arrays enforce `.size() <= MAX` and index-0 element type checks.
6. **Immutable Fields & Server Timestamps**: `id`, `userId`, `createdAt` cannot change; `createdAt`/`updatedAt` must equal `request.time`.
7. **Relational Integrity**: `session_events` and `trade_events` verify parent existence via `exists()` / `existsAfter()`.
8. **Terminal State Locking**: Closed trades lock outcome, status, and financial fields; completed sessions cannot reopen.

## Storage Security (`storage.rules`)
Binary screenshots reside at `/users/{userId}/attachments/{attachmentId}/{fileName}`, limited to verified owners, `image/*` content types, and 10MB max per object.
