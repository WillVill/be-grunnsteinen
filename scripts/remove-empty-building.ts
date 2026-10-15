/**
 * Remove a building that was created by mistake (e.g. a duplicate).
 *
 * Refuses to run if any content references the building — apartments, posts,
 * documents, tenant profiles, etc. Only "derived" references are cleaned up:
 *   - the building is pulled from users.buildingIds
 *   - users.primaryBuildingId pointing at it is unset
 *   - its dailystats snapshot rows are deleted
 *
 * Usage:
 *   yarn ts-node scripts/remove-empty-building.ts --building <id> [--dry-run]
 */

import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config();

const MONGODB_URI =
  process.env.DATABASE_URL ||
  process.env.MONGODB_URI ||
  "mongodb://localhost:27017/grunnsteinen";
const DRY_RUN = process.argv.includes("--dry-run");
const BUILDING_ID = (() => {
  const idx = process.argv.indexOf("--building");
  return idx >= 0 ? process.argv[idx + 1] : undefined;
})();

// Collections whose references are cleaned up rather than blocking removal.
const DERIVED = new Set(["users", "dailystats", "buildings"]);

async function main() {
  if (!BUILDING_ID || !ObjectId.isValid(BUILDING_ID)) {
    console.error("Usage: --building <id> [--dry-run]");
    process.exit(1);
  }
  const buildingId = new ObjectId(BUILDING_ID);

  console.log(`Mode:    ${DRY_RUN ? "DRY RUN (no changes)" : "LIVE"}`);
  console.log(`MongoDB: ${MONGODB_URI.replace(/:\/\/[^@]*@/, "://***@")}\n`);

  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const db = client.db();

    const building = await db.collection("buildings").findOne({ _id: buildingId });
    if (!building) throw new Error(`Building ${BUILDING_ID} not found`);
    console.log(`Building: ${building.name} (${building.code ?? "no code"})`);

    const blockers: string[] = [];
    for (const { name } of await db.listCollections().toArray()) {
      if (DERIVED.has(name)) continue;
      const n = await db.collection(name).countDocuments({ buildingId });
      if (n > 0) blockers.push(`${name}: ${n}`);
    }
    if (blockers.length > 0) {
      console.error(`\nRefusing — building still has content:\n  ${blockers.join("\n  ")}`);
      process.exit(1);
    }

    const users = db.collection("users");
    const memberCount = await users.countDocuments({ buildingIds: buildingId });
    const primaryCount = await users.countDocuments({ primaryBuildingId: buildingId });
    const statsCount = await db.collection("dailystats").countDocuments({ buildingId });
    console.log(`Users with building assigned:  ${memberCount}`);
    console.log(`Users with it as primary:      ${primaryCount}`);
    console.log(`dailystats rows:               ${statsCount}`);

    if (DRY_RUN) {
      console.log("\n[DRY RUN] Would clean up the above and delete the building.");
      return;
    }

    await users.updateMany({ buildingIds: buildingId }, { $pull: { buildingIds: buildingId } } as never);
    await users.updateMany({ primaryBuildingId: buildingId }, { $unset: { primaryBuildingId: "" } });
    await db.collection("dailystats").deleteMany({ buildingId });
    await db.collection("buildings").deleteOne({ _id: buildingId });
    console.log("\nBuilding removed.");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
