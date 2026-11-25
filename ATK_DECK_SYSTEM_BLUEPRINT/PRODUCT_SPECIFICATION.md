# ATK Deck V2 — Product Specification

## Purpose
ATK Deck V2 is a private personal trading journal and trading workspace for discretionary traders. It records the complete decision-making lifecycle across daily preparation, trading sessions, live trade execution, post-trade review, and behavioural analytics.

## Core Entities
1. **DailyJournal**: One day-level preparation, checklist, emotional state, discipline rating, and reflection record per user and date.
2. **TradingSession**: Independent session lifecycle (`planned`, `live`, `completed`, `missed`, `cancelled`) with pre-session check-in, quick-events (`session_events`), and closing reflection.
3. **Trade**: Independent trade decision record (`before_entry`, `during_trade`, `closed`), either linked to a session (`sessionId`) or explicitly `Out-of-Session` (`isOutOfSession: true`).

## Lifecycle Guarantees
- Ending a session never closes open trades.
- Open trades remain closable after their parent session has completed.
- Closing a trade never reopens its parent session.
- `session_events` and `trade_events` remain strictly separated.
- Multi-account execution groups account-specific trades via `tradeGroupId` without mixing returns across currencies.

## Navigation (8 Pages)
1. Dashboard
2. Daily Journal (Primary Live Workspace: Daily Preparation -> Session Logger -> Live Trade Logger)
3. Daily / Session Records (Historical Viewer)
4. Trades (Independent Ledger & Trade Inspector)
5. Calendar (Monday-start monthly view)
6. Analytics (Financial, Activity, Discipline, Psychology)
7. Reviews (Daily, Weekly, Monthly, Strategy)
8. Settings & Export (Portability, Profile, Accounts, Templates & Checklists, Instruments & Logger, Diagnostics)
