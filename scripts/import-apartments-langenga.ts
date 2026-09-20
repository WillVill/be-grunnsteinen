/**
 * Import Script: Hjemom Langenga AS apartments
 *
 * Source: "Leilighetsoversikt Hjemom Langenga AS.xlsx" (sheet "Grunnsteinen AS").
 *
 * Imports the 48 residential units into the existing "Langenga" building
 * (code: hjemom-langenga) under the Grunnsteinen organization.
 *
 * Deliberately NOT imported (customer decision):
 *   - the 24 Garasjeplass rows        (not residential units)
 *   - Markedsleie / Bod nr. / Seksjonsnummer / Planlosning type (no rental-economics
 *     dimension in this platform)
 *   - Utleier / Kontonummer / Org.nr  (landlord data, identical on every row)
 *   - the two summary rows at the bottom (Mnd leie 823 000 / Arlig leie 9 876 000)
 *
 * Field mapping:
 *   Leilighetsnummer "H0 - 101" -> unitNumber "H0101"  (normalized bolignummer)
 *   Leilighet adresse           -> entrance ("Langenga 42" .. "Langenga 58")
 *   Etasje                      -> floor
 *   Storrelse                   -> sizeSqm
 *   Antall rom "4-roms"         -> numberOfRooms 4 + apartmentType FOUR_ROOM
 *
 * Idempotent: keyed on (buildingId, unitNumber). Re-running updates the imported
 * fields in place and never duplicates. isActive/tags/tenantIds are only written on
 * insert, so admin changes made in the UI survive a re-run.
 *
 * Usage:
 *   npx ts-node scripts/import-apartments-langenga.ts --dry-run
 *   npx ts-node scripts/import-apartments-langenga.ts
 *   or
 *   yarn import:langenga
 */

import { MongoClient, ObjectId, Db } from "mongodb";
import * as dotenv from "dotenv";
import { ApartmentType } from "../src/modules/apartments/schemas/apartment.schema";

dotenv.config();

const MONGODB_URI =
  process.env.DATABASE_URL ||
  process.env.MONGODB_URI ||
  "mongodb://localhost:27017/heime";

const DRY_RUN = process.argv.includes("--dry-run");

const ORGANIZATION_CODE = "GRUNNSTEINEN";
const BUILDING_CODE = "hjemom-langenga";

// Building-level address, from the sheet (identical on every row).
const BUILDING_ADDRESS = {
  address: "Langenga 42-58",
  city: "Asker",
  postalCode: "1386",
};

interface ApartmentRow {
  unitNumber: string;
  entrance: string;
  floor: number;
  sizeSqm: number;
  numberOfRooms: number;
  apartmentType: ApartmentType;
}

const APARTMENTS: ApartmentRow[] = [
  { unitNumber: "H0101", entrance: "Langenga 42", floor: 1, sizeSqm: 77, numberOfRooms: 4, apartmentType: ApartmentType.FOUR_ROOM },
  { unitNumber: "H0102", entrance: "Langenga 44", floor: 1, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0103", entrance: "Langenga 46", floor: 1, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0104", entrance: "Langenga 48", floor: 1, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0105", entrance: "Langenga 50", floor: 1, sizeSqm: 63, numberOfRooms: 3, apartmentType: ApartmentType.THREE_ROOM },
  { unitNumber: "H0106", entrance: "Langenga 52", floor: 1, sizeSqm: 41, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0107", entrance: "Langenga 54", floor: 1, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0108", entrance: "Langenga 56", floor: 1, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0109", entrance: "Langenga 58", floor: 1, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0110", entrance: "Langenga 58", floor: 1, sizeSqm: 54, numberOfRooms: 3, apartmentType: ApartmentType.THREE_ROOM },
  { unitNumber: "H0201", entrance: "Langenga 58", floor: 2, sizeSqm: 77, numberOfRooms: 4, apartmentType: ApartmentType.FOUR_ROOM },
  { unitNumber: "H0202", entrance: "Langenga 58", floor: 2, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0203", entrance: "Langenga 58", floor: 2, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0204", entrance: "Langenga 58", floor: 2, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0205", entrance: "Langenga 58", floor: 2, sizeSqm: 64, numberOfRooms: 3, apartmentType: ApartmentType.THREE_ROOM },
  { unitNumber: "H0206", entrance: "Langenga 58", floor: 2, sizeSqm: 64, numberOfRooms: 3, apartmentType: ApartmentType.THREE_ROOM },
  { unitNumber: "H0207", entrance: "Langenga 58", floor: 2, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0208", entrance: "Langenga 58", floor: 2, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0209", entrance: "Langenga 58", floor: 2, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0210", entrance: "Langenga 58", floor: 2, sizeSqm: 54, numberOfRooms: 3, apartmentType: ApartmentType.THREE_ROOM },
  { unitNumber: "H0301", entrance: "Langenga 58", floor: 3, sizeSqm: 77, numberOfRooms: 4, apartmentType: ApartmentType.FOUR_ROOM },
  { unitNumber: "H0302", entrance: "Langenga 58", floor: 3, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0303", entrance: "Langenga 58", floor: 3, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0304", entrance: "Langenga 58", floor: 3, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0305", entrance: "Langenga 58", floor: 3, sizeSqm: 64, numberOfRooms: 3, apartmentType: ApartmentType.THREE_ROOM },
  { unitNumber: "H0306", entrance: "Langenga 58", floor: 3, sizeSqm: 64, numberOfRooms: 3, apartmentType: ApartmentType.THREE_ROOM },
  { unitNumber: "H0307", entrance: "Langenga 58", floor: 3, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0308", entrance: "Langenga 58", floor: 3, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0309", entrance: "Langenga 58", floor: 3, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0310", entrance: "Langenga 58", floor: 3, sizeSqm: 54, numberOfRooms: 3, apartmentType: ApartmentType.THREE_ROOM },
  { unitNumber: "H0401", entrance: "Langenga 58", floor: 4, sizeSqm: 77, numberOfRooms: 4, apartmentType: ApartmentType.FOUR_ROOM },
  { unitNumber: "H0402", entrance: "Langenga 58", floor: 4, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0403", entrance: "Langenga 58", floor: 4, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0404", entrance: "Langenga 58", floor: 4, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0405", entrance: "Langenga 58", floor: 4, sizeSqm: 64, numberOfRooms: 3, apartmentType: ApartmentType.THREE_ROOM },
  { unitNumber: "H0406", entrance: "Langenga 58", floor: 4, sizeSqm: 64, numberOfRooms: 3, apartmentType: ApartmentType.THREE_ROOM },
  { unitNumber: "H0407", entrance: "Langenga 58", floor: 4, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0408", entrance: "Langenga 58", floor: 4, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0409", entrance: "Langenga 58", floor: 4, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0410", entrance: "Langenga 58", floor: 4, sizeSqm: 53, numberOfRooms: 3, apartmentType: ApartmentType.THREE_ROOM },
  { unitNumber: "H0501", entrance: "Langenga 58", floor: 5, sizeSqm: 63, numberOfRooms: 3, apartmentType: ApartmentType.THREE_ROOM },
  { unitNumber: "H0502", entrance: "Langenga 58", floor: 5, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0503", entrance: "Langenga 58", floor: 5, sizeSqm: 63, numberOfRooms: 3, apartmentType: ApartmentType.THREE_ROOM },
  { unitNumber: "H0504", entrance: "Langenga 58", floor: 5, sizeSqm: 63, numberOfRooms: 3, apartmentType: ApartmentType.THREE_ROOM },
  { unitNumber: "H0505", entrance: "Langenga 58", floor: 5, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0506", entrance: "Langenga 58", floor: 5, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0507", entrance: "Langenga 58", floor: 5, sizeSqm: 45, numberOfRooms: 2, apartmentType: ApartmentType.TWO_ROOM },
  { unitNumber: "H0508", entrance: "Langenga 58", floor: 5, sizeSqm: 54, numberOfRooms: 3, apartmentType: ApartmentType.THREE_ROOM },
];

async function main() {
  console.log("========================================");
  console.log("Import: Hjemom Langenga apartments");
  console.log("========================================");
  console.log(`MongoDB: ${MONGODB_URI.replace(/:\/\/[^@]*@/, "://***@")}`);
  console.log(`Mode:    ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`Rows:    ${APARTMENTS.length}`);
  console.log("");

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log("Connected to MongoDB");
    const db = client.db();

    const { organizationId, buildingId, conceptId } = await resolveTargets(db);
    await updateBuildingAddress(db, buildingId);
    await importApartments(db, organizationId, buildingId, conceptId);

    console.log("");
    console.log("========================================");
    console.log(DRY_RUN ? "Dry run complete - nothing written" : "Import complete");
    console.log("========================================");
  } catch (error) {
    console.error("Import failed:", error);
    process.exit(1);
  } finally {
    await client.close();
    console.log("Disconnected from MongoDB");
  }
}

async function resolveTargets(db: Db) {
  const org = await db
    .collection("organizations")
    .findOne({ code: ORGANIZATION_CODE });
  if (!org) {
    throw new Error(
      `Organization "${ORGANIZATION_CODE}" not found. Run "yarn setup:customer" first.`,
    );
  }

  const building = await db.collection("buildings").findOne({
    organizationId: org._id,
    code: BUILDING_CODE,
  });
  if (!building) {
    throw new Error(
      `Building "${BUILDING_CODE}" not found in ${ORGANIZATION_CODE}. Run "yarn setup:customer" first.`,
    );
  }

  console.log(`Organization: ${org.name} (${org._id})`);
  console.log(`Building:     ${building.name} (${building._id})`);
  console.log("");

  return {
    organizationId: org._id as ObjectId,
    buildingId: building._id as ObjectId,
    conceptId: building.conceptId as ObjectId | undefined,
  };
}

async function updateBuildingAddress(db: Db, buildingId: ObjectId) {
  if (DRY_RUN) {
    console.log(
      `[dry-run] would set building address: ${BUILDING_ADDRESS.address}, ` +
        `${BUILDING_ADDRESS.postalCode} ${BUILDING_ADDRESS.city}`,
    );
    return;
  }

  await db
    .collection("buildings")
    .updateOne(
      { _id: buildingId },
      { $set: { ...BUILDING_ADDRESS, updatedAt: new Date() } },
    );
  console.log(
    `Building address set: ${BUILDING_ADDRESS.address}, ` +
      `${BUILDING_ADDRESS.postalCode} ${BUILDING_ADDRESS.city}`,
  );
}

async function importApartments(
  db: Db,
  organizationId: ObjectId,
  buildingId: ObjectId,
  conceptId: ObjectId | undefined,
) {
  const apartments = db.collection("apartments");
  let created = 0;
  let updated = 0;

  for (const row of APARTMENTS) {
    const filter = { buildingId, unitNumber: row.unitNumber };

    if (DRY_RUN) {
      const existing = await apartments.findOne(filter);
      console.log(
        `  [dry-run] ${existing ? "update" : "create"} ${row.unitNumber} ` +
          `(${row.entrance}, floor ${row.floor}, ${row.sizeSqm} m2, ${row.apartmentType})`,
      );
      existing ? updated++ : created++;
      continue;
    }

    const result = await apartments.updateOne(
      filter,
      {
        // Imported fields - kept in sync with the spreadsheet on every run.
        $set: {
          entrance: row.entrance,
          floor: row.floor,
          sizeSqm: row.sizeSqm,
          numberOfRooms: row.numberOfRooms,
          apartmentType: row.apartmentType,
          updatedAt: new Date(),
        },
        // Owned by the app after creation - never overwritten by a re-run.
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

    if (result.upsertedCount > 0) {
      created++;
    } else {
      updated++;
    }
  }

  console.log("");
  console.log(`Created: ${created}`);
  console.log(`Updated: ${updated}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
