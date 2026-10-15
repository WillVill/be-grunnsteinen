/**
 * Migrate document folders to the subfolder-aware index, then seed the
 * standard top-level folders for every active building in each concept.
 *
 * 1. Drops the legacy { organizationId, conceptId, name } unique index, which
 *    blocked two buildings in one concept from sharing a folder name, and
 *    builds the sibling-scoped { organizationId, conceptId, buildingId,
 *    parentId, name } index.
 * 2. Creates any missing folder from FOLDERS_BY_CONCEPT as a building-scoped
 *    top-level folder. Existing folders (matched on name) are left untouched.
 *
 * Idempotent: safe to re-run.
 *
 * Usage:
 *   yarn ts-node scripts/setup-document-folders.ts [--org GRUNNSTEINEN] [--dry-run]
 */

import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config();

const MONGODB_URI =
  process.env.DATABASE_URL ||
  process.env.MONGODB_URI ||
  "mongodb://localhost:27017/grunnsteinen";
const DRY_RUN = process.argv.includes("--dry-run");
const ORG_CODE = (() => {
  const idx = process.argv.indexOf("--org");
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : "GRUNNSTEINEN";
})();

const LEGACY_INDEX = "organizationId_1_conceptId_1_name_1";

const BASE_FOLDERS = [
  "Ordensreglement",
  "Brannrutiner",
  "Vakttelefon",
  "Defigo portsystem",
  "Oppvarming",
  "Bruksanvisninger leilighet",
  "Gjesteparkering",
  "Internett og TV",
  "Nøkkelsystem",
];

// Keyed by concept code.
const FOLDERS_BY_CONCEPT: Record<string, string[]> = {
  hjemom: BASE_FOLDERS,
  leva: [...BASE_FOLDERS, "Fellesarealer", "Husvert"],
};

async function main() {
  console.log("========================================");
  console.log("Document Folders Setup");
  console.log("========================================");
  console.log(`Mode:    ${DRY_RUN ? "DRY RUN (no changes)" : "LIVE"}`);
  console.log(`MongoDB: ${MONGODB_URI.replace(/:\/\/[^@]*@/, "://***@")}`);
  console.log(`Org:     ${ORG_CODE}\n`);

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db();
    const folders = db.collection("documentfolders");

    // --- 1. Index migration ---
    const indexNames = (await folders.indexes()).map((i) => i.name);
    if (indexNames.includes(LEGACY_INDEX)) {
      if (DRY_RUN) {
        console.log(`[DRY RUN] Would drop legacy index ${LEGACY_INDEX}`);
      } else {
        await folders.dropIndex(LEGACY_INDEX);
        console.log(`Dropped legacy index ${LEGACY_INDEX}`);
      }
    } else {
      console.log("Legacy index already gone");
    }
    if (!DRY_RUN) {
      await folders.createIndex(
        { organizationId: 1, conceptId: 1, buildingId: 1, parentId: 1, name: 1 },
        { unique: true },
      );
      await folders.createIndex({ parentId: 1 });
      console.log("Ensured sibling-scoped unique index\n");
    }

    // --- 2. Seed folders ---
    const org = await db.collection("organizations").findOne({ code: ORG_CODE });
    if (!org) throw new Error(`Organization "${ORG_CODE}" not found`);

    const creator = await db
      .collection("users")
      .findOne(
        { organizationId: org._id, role: { $in: ["super_admin", "admin"] } },
        { sort: { createdAt: 1 } },
      );
    if (!creator) throw new Error("No admin user found to own the folders");

    let created = 0;
    let skipped = 0;

    for (const [conceptCode, names] of Object.entries(FOLDERS_BY_CONCEPT)) {
      const concept = await db
        .collection("concepts")
        .findOne({ organizationId: org._id, code: conceptCode });
      if (!concept) {
        console.log(`Concept "${conceptCode}" not found — skipping`);
        continue;
      }

      const buildings = await db
        .collection("buildings")
        .find({ organizationId: org._id, conceptId: concept._id, isActive: true })
        .sort({ name: 1 })
        .toArray();

      for (const building of buildings) {
        console.log(`${concept.name} / ${building.name}`);
        for (const name of names) {
          const filter = {
            organizationId: org._id as ObjectId,
            conceptId: concept._id as ObjectId,
            buildingId: building._id as ObjectId,
            parentId: null,
            name,
          };
          // `parentId: null` also matches folders where the field is absent.
          if (await folders.findOne(filter)) {
            skipped++;
            continue;
          }
          if (DRY_RUN) {
            console.log(`  [DRY RUN] Would create "${name}"`);
          } else {
            const now = new Date();
            const { parentId: _parentId, ...doc } = filter;
            await folders.insertOne({
              ...doc,
              documentCount: 0,
              createdById: creator._id,
              createdAt: now,
              updatedAt: now,
            });
            console.log(`  Created "${name}"`);
          }
          created++;
        }
      }
    }

    console.log(
      `\n${DRY_RUN ? "Would create" : "Created"} ${created} folder(s), ${skipped} already existed.`,
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
