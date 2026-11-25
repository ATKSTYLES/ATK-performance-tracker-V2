# ATK Deck V2 — Import & Export Specification

## Supported Export Formats
1. **ZIP Archive (`ATK_Trading_Backup.zip`)**: Full ATK-UTDS v1.0 bundle + binary attachments + SHA-256 manifest.
2. **JSON Bundle (`ATK_Trading_Export.json`)**: Structured metadata + all collections + manifest.
3. **CSV (`ATK_Trades.csv`)**: Tabular trade ledger export with RFC-4180 escaping.
4. **Genuine XLSX (`ATK_Trading_Workbook.xlsx`)**: Multi-sheet Excel workbook (`Trades`, `Sessions`, `Daily Journals`, `Accounts`, `Reviews`) generated via SheetJS.

## Import Workflow
1. File selection (`.zip` or `.json`).
2. Archive parsing and manifest validation (`formatName === "ATK-UTDS"`, `formatVersion` `1.x`).
3. SHA-256 integrity verification.
4. Duplicate ID detection across all collections.
5. Interactive preview showing record counts, attachment counts, checksum status, and duplicates.
6. Explicit conflict resolution choice:
   - `Skip Existing` (safe default)
   - `Import as Separate Copy` (remaps IDs while preserving parent-child links)
   - `Replace Existing` (requires explicit confirmation dialog)
7. Relational parent-before-child batched commit preserving `originalCreatedAt`, timezone, and binary attachments.
