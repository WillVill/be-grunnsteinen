/**
 * Migration Script: Buildings Multi-Building Support
 *
 * This script migrates existing data to support the multi-building architecture:
 * 1. Creates a default building for each organization from existing user building strings
 * 2. Updates users with buildingIds based on their building string
 * 3. Optionally backfills data documents with buildingId
 *
 * Usage:
 *   npx ts-node scripts/migrate-buildings.ts [--dry-run] [--backfill-data]
 *
 * Flags:
 *   --dry-run       Show what would be changed without making modifications
 *   --backfill-data Also update posts, events, etc. with buildingId
 */

import { MongoClient, ObjectId, Db } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config();

interface MigrationStats {
  organizationsProcessed: number;
  buildingsCreated: number;
  usersUpdated: number;
  postsUpdated: number;
  eventsUpdated: number;
  resourcesUpdated: number;
  helpRequestsUpdated: number;
  sharedItemsUpdated: number;
  documentsUpdated: number;
  groupsUpdated: number;
  bookingsUpdated: number;
  errors: string[];
}

const MONGODB_URI = process.env.DATABASE_URL || "mongodb://localhost:27017/heime";
const DRY_RUN = process.argv.includes("--dry-run");
const BACKFILL_DATA = process.argv.includes("--backfill-data");

async function main() {
  console.log("========================================");
  console.log("Multi-Building Migration Script");
  console.log("========================================");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no changes)" : "LIVE"}`);
  console.log(`Backfill data: ${BACKFILL_DATA ? "YES" : "NO"}`);
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
    console.log(`Buildings created: ${stats.buildingsCreated}`);
    console.log(`Users updated: ${stats.usersUpdated}`);
    if (BACKFILL_DATA) {
      console.log(`Posts updated: ${stats.postsUpdated}`);
      console.log(`Events updated: ${stats.eventsUpdated}`);
      console.log(`Resources updated: ${stats.resourcesUpdated}`);
      console.log(`Help requests updated: ${stats.helpRequestsUpdated}`);
      console.log(`Shared items updated: ${stats.sharedItemsUpdated}`);
      console.log(`Documents updated: ${stats.documentsUpdated}`);
      console.log(`Groups updated: ${stats.groupsUpdated}`);
      console.log(`Bookings updated: ${stats.bookingsUpdated}`);
    }

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
    buildingsCreated: 0,
    usersUpdated: 0,
    postsUpdated: 0,
    eventsUpdated: 0,
    resourcesUpdated: 0,
    helpRequestsUpdated: 0,
    sharedItemsUpdated: 0,
    documentsUpdated: 0,
    groupsUpdated: 0,
    bookingsUpdated: 0,
    errors: [],
  };

  const organizations = db.collection("organizations");
  const buildings = db.collection("buildings");
  const users = db.collection("users");

  // Get all organizations
  const allOrgs = await organizations.find({ isActive: true }).toArray();
  console.log(`Found ${allOrgs.length} organization(s) to process`);

  for (const org of allOrgs) {
    console.log(`\nProcessing organization: ${org.name} (${org._id})`);
    stats.organizationsProcessed++;

    // Get unique building strings for this organization
    const orgUsers = await users.find({ organizationId: org._id }).toArray();
    const buildingStrings = [
      ...new Set(
        orgUsers
          .map((u) => u.building)
          .filter((b): b is string => typeof b === "string" && b.trim() !== "")
      ),
    ];

    console.log(`  Found ${buildingStrings.length} unique building name(s): ${buildingStrings.join(", ") || "(none)"}`);

    // If no building strings, create a default building
    if (buildingStrings.length === 0) {
      buildingStrings.push("Main Building");
    }

    // Map: building string -> ObjectId
    const buildingMap = new Map<string, ObjectId>();

    // Create Building documents
    for (const buildingName of buildingStrings) {
      // Check if building already exists
      const existingBuilding = await buildings.findOne({
        organizationId: org._id,
        name: buildingName,
      });

      if (existingBuilding) {
        console.log(`  Building "${buildingName}" already exists`);
        buildingMap.set(buildingName, existingBuilding._id);
        continue;
      }

      const buildingDoc = {
        _id: new ObjectId(),
        organizationId: org._id,
        name: buildingName,
        code: buildingName.replace(/\s+/g, "-").toLowerCase().slice(0, 20),
        settings: {
          allowResidentPosts: true,
          allowResidentEvents: true,
          requireBookingApproval: false,
        },
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (!DRY_RUN) {
        await buildings.insertOne(buildingDoc);
      }

      buildingMap.set(buildingName, buildingDoc._id);
      console.log(`  Created building: "${buildingName}" (${buildingDoc._id})`);
      stats.buildingsCreated++;
    }

    // Update users with buildingIds
    for (const user of orgUsers) {
      const userBuildingName = user.building || "Main Building";
      const buildingId = buildingMap.get(userBuildingName);

      if (!buildingId) {
        stats.errors.push(`No building found for user ${user._id} (building: "${userBuildingName}")`);
        continue;
      }

      // Skip if user already has buildingIds
      if (user.buildingIds && user.buildingIds.length > 0) {
        console.log(`  User ${user.email} already has buildingIds, skipping`);
        continue;
      }

      if (!DRY_RUN) {
        await users.updateOne(
          { _id: user._id },
          {
            $set: {
              buildingIds: [buildingId],
              primaryBuildingId: buildingId,
            },
          }
        );
      }

      stats.usersUpdated++;
    }

    console.log(`  Updated ${stats.usersUpdated} user(s) with buildingIds`);

    // Backfill data documents if requested
    if (BACKFILL_DATA) {
      // For data documents, we'll assign to the default/first building
      const defaultBuildingId = buildingMap.values().next().value;

      if (defaultBuildingId) {
        stats.postsUpdated += await backfillCollection(
          db,
          "posts",
          org._id,
          defaultBuildingId
        );
        stats.eventsUpdated += await backfillCollection(
          db,
          "events",
          org._id,
          defaultBuildingId
        );
        stats.resourcesUpdated += await backfillCollection(
          db,
          "resources",
          org._id,
          defaultBuildingId
        );
        stats.helpRequestsUpdated += await backfillCollection(
          db,
          "helprequests",
          org._id,
          defaultBuildingId
        );
        stats.sharedItemsUpdated += await backfillCollection(
          db,
          "shareditems",
          org._id,
          defaultBuildingId
        );
        stats.documentsUpdated += await backfillCollection(
          db,
          "documents",
          org._id,
          defaultBuildingId
        );
        stats.groupsUpdated += await backfillCollection(
          db,
          "groups",
          org._id,
          defaultBuildingId
        );
        stats.bookingsUpdated += await backfillCollection(
          db,
          "bookings",
          org._id,
          defaultBuildingId
        );
      }
    }
  }

  return stats;
}

async function backfillCollection(
  db: Db,
  collectionName: string,
  organizationId: ObjectId,
  buildingId: ObjectId
): Promise<number> {
  const collection = db.collection(collectionName);

  // Find documents without buildingId
  const filter = {
    organizationId,
    buildingId: { $exists: false },
  };

  const count = await collection.countDocuments(filter);

  if (count === 0) {
    return 0;
  }

  console.log(`  Backfilling ${count} ${collectionName} documents...`);

  if (!DRY_RUN) {
    // Set isOrganizationWide: true for legacy data so they remain visible to all
    await collection.updateMany(filter, {
      $set: {
        buildingId,
        isOrganizationWide: true, // Legacy data visible to all buildings
      },
    });
  }

  return count;
}

main().catch(console.error);
