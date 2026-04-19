import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";
import * as bcrypt from "bcrypt";
import { baseSchemaOptions } from "../../../common/schemas/base.schema";

export type UserDocument = User &
  Document & {
    comparePassword(candidatePassword: string): Promise<boolean>;
  };

export enum UserRole {
  RESIDENT = "resident",
  BOARD = "board",
  ADMIN = "admin",
  SUPER_ADMIN = "super_admin",
}

/**
 * Check if a role has admin-level privileges (ADMIN or SUPER_ADMIN)
 */
export function isAdminRole(role: string): boolean {
  return role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;
}

/**
 * Check if a role has board-level privileges (BOARD, ADMIN, or SUPER_ADMIN)
 */
export function isBoardOrAbove(role: string): boolean {
  return role === UserRole.BOARD || isAdminRole(role);
}

@Schema({ _id: false })
export class EmailNotificationPreferences {
  @Prop({ default: true })
  newPosts: boolean;

  @Prop({ default: true })
  comments: boolean;

  @Prop({ default: true })
  events: boolean;

  @Prop({ default: true })
  eventReminders: boolean;

  @Prop({ default: true })
  bookings: boolean;

  @Prop({ default: true })
  helpRequests: boolean;

  @Prop({ default: true })
  messages: boolean;

  @Prop({ default: true })
  boardAnnouncements: boolean;
}

@Schema({ _id: false })
export class PushNotificationPreferences {
  @Prop({ default: true })
  newPosts: boolean;

  @Prop({ default: true })
  comments: boolean;

  @Prop({ default: true })
  events: boolean;

  @Prop({ default: true })
  eventReminders: boolean;

  @Prop({ default: true })
  bookings: boolean;

  @Prop({ default: true })
  helpRequests: boolean;

  @Prop({ default: true })
  messages: boolean;

  @Prop({ default: true })
  boardAnnouncements: boolean;
}

@Schema({ _id: false })
export class NotificationPreferences {
  @Prop({ type: EmailNotificationPreferences, default: () => ({}) })
  email: EmailNotificationPreferences;

  @Prop({ type: PushNotificationPreferences, default: () => ({}) })
  push: PushNotificationPreferences;
}

@Schema(baseSchemaOptions)
export class User {
  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  })
  email: string;

  @Prop({ select: false })
  password?: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  phone?: string;

  @Prop()
  avatarUrl?: string;

  @Prop({ trim: true })
  avatarColor?: string;

  @Prop()
  dateOfBirth?: Date;

  @Prop({
    type: Types.ObjectId,
    ref: "Organization",
    required: true,
    index: true,
  })
  organizationId: Types.ObjectId;

  @Prop({ trim: true })
  unitNumber?: string;

  @Prop({ trim: true })
  building?: string;

  @Prop({
    type: [{ type: Types.ObjectId, ref: "Building" }],
    default: [],
    index: true,
  })
  buildingIds: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: "Building" })
  primaryBuildingId?: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(UserRole),
    default: UserRole.RESIDENT,
    index: true,
  })
  role: UserRole;

  @Prop({ type: [String], default: [] })
  interests: string[];

  @Prop({ default: false })
  isHelpfulNeighbor: boolean;

  @Prop({ type: [String], default: [] })
  helpfulSkills: string[];

  @Prop({ default: false })
  isProfilePrivate: boolean;


  @Prop({ type: NotificationPreferences, default: () => ({}) })
  notificationPreferences: NotificationPreferences;

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  lastLoginAt?: Date;

  @Prop({ select: false })
  passwordResetToken?: string;

  @Prop({ select: false })
  passwordResetExpires?: Date;

  @Prop({ select: false })
  setupToken?: string;

  @Prop({ select: false })
  setupTokenExpires?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Compound indexes
UserSchema.index({ organizationId: 1, role: 1 });
UserSchema.index({ organizationId: 1, unitNumber: 1 });
UserSchema.index({ organizationId: 1, buildingIds: 1 });

// Pre-save hook to hash password
UserSchema.pre("save", async function () {
  const user = this as unknown as UserDocument;

  // Skip when the password is unset (e.g., admin invitation) or unchanged
  if (!user.password || !user.isModified("password")) {
    return;
  }

  const saltRounds = 10;
  user.password = await bcrypt.hash(user.password, saltRounds);
});

// Method to compare password
UserSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  const user = this as UserDocument;
  if (!user.password) return false;
  return bcrypt.compare(candidatePassword, user.password);
};

// Virtual for full name (if needed in future)
UserSchema.virtual("firstName").get(function () {
  return this.name.split(" ")[0];
});

UserSchema.virtual("lastName").get(function () {
  const parts = this.name.split(" ");
  return parts.length > 1 ? parts.slice(1).join(" ") : "";
});

// True when the user has been invited but has not yet completed setup.
// Requires setupTokenExpires to be selected (see users.service findByOrganization).
UserSchema.virtual('isPendingSetup').get(function () {
  const doc = this as unknown as UserDocument;
  return !doc.isActive && !!doc.setupTokenExpires;
});
