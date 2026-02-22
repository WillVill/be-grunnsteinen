/**
 * Setup Script: Create Base Grunnsteinen Organization
 *
 * This script creates the base "Grunnsteinen" organization, a main building,
 * and adds an admin user assigned to the building.
 *
 * Usage:
 *   npx ts-node scripts/setup-base-organization.ts
 *   or
 *   yarn setup:base
 */

import { MongoClient, ObjectId } from "mongodb";
import * as bcrypt from "bcrypt";
import * as dotenv from "dotenv";

dotenv.config();

const MONGODB_URI = process.env.DATABASE_URL || process.env.MONGODB_URI || "mongodb://localhost:27017/heime";

// Organization details
const ORGANIZATION = {
  name: "Grunnsteinen",
  code: "GRUNNSTEINEN",
  address: "",
  city: "",
  postalCode: "",
  description: "Grunnsteinen base organization",
  settings: {
    allowResidentPosts: true,
    allowResidentEvents: true,
    requireBookingApproval: false,
    defaultBookingRules: "",
  },
  isActive: true,
};

// Building details
const BUILDING = {
  name: "Main Building",
  code: "MAIN",
  address: "",
  city: "",
  postalCode: "",
  description: "Main building for Grunnsteinen",
  settings: {
    allowResidentPosts: true,
    allowResidentEvents: true,
    requireBookingApproval: false,
  },
  isActive: true,
};

// User details
const USER = {
  email: "bech.william2@gmail.com",
  password: "IamWill33",
  name: "William Bech",
  unitNumber: "001", // Default unit number
  role: "super_admin", // Super admin role - full access to all buildings
};

async function main() {
  console.log("========================================");
  console.log("Base Organization Setup Script");
  console.log("========================================");
  console.log(`Organization: ${ORGANIZATION.name}`);
  console.log(`Organization Code: ${ORGANIZATION.code}`);
  console.log(`Building: ${BUILDING.name}`);
  console.log(`Building Code: ${BUILDING.code}`);
  console.log(`Admin User: ${USER.email}`);
  console.log("");

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log("✓ Connected to MongoDB");

    const db = client.db();
    const organizationsCollection = db.collection("organizations");
    const buildingsCollection = db.collection("buildings");
    const usersCollection = db.collection("users");

    // Check if organization already exists
    const existingOrg = await organizationsCollection.findOne({
      code: ORGANIZATION.code,
    });

    let organizationId: ObjectId;

    if (existingOrg) {
      console.log(`✓ Organization "${ORGANIZATION.name}" already exists`);
      organizationId = existingOrg._id;
    } else {
      // Create organization
      const orgDoc = {
        _id: new ObjectId(),
        ...ORGANIZATION,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await organizationsCollection.insertOne(orgDoc);
      organizationId = orgDoc._id;
      console.log(`✓ Created organization: ${ORGANIZATION.name} (ID: ${organizationId})`);
    }

    // Check if building already exists
    const existingBuilding = await buildingsCollection.findOne({
      organizationId: organizationId,
      code: BUILDING.code,
    });

    let buildingId: ObjectId;

    if (existingBuilding) {
      console.log(`✓ Building "${BUILDING.name}" already exists`);
      buildingId = existingBuilding._id;
    } else {
      // Create building
      const buildingDoc = {
        _id: new ObjectId(),
        organizationId: organizationId,
        ...BUILDING,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await buildingsCollection.insertOne(buildingDoc);
      buildingId = buildingDoc._id;
      console.log(`✓ Created building: ${BUILDING.name} (ID: ${buildingId})`);
    }

    // Check if user already exists
    const existingUser = await usersCollection.findOne({
      email: USER.email.toLowerCase(),
    });

    if (existingUser) {
      console.log(`✓ User "${USER.email}" already exists (ID: ${existingUser._id})`);
      
      // Update user to ensure they're in the correct organization, have admin role, and assigned to building
      await usersCollection.updateOne(
        { _id: existingUser._id },
        {
          $set: {
            organizationId: organizationId,
            buildingIds: [buildingId],
            primaryBuildingId: buildingId,
            role: USER.role,
            isActive: true,
            updatedAt: new Date(),
          },
        }
      );
      console.log(`✓ Updated user to admin role and assigned to building`);
    } else {
      // Hash password
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(USER.password, saltRounds);

      // Create user
      const userDoc = {
        _id: new ObjectId(),
        email: USER.email.toLowerCase(),
        password: hashedPassword,
        name: USER.name,
        organizationId: organizationId,
        unitNumber: USER.unitNumber,
        buildingIds: [buildingId],
        primaryBuildingId: buildingId,
        role: USER.role,
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

      await usersCollection.insertOne(userDoc);
      console.log(`✓ Created admin user: ${USER.email} (ID: ${userDoc._id})`);
      console.log(`✓ Assigned user to building: ${BUILDING.name}`);
    }

    console.log("");
    console.log("========================================");
    console.log("Setup Complete!");
    console.log("========================================");
    console.log(`Organization: ${ORGANIZATION.name}`);
    console.log(`Organization Code: ${ORGANIZATION.code}`);
    console.log(`Building: ${BUILDING.name} (${BUILDING.code})`);
    console.log("");
    console.log(`Admin Email: ${USER.email}`);
    console.log(`Admin Password: ${USER.password}`);
    console.log(`Admin Role: ${USER.role}`);
    console.log("");
    console.log("You can now use these credentials to log in.");
  } catch (error) {
    console.error("Setup failed:", error);
    process.exit(1);
  } finally {
    await client.close();
    console.log("Disconnected from MongoDB");
  }
}

main().catch(console.error);
