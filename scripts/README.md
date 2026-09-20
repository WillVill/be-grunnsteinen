# Database Scripts

This directory contains utility scripts for database operations, migrations, and setup tasks.

## Available Scripts

### 1. Setup Base Organization

**File:** `setup-base-organization.ts`

Creates the base "Grunnsteinen" organization and adds an admin user to the database.

**Usage:**

```bash
# Using npm script (recommended)
yarn setup:base

# Or directly with ts-node
npx ts-node scripts/setup-base-organization.ts
```

**What it does:**
- Creates the "Grunnsteinen" organization with code `GRUNNSTEINEN`
- Creates a "Main Building" and assigns it to the organization
- Adds admin user with email: `bech.william2@gmail.com`
- Assigns the user to the created building
- Sets up default organization and building settings
- If organization/building/user already exists, it updates them instead of creating duplicates

**Created Resources:**
- Organization: `Grunnsteinen` (code: `GRUNNSTEINEN`)
- Building: `Main Building` (code: `MAIN`)
- Admin User:
  - Email: `bech.william2@gmail.com`
  - Password: `IamWill33`
  - Role: `admin`

### 2. Buildings Migration

**File:** `migrate-buildings.ts`

Migrates existing data to support multi-building architecture.

**Usage:**

```bash
# Dry run (see what would change without making changes)
npx ts-node scripts/migrate-buildings.ts --dry-run

# Live migration
npx ts-node scripts/migrate-buildings.ts

# With data backfill
npx ts-node scripts/migrate-buildings.ts --backfill-data
```

### 3. Import Apartments

Two steps: a Python extractor turns the customer's spreadsheets into a reviewable JSON
snapshot, then a TypeScript importer upserts that snapshot into MongoDB.

**Files:** `extract-apartments.py`, `import-apartments.ts`, `data/apartments.json`

**Usage:**

```bash
# 1. Regenerate data/apartments.json from the spreadsheets (default src: ~/Downloads)
yarn extract:apartments
python3 scripts/extract-apartments.py --src /path/to/sheets

# 2. Import — dry run first
npx ts-node scripts/import-apartments.ts --dry-run
yarn import:apartments

# Single building
npx ts-node scripts/import-apartments.ts --building=leva-jessheim-park
```

**Coverage — 495 units across 6 buildings:**

| Building code | Units | Source file |
| --- | --- | --- |
| `hjemom-langenga` | 48 | Leilighetsoversikt Hjemom Langenga AS.xlsx |
| `hjemom-bergerlokka` | 37 | Leilighetsoversikt Hjemom Bergerlokka AS.xlsx |
| `hjemom-granstangen-park` | 156 | Leilighetsoversikt Hjemom Granstangen Park AS.xlsx |
| `leva-granstangen-park` | 100 | Leilighetsoversikt Leva Granstangen Park AS.xlsx |
| `leva-bergerlokka` | 65 | Boligvelger Leva Bergerlokka AS.xlsx |
| `leva-jessheim-park` | 89 | Leilighetsoversikt Jessheim Park.xlsx |

**Field mapping:**

| Spreadsheet column | Apartment field | Transform |
| --- | --- | --- |
| `Leilighetsnummer` | `unitNumber` | `"H0 - 101"` -> `"H0101"`, `"J0 101"` -> `"J0101"` |
| `Adresse` | `entrance` | door suffix stripped; falls back to `"Hus N"` when empty |
| `Etasje` | `floor` | `"U1"` (underetasje) -> `-1` |
| `Storrelse` | `sizeSqm` | - |
| `Antall rom` | `numberOfRooms` + `apartmentType` | `"4-roms"` -> `4` + `4-room`; Jessheim is already numeric |

**The sheets are not uniform.** Each building has an explicit config in the extractor
because column names, header offsets and unit-number formats all differ:

- Jessheim Park: header on row 1 with a units row beneath, `Sted` not `By`, numeric room counts
- Hjemom/Leva Granstangen Park: one sheet per `Hus`, combined into a single building
- Leva Bergerlokka: uses `Forenklet leilighetsnummer` (drops the redundant `Hus 24_` prefix)
- Leva Granstangen Park: Hus 16 and Hus 17 both number from `H0201`, causing 35 collisions.
  `Seksjonsnummer` is also duplicated and `Adresse` is empty, so the Hus number is the only
  disambiguator available and is prefixed into `unitNumber` (`16-H0201`). No other building
  needs this.

**Not imported** (customer decision): `Garasjeplass`/parking rows, landlord columns
(`Utleier`, `Kontonummer`, `Org.nr`), rental economics (`Markedsleie`, `Bod nr.`,
`Seksjonsnummer`, `Planlosning type`) and per-room dimensions (`Sov 1`, `Bad`, ...).

**Idempotency:** keyed on `(buildingId, unitNumber)`. Re-running refreshes the imported
fields only — `isActive`, `tags` and `tenantIds` are written on insert, so admin changes
made in the UI survive. The extractor aborts if any building has duplicate unit numbers.

## Prerequisites

- MongoDB connection configured in `.env` file
- Node.js and dependencies installed (`yarn install`)
- Database accessible

## Environment Variables

Make sure your `.env` file contains:

```
MONGODB_URI=your_mongodb_connection_string
```

## Notes

- All scripts use the MongoDB connection from your `.env` file
- Scripts are idempotent - safe to run multiple times
- Check console output for detailed logs and any errors
