/**
 * Setup Script: Grunnsteinen Customer Data
 *
 * DESTRUCTIVE: drops every collection in the database except `users`.
 *
 * Then seeds:
 *   - Organization "Grunnsteinen"
 *   - Concepts "Leva" and "Hjemom"
 *   - 6 buildings (3 per concept; shared names become separate records)
 *   - Reassigns every surviving user to the new Grunnsteinen org
 *   - Upserts admin user William Bech (password: 12345)
 *
 * Idempotent: re-running drops + reseeds, leaving the same end state.
 *
 * Usage:
 *   npx ts-node scripts/setup-customer-grunnsteinen.ts
 *   or
 *   yarn setup:customer
 */

import { MongoClient, ObjectId, Db } from "mongodb";
import * as bcrypt from "bcrypt";
import * as dotenv from "dotenv";

dotenv.config();

const MONGODB_URI =
  process.env.DATABASE_URL ||
  process.env.MONGODB_URI ||
  "mongodb://localhost:27017/heime";

const ORGANIZATION = {
  name: "Grunnsteinen",
  code: "GRUNNSTEINEN",
  address: "",
  city: "",
  postalCode: "",
  description: "Grunnsteinen",
  settings: {
    allowResidentPosts: true,
    allowResidentEvents: true,
    requireBookingApproval: false,
    defaultBookingRules: "",
  },
  isActive: true,
};

const CONCEPTS = [
  { name: "Leva", code: "leva" },
  { name: "Hjemom", code: "hjemom" },
];

const BUILDINGS: Array<{ conceptCode: string; name: string; code: string }> = [
  { conceptCode: "leva", name: "Jessheim Park", code: "leva-jessheim-park" },
  { conceptCode: "leva", name: "Bergerløkka", code: "leva-bergerlokka" },
  {
    conceptCode: "leva",
    name: "Granstangen Park",
    code: "leva-granstangen-park",
  },
  { conceptCode: "hjemom", name: "Bergerløkka", code: "hjemom-bergerlokka" },
  { conceptCode: "hjemom", name: "Langenga", code: "hjemom-langenga" },
  {
    conceptCode: "hjemom",
    name: "Granstangen Park",
    code: "hjemom-granstangen-park",
  },
];

const PRIMARY_BUILDING_CODE = "leva-jessheim-park";

const ADMIN_USER = {
  email: "bech.william2@gmail.com",
  password: "12345",
  name: "William Bech",
  role: "admin",
};

async function main() {
  console.log("========================================");
  console.log("Grunnsteinen Customer Setup");
  console.log("========================================");
  console.log(`MongoDB: ${MONGODB_URI}`);
  console.log("DESTRUCTIVE: dropping all collections except 'users'");
  console.log("");

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log("✓ Connected to MongoDB");

    const db = client.db();

    await dropAllCollectionsExceptUsers(db);
    const organizationId = await createOrganization(db);
    const conceptIds = await createConcepts(db, organizationId);
    const buildingIds = await createBuildings(db, organizationId, conceptIds);
    await reassignAllUsersToOrg(db, organizationId);
    await upsertAdminUser(db, organizationId, buildingIds);

    console.log("");
    console.log("========================================");
    console.log("Setup Complete");
    console.log("========================================");
    console.log(`Organization: ${ORGANIZATION.name} (${organizationId})`);
    console.log(`Concepts: ${CONCEPTS.map((c) => c.name).join(", ")}`);
    console.log(`Buildings: ${BUILDINGS.length}`);
    console.log("");
    console.log(`Admin: ${ADMIN_USER.email}`);
    console.log(`Password: ${ADMIN_USER.password}`);
    console.log(`Role: ${ADMIN_USER.role}`);
  } catch (error) {
    console.error("Setup failed:", error);
    process.exit(1);
  } finally {
    await client.close();
    console.log("Disconnected from MongoDB");
  }
}

async function dropAllCollectionsExceptUsers(db: Db) {
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  for (const { name } of collections) {
    if (name === "users") continue;
    if (name.startsWith("system.")) continue;
    await db.collection(name).drop();
    console.log(`  ✓ Dropped collection: ${name}`);
  }
}

async function createOrganization(db: Db): Promise<ObjectId> {
  const orgDoc = {
    _id: new ObjectId(),
    ...ORGANIZATION,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.collection("organizations").insertOne(orgDoc);
  console.log(`✓ Created organization: ${ORGANIZATION.name} (${orgDoc._id})`);
  return orgDoc._id;
}

async function createConcepts(
  db: Db,
  organizationId: ObjectId,
): Promise<Map<string, ObjectId>> {
  const ids = new Map<string, ObjectId>();
  for (const concept of CONCEPTS) {
    const doc = {
      _id: new ObjectId(),
      organizationId,
      name: concept.name,
      code: concept.code,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.collection("concepts").insertOne(doc);
    ids.set(concept.code, doc._id);
    console.log(`✓ Created concept: ${concept.name} (${doc._id})`);
  }
  return ids;
}

async function createBuildings(
  db: Db,
  organizationId: ObjectId,
  conceptIds: Map<string, ObjectId>,
): Promise<Map<string, ObjectId>> {
  const ids = new Map<string, ObjectId>();
  for (const b of BUILDINGS) {
    const conceptId = conceptIds.get(b.conceptCode);
    if (!conceptId) {
      throw new Error(`Missing concept for building ${b.code}`);
    }
    const doc = {
      _id: new ObjectId(),
      organizationId,
      conceptId,
      name: b.name,
      code: b.code,
      address: "",
      city: "",
      postalCode: "",
      description: "",
      settings: {
        allowResidentPosts: true,
        allowResidentEvents: true,
        requireBookingApproval: false,
      },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.collection("buildings").insertOne(doc);
    ids.set(b.code, doc._id);
    console.log(`✓ Created building: ${b.name} [${b.conceptCode}] (${doc._id})`);
  }
  return ids;
}

async function reassignAllUsersToOrg(db: Db, organizationId: ObjectId) {
  const res = await db.collection("users").updateMany(
    {},
    {
      $set: {
        organizationId,
        buildingIds: [],
        updatedAt: new Date(),
      },
      $unset: { primaryBuildingId: "" },
    },
  );
  console.log(`✓ Reassigned ${res.modifiedCount} user(s) to Grunnsteinen`);
}

async function upsertAdminUser(
  db: Db,
  organizationId: ObjectId,
  buildingIds: Map<string, ObjectId>,
) {
  const users = db.collection("users");
  const email = ADMIN_USER.email.toLowerCase();
  const allBuildingIds = Array.from(buildingIds.values());
  const primaryBuildingId = buildingIds.get(PRIMARY_BUILDING_CODE);
  if (!primaryBuildingId) {
    throw new Error(`Primary building "${PRIMARY_BUILDING_CODE}" not found`);
  }

  const hashedPassword = await bcrypt.hash(ADMIN_USER.password, 10);
  const existing = await users.findOne({ email });

  if (existing) {
    await users.updateOne(
      { _id: existing._id },
      {
        $set: {
          name: ADMIN_USER.name,
          password: hashedPassword,
          organizationId,
          buildingIds: allBuildingIds,
          primaryBuildingId,
          role: ADMIN_USER.role,
          isActive: true,
          updatedAt: new Date(),
        },
      },
    );
    console.log(`✓ Updated admin user: ${email} (${existing._id})`);
    return;
  }

  const userDoc = {
    _id: new ObjectId(),
    email,
    password: hashedPassword,
    name: ADMIN_USER.name,
    organizationId,
    buildingIds: allBuildingIds,
    primaryBuildingId,
    role: ADMIN_USER.role,
    interests: [],
    isHelpfulNeighbor: false,
    helpfulSkills: [],
    notificationPreferences: {
      email: {
        newPosts: true,
        comments: true,
        events: true,
        eventReminders: true,
        bookings: true,
        helpRequests: true,
        messages: true,
        boardAnnouncements: true,
      },
      push: {
        newPosts: true,
        comments: true,
        events: true,
        eventReminders: true,
        bookings: true,
        helpRequests: true,
        messages: true,
        boardAnnouncements: true,
      },
    },
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await users.insertOne(userDoc);
  console.log(`✓ Created admin user: ${email} (${userDoc._id})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
