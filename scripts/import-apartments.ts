/**
 * Import Script: apartments for every Grunnsteinen building
 *
 * Reads scripts/data/apartments.json — generated from the customer's spreadsheets by
 * scripts/extract-apartments.py — and upserts the units into their buildings.
 *
 * Covers all six buildings (495 units):
 *   hjemom-langenga 48 · hjemom-bergerlokka 37 · hjemom-granstangen-park 156
 *   leva-granstangen-park 100 · leva-bergerlokka 65 · leva-jessheim-park 89
 *
 * Deliberately NOT imported (customer decision):
 *   - Garasjeplass / parking rows
 *   - rental economics (Markedsleie, Bod nr., Seksjonsnummer, Planlosning type)
 *   - landlord columns (Utleier, Kontonummer, Org.nr)
 *   - per-room dimensions (Sov 1, Bad, Stue/kjokken, ...)
 *
 * Field mapping:
 *   Leilighetsnummer -> unitNumber   ("H0 - 101" -> "H0101", "J0 101" -> "J0101")
 *   Adresse          -> entrance     (falls back to "Hus N" where the column is empty)
 *   Etasje           -> floor        ("U1" underetasje -> -1)
 *   Storrelse        -> sizeSqm
 *   Antall rom       -> numberOfRooms + apartmentType
 *
 * Idempotent: keyed on (buildingId, unitNumber). Re-running refreshes the imported
 * fields; isActive/tags/tenantIds are written on insert only, so admin changes made in
 * the UI survive a re-run.
 *
 * Usage:
 *   npx ts-node scripts/import-apartments.ts --dry-run
 *   npx ts-node scripts/import-apartments.ts --building=leva-jessheim-park
 *   npx ts-node scripts/import-apartments.ts
 *   or
 *   yarn import:apartments
 */

import { MongoClient, ObjectId, Db } from "mongodb";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { ApartmentType } from "../src/modules/apartments/schemas/apartment.schema";

dotenv.config();

const MONGODB_URI =
  process.env.DATABASE_URL ||
  process.env.MONGODB_URI ||
  "mongodb://localhost:27017/heime";

const DRY_RUN = process.argv.includes("--dry-run");
const ONLY = process.argv
  .find((a) => a.startsWith("--building="))
  ?.split("=")[1];

const ORGANIZATION_CODE = "GRUNNSTEINEN";
const DATA_FILE = path.join(__dirname, "data", "apartments.json");

interface ApartmentRow {
  unitNumber: string;
  entrance: string | null;
  floor: number | null;
  sizeSqm: number | null;
  numberOfRooms: number | null;
  apartmentType: string | null;
}

interface BuildingData {
  buildingCode: string;
  source: string;
  city: string | null;
  postalCode: string | null;
  apartments: ApartmentRow[];
}

async function main() {
  const all: BuildingData[] = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  const groups = ONLY ? all.filter((g) => g.buildingCode === ONLY) : all;

  if (!groups.length) {
    throw new Error(
      `No building matched "${ONLY}". Known: ${all.map((g) => g.buildingCode).join(", ")}`,
    );
  }

  const total = groups.reduce((n, g) => n + g.apartments.length, 0);

  console.log("========================================");
  console.log("Import: Grunnsteinen apartments");
  console.log("========================================");
  console.log(`MongoDB:   ${MONGODB_URI.replace(/:\/\/[^@]*@/, "://***@")}`);
  console.log(`Mode:      ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`Buildings: ${groups.length}${ONLY ? ` (filtered: ${ONLY})` : ""}`);
  console.log(`Units:     ${total}`);
  console.log("");

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log("Connected to MongoDB");
    const db = client.db();

    const org = await db
      .collection("organizations")
      .findOne({ code: ORGANIZATION_CODE });
    if (!org) {
      throw new Error(
        `Organization "${ORGANIZATION_CODE}" not found. Run "yarn setup:customer" first.`,
      );
    }
    console.log(`Organization: ${org.name} (${org._id})\n`);

    let created = 0;
    let updated = 0;

    for (const group of groups) {
      const res = await importBuilding(db, org._id as ObjectId, group);
      created += res.created;
      updated += res.updated;
    }

    console.log("");
    console.log("========================================");
    console.log(DRY_RUN ? "Dry run complete - nothing written" : "Import complete");
    console.log("========================================");
    console.log(`Created: ${created}`);
    console.log(`Updated: ${updated}`);
    console.log(`Total:   ${created + updated}`);
  } catch (error) {
    console.error("Import failed:", error);
    process.exit(1);
  } finally {
    await client.close();
    console.log("Disconnected from MongoDB");
  }
}

async function importBuilding(
  db: Db,
  organizationId: ObjectId,
  group: BuildingData,
): Promise<{ created: number; updated: number }> {
  const building = await db.collection("buildings").findOne({
    organizationId,
    code: group.buildingCode,
  });
  if (!building) {
    throw new Error(
      `Building "${group.buildingCode}" not found. Run "yarn setup:customer" first.`,
    );
  }

  const apartments = db.collection("apartments");
  const buildingId = building._id as ObjectId;
  const conceptId = building.conceptId as ObjectId | undefined;
  let created = 0;
  let updated = 0;

  for (const row of group.apartments) {
    const filter = { buildingId, unitNumber: row.unitNumber };

    if (DRY_RUN) {
      const existing = await apartments.findOne(filter);
      existing ? updated++ : created++;
      continue;
    }

    const result = await apartments.updateOne(
      filter,
      {
        // Imported fields — re-synced with the spreadsheet on every run.
        $set: {
          entrance: row.entrance ?? undefined,
          floor: row.floor ?? undefined,
          sizeSqm: row.sizeSqm ?? undefined,
          numberOfRooms: row.numberOfRooms ?? undefined,
          apartmentType: (row.apartmentType as ApartmentType) ?? undefined,
          updatedAt: new Date(),
        },
        // Owned by the app after creation — never overwritten by a re-run.
        $setOnInsert: {
          organizationId,
          buildingId,
          ...(conceptId ? { conceptId } : {}),
          unitNumber: row.unitNumber,
          tags: [],
          tenantIds: [],
          isActive: true,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );

    result.upsertedCount > 0 ? created++ : updated++;
  }

  // The sheets carry a single city/postcode per building; the street address varies
  // per unit and lives on the apartment's `entrance`, so it is not set here.
  if (!DRY_RUN && (group.city || group.postalCode)) {
    await db.collection("buildings").updateOne(
      { _id: buildingId },
      {
        $set: {
          ...(group.city ? { city: group.city } : {}),
          ...(group.postalCode ? { postalCode: group.postalCode } : {}),
          updatedAt: new Date(),
        },
      },
    );
  }

  const loc = [group.postalCode, group.city].filter(Boolean).join(" ");
  console.log(
    `  ${String(group.apartments.length).padStart(4)} units  ` +
      `${group.buildingCode.padEnd(26)} ${loc.padEnd(18)} ` +
      `created=${created} updated=${updated}`,
  );

  return { created, updated };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
