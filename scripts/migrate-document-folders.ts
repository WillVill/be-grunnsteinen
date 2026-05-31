/**
 * Migration Script: Replace document category enum with folder references
 *
 * - Removes the legacy `category` field from every document.
 * - Leaves existing documents with no `folderId`; they will appear in the
 *   "Ikke sortert" section of the frontend until admins move them.
 *
 * Idempotent: safe to re-run. Uses the raw MongoDB driver to bypass
 * Mongoose validators (eliminating `category` from a still-required schema
 * would otherwise fail).
 *
 * Usage:
 *   npx ts-node scripts/migrate-document-folders.ts [--dry-run]
 */

import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config();

const MONGODB_URI = process.env.DATABASE_URL || "mongodb://localhost:27017/heime";
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log("========================================");
  console.log("Document Folders Migration");
  console.log("========================================");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no changes)" : "LIVE"}`);
  console.log("");

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db();
    const documents = db.collection("documents");

    const docsWithCategory = await documents.countDocuments({
      category: { $exists: true },
    });
    console.log(`Documents with legacy category field: ${docsWithCategory}`);

    if (!DRY_RUN && docsWithCategory > 0) {
      const result = await documents.updateMany(
        { category: { $exists: true } },
        { $unset: { category: "" } },
      );
      console.log(`Cleared category on ${result.modifiedCount} document(s)`);
    } else if (DRY_RUN) {
      console.log(
        `[DRY RUN] Would clear category on ${docsWithCategory} document(s)`,
      );
    }

    // Drop the legacy index that included category. Failing here is fine —
    // a re-run after the index has been dropped just no-ops.
    if (!DRY_RUN) {
      const legacyIndexes = [
        "organizationId_1_category_1",
        "organizationId_1_category_1_isPublic_1",
        "organizationId_1_buildingId_1_category_1",
        "organizationId_1_conceptId_1_category_1",
        "apartmentId_1_category_1",
      ];
      for (const name of legacyIndexes) {
        try {
          await documents.dropIndex(name);
          console.log(`Dropped legacy index: ${name}`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes("index not found")) {
            console.log(`  Skip ${name}: ${msg}`);
          }
        }
      }
    } else {
      console.log("[DRY RUN] Would drop legacy category indexes");
    }

    const unsortedCount = await documents.countDocuments({
      $or: [{ folderId: { $exists: false } }, { folderId: null }],
    });
    console.log(`\nUnsorted documents (no folderId): ${unsortedCount}`);
    console.log(
      "These will appear in the 'Ikke sortert' section until admins assign them to folders.",
    );

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

main();
