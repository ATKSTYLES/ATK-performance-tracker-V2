# ATK Deck V2 — Canonical Data Dictionary

All visible UI labels are mapped centrally in `/src/domain/enums.ts` to canonical database enums. Display labels must never be written directly into enum fields.

## Canonical Enumerations
- `AccountType`: `live` | `funded` | `evaluation` | `demo` | `personal`
- `SessionStatus`: `planned` | `live` | `completed` | `missed` | `cancelled`
- `SessionAttendance`: `attended` | `missed` | `planned` | `cancelled`
- `SittingLocation`: `home` | `office` | `trading_desk` | `travelling` | `other`
- `SessionBias`: `bullish` | `bearish` | `neutral` | `custom`
- `SetupAvailability`: `pending` | `available` | `limited` | `none`
- `PlanAdherence`: `pending` | `yes` | `partial` | `no`
- `TradeDirection`: `long` | `short`
- `TradeStatus`: `before_entry` | `during_trade` | `closed`
- `ExitOutcome`: `pending` | `win` | `loss` | `breakeven`
- `ExitReason`: `pending` | `take_profit` | `stop_loss` | `manual_exit` | `breakeven_exit` | `other`
- `TpStatus`: `pending` | `hit_full` | `partial` | `missed` | `not_used`
- `SlStatus`: `pending` | `hit` | `trailed_breakeven` | `moved` | `untouched`
- `YesNoNa`: `yes` | `no` | `na`
- `AttachmentCategory`: `before_entry` | `entry` | `exit` | `post_trade` | `session_note`
- `ReviewType`: `daily` | `weekly` | `monthly` | `strategy`
- `ErrorCategory`: `validation` | `authentication` | `permission` | `database` | `network` | `synchronisation` | `conflict` | `application`

## Immutable Base Fields (All Entities)
- `id` (string, `^[a-zA-Z0-9_-]+$`, max 128)
- `userId` (string, owner Firebase Auth UID)
- `createdAt` (Firestore server timestamp)
