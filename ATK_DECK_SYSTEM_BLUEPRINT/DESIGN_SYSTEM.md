# ATK Deck V2 — Permanent Design System

## Design Philosophy
Minimalist, Notion-inspired personal trading workspace prioritizing calm whitespace, 1px hairline dividers, tabular numerical alignment, and zero visual clutter.

## Colour Tokens (`src/index.css`)
### Light Mode
- `--canvas`: `#FAFAFA`
- `--surface`: `#FFFFFF`
- `--subtle-surface`: `#F5F5F5`
- `--border`: `#E5E7EB`
- `--text-primary`: `#111827`
- `--text-secondary`: `#4B5563`
- `--text-muted`: `#6B7280`

### Dark Mode
- `--canvas`: `#0B0E14`
- `--surface`: `#111622`
- `--subtle-surface`: `#171C28`
- `--border`: `#1F2937`
- `--text-primary`: `#F3F4F6`
- `--text-secondary`: `#D1D5DB`
- `--text-muted`: `#9CA3AF`

### Semantic Colours
- Positive: `#16A34A` (dark `#22C55E`)
- Negative: `#DC2626` (dark `#EF4444`)
- Caution: `#D97706` (dark `#F59E0B`)
- Information: `#0284C7` (dark `#38BDF8`)

## Typography
- Headings: `Plus Jakarta Sans`
- Interface & Body: `DM Sans`
- Numbers, Timestamps & Telemetry: `JetBrains Mono` with `font-variant-numeric: tabular-nums`

## Global Layout Dimensions
- Desktop fixed sidebar: `248px`
- Sticky header: `56px`
- Max content container width: `1320px`
- Card radius: `8px`, border: `1px`
- Inputs & buttons standard height: `36px` (`h-9`)
- Table row height: `40px` (`h-10`)
- Modals: `max-h-[90vh]` with internal scrolling body and pinned footer.
