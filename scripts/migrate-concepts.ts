/**
 * Migration Script: Introduce Concept layer
 *
 * - Creates a default Concept for each Organization that has none.
 * - Backfills Building.conceptId from that default Concept.
 * - Backfills conceptId on all content collections that carry buildingId.
 * - Mirrors isOrganizationWide → isConceptWide on the seven flag-bearing collections.
 *
 * Idempotent: safe to re-run. Uses the raw MongoDB driver so it bypasses
 * Mongoose validators (required for Phase A → Phase C transition).
 *
 * Usage:
 *   npx ts-node scripts/migrate-concepts.ts [--dry-run] [--org <id>]
 */

import { MongoClient, ObjectId, Db } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config();

interface MigrationStats {
  organizationsProcessed: number;
  conceptsCreated: number;
  buildingsUpdated: number;
  postsUpdated: number;
  eventsUpdated: number;
  bookingsUpdated: number;
  resourcesUpdated: number;
  groupsUpdated: number;
  apartmentsUpdated: number;
  documentsUpdated: number;
  sharedItemsUpdated: number;
  helpRequestsUpdated: number;
  invitationsUpdated: number;
  tenantProfilesUpdated: number;
  dailyStatsUpdated: number;
  wideFlagsMirrored: number;
  crossOrgRefsSkipped: number;
  errors: string[];
}

const MONGODB_URI = process.env.DATABASE_URL || "mongodb://localhost:27017/heime";
const DRY_RUN = process.argv.includes("--dry-run");
const ORG_FLAG_INDEX = process.argv.indexOf("--org");
const ORG_FILTER_RAW =
  ORG_FLAG_INDEX >= 0 ? process.argv[ORG_FLAG_INDEX + 1] : undefined;

let ORG_FILTER: ObjectId | null = null;
if (ORG_FILTER_RAW) {
  if (!ObjectId.isValid(ORG_FILTER_RAW)) {
    console.error(`Invalid --org id: "${ORG_FILTER_RAW}"`);
    process.exit(1);
  }
  ORG_FILTER = new ObjectId(ORG_FILTER_RAW);
}

const COLLECTIONS_WITH_WIDE_FLAG = [
  "posts",
  "events",
  "resources",
  "groups",
  "documents",
  "shareditems",
  "helprequests",
];

const COLLECTIONS_WITH_BUILDING_ID = [
  "posts",
  "events",
  "bookings",
  "resources",
  "groups",
  "apartments",
  "documents",
  "shareditems",
  "helprequests",
  "invitations",
  "tenantprofiles",
  "dailystats",
];

async function main() {
  console.log("========================================");
  console.log("Concept Layer Migration");
  console.log("========================================");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no changes)" : "LIVE"}`);
  if (ORG_FILTER) {
    console.log(`Org filter: ${ORG_FILTER.toString()}`);
  }
  console.log("");

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db();
    const stats = await migrate(db);

    console.log("\n========================================");
    console.log("Migration Summary");
    console.log("========================================");
    console.log(`Organizations processed: ${stats.organizationsProcessed}`);
    console.log(`Concepts created: ${stats.conceptsCreated}`);
    console.log(`Buildings updated: ${stats.buildingsUpdated}`);
    console.log(`Posts updated: ${stats.postsUpdated}`);
    console.log(`Events updated: ${stats.eventsUpdated}`);
    console.log(`Bookings updated: ${stats.bookingsUpdated}`);
    console.log(`Resources updated: ${stats.resourcesUpdated}`);
    console.log(`Groups updated: ${stats.groupsUpdated}`);
    console.log(`Apartments updated: ${stats.apartmentsUpdated}`);
    console.log(`Documents updated: ${stats.documentsUpdated}`);
    console.log(`Shared items updated: ${stats.sharedItemsUpdated}`);
    console.log(`Help requests updated: ${stats.helpRequestsUpdated}`);
    console.log(`Invitations updated: ${stats.invitationsUpdated}`);
    console.log(`Tenant profiles updated: ${stats.tenantProfilesUpdated}`);
    console.log(`Daily stats updated: ${stats.dailyStatsUpdated}`);
    console.log(`Wide flags mirrored (isOrganizationWide → isConceptWide): ${stats.wideFlagsMirrored}`);
    console.log(`Cross-org references skipped: ${stats.crossOrgRefsSkipped}`);

    if (stats.errors.length > 0) {
      console.log("\nErrors:");
      stats.errors.forEach((e) => console.log(`  - ${e}`));
    }

    if (DRY_RUN) {
      console.log("\n[DRY RUN] No changes were made to the database");
    }
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await client.close();
    console.log("\nDisconnected from MongoDB");
  }
}

async function migrate(db: Db): Promise<MigrationStats> {
  const stats: MigrationStats = {
    organizationsProcessed: 0,
    conceptsCreated: 0,
    buildingsUpdated: 0,
    postsUpdated: 0,
    eventsUpdated: 0,
    bookingsUpdated: 0,
    resourcesUpdated: 0,
    groupsUpdated: 0,
    apartmentsUpdated: 0,
    documentsUpdated: 0,
    sharedItemsUpdated: 0,
    helpRequestsUpdated: 0,
    invitationsUpdated: 0,
    tenantProfilesUpdated: 0,
    dailyStatsUpdated: 0,
    wideFlagsMirrored: 0,
    crossOrgRefsSkipped: 0,
    errors: [],
  };

  const organizations = db.collection("organizations");
  const concepts = db.collection("concepts");
  const buildings = db.collection("buildings");

  const orgFilter: Record<string, unknown> = { isActive: { $ne: false } };
  if (ORG_FILTER) {
    orgFilter._id = ORG_FILTER;
  }

  const allOrgs = await organizations.find(orgFilter).toArray();
  console.log(`Found ${allOrgs.length} organization(s) to process`);

  for (const org of allOrgs) {
    console.log(`\nProcessing organization: ${org.name} (${org._id})`);
    stats.organizationsProcessed++;

    let defaultConcept = await concepts.findOne({
      organizationId: org._id,
      code: "default",
    });

    if (!defaultConcept) {
      const conceptDoc = {
        _id: new ObjectId(),
        organizationId: org._id,
        name: org.name,
        code: "default",
        logoUrl: org.logoUrl ?? null,
        brandColor: null,
        description: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (!DRY_RUN) {
        await concepts.insertOne(conceptDoc);
      }

      defaultConcept = conceptDoc;
      stats.conceptsCreated++;
      console.log(`  Created default concept: ${conceptDoc._id}`);
    } else {
      console.log(`  Default concept already exists: ${defaultConcept._id}`);
    }

    const conceptId = defaultConcept._id;

    // Backfill Building.conceptId for every building in this org without one.
    if (!DRY_RUN) {
      const res = await buildings.updateMany(
        {
          organizationId: org._id,
          $or: [{ conceptId: { $exists: false } }, { conceptId: null }],
        },
        { $set: { conceptId } },
      );
      stats.buildingsUpdated += res.modifiedCount;
    } else {
      const count = await buildings.countDocuments({
        organizationId: org._id,
        $or: [{ conceptId: { $exists: false } }, { conceptId: null }],
      });
      stats.buildingsUpdated += count;
    }

    // Backfill content collections.
    for (const name of COLLECTIONS_WITH_BUILDING_ID) {
      const { updated, skippedCrossOrg } = await backfillContent(
        db,
        name,
        org._id,
        conceptId,
      );
      stats.crossOrgRefsSkipped += skippedCrossOrg;
      switch (name) {
        case "posts":
          stats.postsUpdated += updated;
          break;
        case "events":
          stats.eventsUpdated += updated;
          break;
        case "bookings":
          stats.bookingsUpdated += updated;
          break;
        case "resources":
          stats.resourcesUpdated += updated;
          break;
        case "groups":
          stats.groupsUpdated += updated;
          break;
        case "apartments":
          stats.apartmentsUpdated += updated;
          break;
        case "documents":
          stats.documentsUpdated += updated;
          break;
        case "shareditems":
          stats.sharedItemsUpdated += updated;
          break;
        case "helprequests":
          stats.helpRequestsUpdated += updated;
          break;
        case "invitations":
          stats.invitationsUpdated += updated;
          break;
        case "tenantprofiles":
          stats.tenantProfilesUpdated += updated;
          break;
        case "dailystats":
          stats.dailyStatsUpdated += updated;
          break;
      }
    }

    // Mirror isOrganizationWide → isConceptWide on flag-bearing collections.
    for (const name of COLLECTIONS_WITH_WIDE_FLAG) {
      const mirrored = await mirrorWideFlag(db, name, org._id, conceptId);
      stats.wideFlagsMirrored += mirrored;
    }
  }

  return stats;
}

/**
 * Sets conceptId on every doc in the given collection that has organizationId === org
 * and doesn't already have a conceptId. Documents with a buildingId get their conceptId
 * resolved through buildings (joined via aggregation); documents without a buildingId
 * fall back to the default conceptId for the org.
 */
async function backfillContent(
  db: Db,
  collectionName: string,
  organizationId: ObjectId,
  defaultConceptId: ObjectId,
): Promise<{ updated: number; skippedCrossOrg: number }> {
  const collection = db.collection(collectionName);
  const filter = {
    organizationId,
    $or: [{ conceptId: { $exists: false } }, { conceptId: null }],
  };

  const count = await collection.countDocuments(filter);
  if (count === 0) return { updated: 0, skippedCrossOrg: 0 };

  console.log(`  Backfilling ${count} ${collectionName} doc(s)...`);
  if (DRY_RUN) return { updated: count, skippedCrossOrg: 0 };

  // Walk in batches to avoid memory pressure.
  const cursor = collection.find(filter);
  let updated = 0;
  let skippedCrossOrg = 0;
  const bulk: Array<{
    updateOne: {
      filter: { _id: ObjectId };
      update: { $set: Record<string, unknown> };
    };
  }> = [];

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    if (!doc) continue;

    let conceptId = defaultConceptId;
    if (doc.buildingId) {
      const building = await db
        .collection("buildings")
        .findOne(
          { _id: doc.buildingId },
          { projection: { conceptId: 1, organizationId: 1 } },
        );
      if (building) {
        // Refuse to copy a cross-org building's conceptId — it would break
        // the org/concept invariant. Skip the doc and let the operator
        // investigate. This case usually indicates a pre-existing data bug.
        if (
          building.organizationId &&
          !building.organizationId.equals(organizationId)
        ) {
          skippedCrossOrg++;
          console.warn(
            `  [skip] ${collectionName}/${doc._id}: buildingId points to ` +
              `building in different org (${building.organizationId})`,
          );
          continue;
        }
        if (building.conceptId) {
          conceptId = building.conceptId;
        }
      }
    }

    bulk.push({
      updateOne: {
        filter: { _id: doc._id as ObjectId },
        update: { $set: { conceptId } },
      },
    });

    if (bulk.length >= 500) {
      const res = await collection.bulkWrite(bulk);
      updated += res.modifiedCount;
      bulk.length = 0;
    }
  }

  if (bulk.length > 0) {
    const res = await collection.bulkWrite(bulk);
    updated += res.modifiedCount;
  }

  return { updated, skippedCrossOrg };
}

async function mirrorWideFlag(
  db: Db,
  collectionName: string,
  organizationId: ObjectId,
  defaultConceptId: ObjectId,
): Promise<number> {
  const collection = db.collection(collectionName);

  // Where isOrganizationWide is true and isConceptWide isn't set, mirror the
  // flag. Also stamp the default concept if missing.
  const mirrorFilter = {
    organizationId,
    isOrganizationWide: true,
    $or: [{ isConceptWide: { $exists: false } }, { isConceptWide: false }],
  };
  const candidateCount = await collection.countDocuments(mirrorFilter);

  if (candidateCount === 0) return 0;
  if (DRY_RUN) return candidateCount;

  const res1 = await collection.updateMany(mirrorFilter, {
    $set: { isConceptWide: true },
  });

  // For docs that were org-wide and still have no conceptId, stamp the default.
  await collection.updateMany(
    {
      organizationId,
      isOrganizationWide: true,
      $or: [{ conceptId: { $exists: false } }, { conceptId: null }],
    },
    { $set: { conceptId: defaultConceptId } },
  );

  return res1.modifiedCount;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
