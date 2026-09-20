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

### 3. Import Langenga Apartments

**File:** `import-apartments-langenga.ts`

Imports the 48 residential units from the customer spreadsheet
*"Leilighetsoversikt Hjemom Langenga AS.xlsx"* into the existing `Langenga`
building (code `hjemom-langenga`).

**Usage:**

```bash
# Dry run (lists every create/update, writes nothing)
npx ts-node scripts/import-apartments-langenga.ts --dry-run

# Live import
yarn import:langenga
```

**What it does:**
- Resolves the `GRUNNSTEINEN` organization and `hjemom-langenga` building (both must
  already exist — run `yarn setup:customer` first)
- Sets the building address to `Langenga 42-58, 1386 Asker`
- Upserts 48 apartments keyed on `(buildingId, unitNumber)`

**Field mapping:**

| Spreadsheet column | Apartment field | Transform |
| --- | --- | --- |
| `Leilighetsnummer` | `unitNumber` | `"H0 - 101"` → `"H0101"` |
| `Leilighet adresse` | `entrance` | `"Langenga 58 - H0101"` → `"Langenga 58"` |
| `Etasje` | `floor` | — |
| `Størrelse` | `sizeSqm` | — |
| `Antall rom` | `numberOfRooms` + `apartmentType` | `"4-roms"` → `4` + `FOUR_ROOM` |

**Not imported** (customer decision): the 24 `Garasjeplass` rows, the landlord columns
(`Utleier`, `Kontonummer`, `Org.nr`), the rental-economics columns (`Markedsleie`,
`Bod nr.`, `Seksjonsnummer`, `Planløsning type`), and the two summary rows.

**Idempotency:** re-running refreshes the imported fields only. `isActive`, `tags`,
and `tenantIds` are written on insert only, so changes made in the admin UI survive.

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
