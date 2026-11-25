# ATK Deck V2 — Acceptance Criteria

1. All 8 navigation pages load cleanly and follow the single-level sidebar + sticky header layout.
2. Daily Journal maintains 1 record per user/date and renders Daily Preparation -> Session Logger -> Live Trade Logger in strict vertical order.
3. Session and Trade lifecycles are independent: ending a session never closes open trades; trades remain closable post-session.
4. `session_events` and `trade_events` never merge or bleed across collections.
5. Profit Factor shows `N/A — No losing trades yet.` when losing trades = 0 (never `Infinity`).
6. Open trades are excluded from closed-trade performance statistics.
7. Anti-bias pause cancels cleanly without creating a trade and records `guard_cancelled` + `stepped_back`.
8. Atomic trade closure preserves the closing form and surfaces full diagnostics (`operationId`, `documentPath`, `failedEventPath`, `failedStage`) on failure with idempotent retry.
9. ATK-UTDS v1.0 ZIP, JSON, CSV, and XLSX exports and validated imports work without silent data loss.
10. Responsive layouts verified at 1440px, 1024px, 768px, and 375px.
