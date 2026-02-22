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
