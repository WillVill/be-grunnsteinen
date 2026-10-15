import * as crypto from "crypto";
import * as bcrypt from "bcrypt";
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { User, UserDocument, UserRole, isAdminRole } from "./schemas/user.schema";
import { Post, PostDocument } from "../posts/schemas/post.schema";
import { Comment, CommentDocument } from "../posts/schemas/comment.schema";
import { Event, EventDocument, EventStatus } from "../events/schemas/event.schema";
import {
  Booking,
  BookingDocument,
  BookingStatus,
} from "../bookings/schemas/booking.schema";
import { Group, GroupDocument } from "../groups/schemas/group.schema";
import {
  SharedItem,
  SharedItemDocument,
} from "../sharing/schemas/shared-item.schema";
import {
  HelpRequest,
  HelpRequestDocument,
  HelpRequestStatus,
} from "../sharing/schemas/help-request.schema";
import {
  Conversation,
  ConversationDocument,
} from "../messages/schemas/conversation.schema";
import { Message, MessageDocument } from "../messages/schemas/message.schema";
import {
  Invitation,
  InvitationDocument,
} from "../invitations/schemas/invitation.schema";
import {
  TenantProfile,
  TenantProfileDocument,
  TenantProfileStatus,
} from "../tenant-profiles/schemas/tenant-profile.schema";
import {
  Apartment,
  ApartmentDocument,
} from "../apartments/schemas/apartment.schema";
import { EventsService } from "../events/events.service";
import { BookingsService } from "../bookings/bookings.service";
import {
  NotificationService,
  NotificationType,
} from "../../shared/services/notification.service";
import { S3Service } from "../../shared/services/s3.service";
import { findInOrg } from "../../common/schemas/tenant";

export const DELETED_USER_NAME = "Slettet bruker";
export const DELETED_MESSAGE_CONTENT = "Meldingen er slettet";
export const ACCOUNT_DELETED_REASON = "Konto slettet";
export const LAST_ADMIN_MESSAGE =
  "Du er den siste administratoren. Overfør rollen før du sletter kontoen.";

/** Synthetic, unique address that frees the real email for re-invitation. */
export function deletedEmailFor(userId: string): string {
  return `deleted+${userId}@deleted.invalid`;
}

/** What one `deleteAccount` run changed, per step. Logged, and handy in tests. */
export interface AccountDeletionSummary {
  tombstoned: boolean;
  invitationsDeleted: number;
  tenantProfilesUnlinked: number;
  apartmentsUnlinked: number;
  postsDeleted: number;
  commentsDeleted: number;
  likesRemoved: number;
  eventParticipationsRemoved: number;
  eventsCancelled: number;
  bookingsCancelled: number;
  bookingNotesCleared: number;
  groupsDeactivated: number;
  groupMembershipsRemoved: number;
  sharedItemsDeleted: number;
  borrowedItemsReleased: number;
  helpRequestsDeleted: number;
  helpRequestsReopened: number;
  messagesAnonymised: number;
  supportConversationsDeleted: number;
  s3ObjectsDeleted: number;
  s3Failures: number;
}

/**
 * Real account deletion for `DELETE /users/me` (Apple 5.1.1(v), GDPR art. 17).
 *
 * The user document becomes an anonymised tombstone (same `_id`, no personal
 * data, `isActive: false`), written first so the user is locked out at once.
 * The cascade then deletes, anonymises or unlinks the user's data collection
 * by collection. Every step matches on the user id and skips what is already
 * done, so running it again (e.g. after a crash) finishes the job.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Post.name) private readonly postModel: Model<PostDocument>,
    @InjectModel(Comment.name)
    private readonly commentModel: Model<CommentDocument>,
    @InjectModel(Event.name) private readonly eventModel: Model<EventDocument>,
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(Group.name) private readonly groupModel: Model<GroupDocument>,
    @InjectModel(SharedItem.name)
    private readonly sharedItemModel: Model<SharedItemDocument>,
    @InjectModel(HelpRequest.name)
    private readonly helpRequestModel: Model<HelpRequestDocument>,
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
    @InjectModel(Invitation.name)
    private readonly invitationModel: Model<InvitationDocument>,
    @InjectModel(TenantProfile.name)
    private readonly tenantProfileModel: Model<TenantProfileDocument>,
    @InjectModel(Apartment.name)
    private readonly apartmentModel: Model<ApartmentDocument>,
    private readonly eventsService: EventsService,
    private readonly bookingsService: BookingsService,
    private readonly notificationService: NotificationService,
    private readonly s3Service: S3Service,
  ) {}

  async deleteAccount(
    userId: string,
    organizationId: string,
  ): Promise<AccountDeletionSummary> {
    const user = await findInOrg(this.userModel, userId, organizationId, null, "User").exec();
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const orgOid = new Types.ObjectId(organizationId);
    const userOid = new Types.ObjectId(userId);
    const originalEmail = user.email;
    const alreadyDeleted = user.isDeleted === true;

    if (!alreadyDeleted) {
      await this.assertNotLastAdmin(user, orgOid, userOid);
      await this.writeTombstone(userOid, orgOid);
    }

    const summary: AccountDeletionSummary = {
      tombstoned: !alreadyDeleted,
      invitationsDeleted: 0,
      tenantProfilesUnlinked: 0,
      apartmentsUnlinked: 0,
      postsDeleted: 0,
      commentsDeleted: 0,
      likesRemoved: 0,
      eventParticipationsRemoved: 0,
      eventsCancelled: 0,
      bookingsCancelled: 0,
      bookingNotesCleared: 0,
      groupsDeactivated: 0,
      groupMembershipsRemoved: 0,
      sharedItemsDeleted: 0,
      borrowedItemsReleased: 0,
      helpRequestsDeleted: 0,
      helpRequestsReopened: 0,
      messagesAnonymised: 0,
      supportConversationsDeleted: 0,
      s3ObjectsDeleted: 0,
      s3Failures: 0,
    };

    // Needs the real address, which the tombstone has just replaced: on a
    // re-run it matches nothing (see the known limitation in the R2 plan).
    if (!alreadyDeleted) {
      await this.deleteInvitations(originalEmail, orgOid, summary);
    }
    await this.unlinkTenancy(userOid, orgOid, summary);
    await this.deletePostsAndComments(userOid, orgOid, summary);
    // Pull participation first: the organiser is auto-joined to their own
    // event, and the cancel path below notifies every remaining participant.
    await this.handleEvents(userId, userOid, organizationId, orgOid, summary);
    await this.handleBookings(userId, userOid, organizationId, orgOid, summary);
    await this.handleGroups(userOid, orgOid, summary);
    await this.handleSharedItems(userOid, orgOid, summary);
    await this.handleHelpRequests(userOid, orgOid, summary);
    await this.handleConversations(userId, userOid, orgOid, summary);
    await this.deleteS3Prefix(`public/avatars/${userId}/`, summary);
    // Last, so notifications the cancel paths above addressed to this user go too.
    // Notifications carry no organisation; the user id is globally unique.
    await this.notificationService.deleteAllNotifications(userOid);

    this.logger.log(
      `Account deleted: ${userId} (org ${organizationId}) ${JSON.stringify(summary)}`,
    );
    return summary;
  }

  /** 409 when the user is the org's last active admin. Writes nothing. */
  private async assertNotLastAdmin(
    user: UserDocument,
    orgOid: Types.ObjectId,
    userOid: Types.ObjectId,
  ): Promise<void> {
    if (!user.isActive || !isAdminRole(user.role)) return;
    const otherAdmins = await this.userModel.countDocuments({
      organizationId: orgOid,
      _id: { $ne: userOid },
      role: { $in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] },
      isActive: true,
      isDeleted: { $ne: true },
    });
    if (otherAdmins === 0) {
      throw new ConflictException(LAST_ADMIN_MESSAGE);
    }
  }

  /**
   * Keeps `_id`, `organizationId`, `createdAt` and `role`; clears every
   * personal field. One `updateOne`, so the password pre-save hook doesn't run
   * and the random password is hashed here instead.
   */
  private async writeTombstone(
    userOid: Types.ObjectId,
    orgOid: Types.ObjectId,
  ): Promise<void> {
    const unusablePassword = await bcrypt.hash(
      crypto.randomBytes(32).toString("hex"),
      10,
    );
    await this.userModel.updateOne(
      { _id: userOid, organizationId: orgOid },
      {
        $set: {
          name: DELETED_USER_NAME,
          email: deletedEmailFor(userOid.toString()),
          password: unusablePassword,
          isActive: false,
          isDeleted: true,
          deletedAt: new Date(),
          buildingIds: [],
          interests: [],
          helpfulSkills: [],
          isHelpfulNeighbor: false,
          emergencyContacts: [],
          pets: { hasPets: false, types: [] },
        },
        $unset: {
          phone: "",
          avatarUrl: "",
          avatarColor: "",
          dateOfBirth: "",
          unitNumber: "",
          building: "",
          primaryBuildingId: "",
          lastLoginAt: "",
          passwordResetToken: "",
          passwordResetExpires: "",
          setupToken: "",
          setupTokenExpires: "",
        },
      },
    );
  }

  /** Invitations sent to the user's address. Ones they sent as admin stay. */
  private async deleteInvitations(
    email: string,
    orgOid: Types.ObjectId,
    summary: AccountDeletionSummary,
  ): Promise<void> {
    if (!email) return;
    const result = await this.invitationModel.deleteMany({
      organizationId: orgOid,
      email: email.toLowerCase(),
    });
    summary.invitationsDeleted = result.deletedCount ?? 0;
  }

  /** The landlord's tenant register keeps the record; only the account link goes. */
  private async unlinkTenancy(
    userOid: Types.ObjectId,
    orgOid: Types.ObjectId,
    summary: AccountDeletionSummary,
  ): Promise<void> {
    const profiles = await this.tenantProfileModel.updateMany(
      { organizationId: orgOid, userId: userOid },
      {
        $set: { status: TenantProfileStatus.UNREGISTERED },
        $unset: { userId: "", invitationId: "" },
      },
    );
    summary.tenantProfilesUnlinked = profiles.modifiedCount ?? 0;

    const apartments = await this.apartmentModel.updateMany(
      { organizationId: orgOid, tenantIds: userOid },
      { $pull: { tenantIds: userOid } },
    );
    summary.apartmentsUnlinked = apartments.modifiedCount ?? 0;
  }

  private async deletePostsAndComments(
    userOid: Types.ObjectId,
    orgOid: Types.ObjectId,
    summary: AccountDeletionSummary,
  ): Promise<void> {
    // Their own posts, with every comment on them.
    const ownPostIds = await this.postModel.distinct("_id", {
      organizationId: orgOid,
      authorId: userOid,
    });
    if (ownPostIds.length > 0) {
      const comments = await this.commentModel.deleteMany({
        postId: { $in: ownPostIds },
      });
      summary.commentsDeleted += comments.deletedCount ?? 0;
      const posts = await this.postModel.deleteMany({
        _id: { $in: ownPostIds },
        organizationId: orgOid,
      });
      summary.postsDeleted = posts.deletedCount ?? 0;
    }

    // Their comments on other posts. Comments carry no organisation of their
    // own, so they are scoped through their post.
    const authored = await this.commentModel
      .find({ authorId: userOid })
      .select("_id postId parentCommentId")
      .lean()
      .exec();
    if (authored.length > 0) {
      const orgPostIds = await this.postModel.distinct("_id", {
        _id: { $in: [...new Set(authored.map((c) => String(c.postId)))] },
        organizationId: orgOid,
      });
      const inOrgPosts = new Set(orgPostIds.map(String));
      const mine = authored.filter((c) => inOrgPosts.has(String(c.postId)));
      if (mine.length > 0) {
        const commentIds = mine.map((c) => c._id);
        // A top-level comment takes its replies with it, as deleteComment does.
        const topLevelIds = mine
          .filter((c) => !c.parentCommentId)
          .map((c) => c._id);
        if (topLevelIds.length > 0) {
          const replies = await this.commentModel.deleteMany({
            parentCommentId: { $in: topLevelIds },
            postId: { $in: orgPostIds },
          });
          summary.commentsDeleted += replies.deletedCount ?? 0;
        }
        const own = await this.commentModel.deleteMany({
          _id: { $in: commentIds },
          authorId: userOid,
        });
        summary.commentsDeleted += own.deletedCount ?? 0;

        // Recount rather than decrement: exact, and safe to repeat.
        const affectedPostIds = [...new Set(mine.map((c) => String(c.postId)))];
        for (const postId of affectedPostIds) {
          const count = await this.commentModel.countDocuments({
            postId: new Types.ObjectId(postId),
          });
          await this.postModel.updateOne(
            { _id: new Types.ObjectId(postId), organizationId: orgOid },
            { $set: { commentsCount: count } },
          );
        }
      }
    }

    summary.likesRemoved = await this.pullFromArray(
      this.postModel,
      orgOid,
      userOid,
      "likes",
      "likesCount",
    );
  }

  private async handleEvents(
    userId: string,
    userOid: Types.ObjectId,
    organizationId: string,
    orgOid: Types.ObjectId,
    summary: AccountDeletionSummary,
  ): Promise<void> {
    summary.eventParticipationsRemoved = await this.pullFromArray(
      this.eventModel,
      orgOid,
      userOid,
      "participants",
      "participantsCount",
    );

    // Future events they organise: cancel through the normal path, which
    // notifies participants. Past events stay, with the tombstone as organiser.
    const futureEvents = await this.eventModel
      .find({
        organizationId: orgOid,
        organizerId: userOid,
        status: { $in: [EventStatus.UPCOMING, EventStatus.ONGOING] },
        startDate: { $gt: new Date() },
      })
      .select("_id")
      .lean()
      .exec();
    for (const event of futureEvents) {
      await this.eventsService.cancel(String(event._id), userId, organizationId);
      summary.eventsCancelled++;
    }
  }

  private async handleBookings(
    userId: string,
    userOid: Types.ObjectId,
    organizationId: string,
    orgOid: Types.ObjectId,
    summary: AccountDeletionSummary,
  ): Promise<void> {
    // Future pending/confirmed bookings: cancel through the normal path, which
    // frees the slot. Past bookings stay for the resource's history.
    const futureBookings = await this.bookingModel
      .find({
        organizationId: orgOid,
        userId: userOid,
        status: { $in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
        startDate: { $gt: new Date() },
      })
      .select("_id")
      .lean()
      .exec();
    for (const booking of futureBookings) {
      await this.bookingsService.cancel(
        String(booking._id),
        userId,
        organizationId,
        ACCOUNT_DELETED_REASON,
      );
      summary.bookingsCancelled++;
    }

    const notes = await this.bookingModel.updateMany(
      { organizationId: orgOid, userId: userOid, notes: { $exists: true } },
      { $unset: { notes: "" } },
    );
    summary.bookingNotesCleared = notes.modifiedCount ?? 0;
  }

  private async handleGroups(
    userOid: Types.ObjectId,
    orgOid: Types.ObjectId,
    summary: AccountDeletionSummary,
  ): Promise<void> {
    // A group they created and are the only member of goes the way of a
    // normal group delete (soft). Others keep their group.
    const sole = await this.groupModel.updateMany(
      {
        organizationId: orgOid,
        creatorId: userOid,
        isActive: true,
        members: { $not: { $elemMatch: { $ne: userOid } } },
      },
      { $set: { isActive: false } },
    );
    summary.groupsDeactivated = sole.modifiedCount ?? 0;

    summary.groupMembershipsRemoved = await this.pullFromArray(
      this.groupModel,
      orgOid,
      userOid,
      "members",
      "memberCount",
    );
  }

  private async handleSharedItems(
    userOid: Types.ObjectId,
    orgOid: Types.ObjectId,
    summary: AccountDeletionSummary,
  ): Promise<void> {
    const items = await this.sharedItemModel
      .find({ organizationId: orgOid, ownerId: userOid })
      .select("_id")
      .lean()
      .exec();
    // Images first: an item whose images could not be removed is kept so a
    // re-run can still find it.
    const removable: Types.ObjectId[] = [];
    for (const item of items) {
      const ok = await this.deleteS3Prefix(
        `public/sharing/items/${String(item._id)}/`,
        summary,
      );
      if (ok) removable.push(item._id as Types.ObjectId);
    }
    if (removable.length > 0) {
      const deleted = await this.sharedItemModel.deleteMany({
        _id: { $in: removable },
        organizationId: orgOid,
        ownerId: userOid,
      });
      summary.sharedItemsDeleted = deleted.deletedCount ?? 0;
    }

    const released = await this.sharedItemModel.updateMany(
      { organizationId: orgOid, borrowedBy: userOid },
      { $unset: { borrowedBy: "", borrowedAt: "" } },
    );
    summary.borrowedItemsReleased = released.modifiedCount ?? 0;
  }

  private async handleHelpRequests(
    userOid: Types.ObjectId,
    orgOid: Types.ObjectId,
    summary: AccountDeletionSummary,
  ): Promise<void> {
    const requested = await this.helpRequestModel.deleteMany({
      organizationId: orgOid,
      requesterId: userOid,
    });
    summary.helpRequestsDeleted = requested.deletedCount ?? 0;

    // Requests they accepted to help with go back to open, and the requester
    // hears about it. Completed ones keep the tombstone as helper.
    const accepted = await this.helpRequestModel
      .find({
        organizationId: orgOid,
        helperId: userOid,
        status: HelpRequestStatus.ACCEPTED,
      })
      .select("_id requesterId title")
      .lean()
      .exec();
    for (const request of accepted) {
      const result = await this.helpRequestModel.updateOne(
        {
          _id: request._id,
          organizationId: orgOid,
          helperId: userOid,
          status: HelpRequestStatus.ACCEPTED,
        },
        {
          $set: { status: HelpRequestStatus.OPEN },
          $unset: { helperId: "", acceptedAt: "" },
        },
      );
      if (!result.modifiedCount) continue;
      summary.helpRequestsReopened++;
      await this.notifyRequesterOfReopen(request, orgOid);
    }
  }

  private async notifyRequesterOfReopen(
    request: { _id: unknown; requesterId: unknown; title?: string },
    orgOid: Types.ObjectId,
  ): Promise<void> {
    const requester = await this.userModel
      .findOne({ _id: request.requesterId, organizationId: orgOid })
      .exec();
    if (!requester || requester.isDeleted) return;
    await this.notificationService
      .createNotification(
        String(requester._id),
        NotificationType.MESSAGE_RECEIVED,
        "Forespørselen er åpen igjen",
        `Hjelperen på «${request.title}» har slettet kontoen sin, så forespørselen er åpen igjen.`,
        `/sharing/help-requests/${String(request._id)}`,
        true,
        {
          _id: String(requester._id),
          email: requester.email,
          firstName: requester.name.split(" ")[0],
          lastName: requester.name.split(" ").slice(1).join(" ") || "",
        },
      )
      .catch((error) => {
        this.logger.error("Failed to notify requester of reopened help request", error);
      });
  }

  private async handleConversations(
    userId: string,
    userOid: Types.ObjectId,
    orgOid: Types.ObjectId,
    summary: AccountDeletionSummary,
  ): Promise<void> {
    // Support threads are about the deleted user: remove them entirely.
    const supportIds = await this.conversationModel.distinct("_id", {
      organizationId: orgOid,
      type: "support",
      participants: userOid,
    });
    if (supportIds.length > 0) {
      await this.messageModel.deleteMany({ conversationId: { $in: supportIds } });
      const deleted = await this.conversationModel.deleteMany({
        _id: { $in: supportIds },
        organizationId: orgOid,
      });
      summary.supportConversationsDeleted = deleted.deletedCount ?? 0;
    }

    // 1:1 threads stay for the partner; the deleted user's words don't.
    const directIds = await this.conversationModel.distinct("_id", {
      organizationId: orgOid,
      type: { $ne: "support" },
      participants: userOid,
    });
    if (directIds.length === 0) return;

    const anonymised = await this.messageModel.updateMany(
      {
        conversationId: { $in: directIds },
        senderId: userOid,
        content: { $ne: DELETED_MESSAGE_CONTENT },
      },
      { $set: { content: DELETED_MESSAGE_CONTENT } },
    );
    summary.messagesAnonymised = anonymised.modifiedCount ?? 0;

    for (const conversationId of directIds) {
      const latest = await this.messageModel
        .findOne({ conversationId })
        .sort({ createdAt: -1 })
        .select("senderId")
        .lean()
        .exec();
      const lastWasTheirs = latest && String(latest.senderId) === userId;
      await this.conversationModel.updateOne(
        { _id: conversationId, organizationId: orgOid },
        {
          ...(lastWasTheirs
            ? { $set: { lastMessagePreview: DELETED_MESSAGE_CONTENT } }
            : {}),
          $unset: { [`unreadCount.${userId}`]: "" },
        },
      );
    }
  }

  /**
   * `$pull` the user from an array field and resync its denormalised count, in
   * one pipeline update per collection. Matches only documents that still hold
   * the user, so a second run is a no-op. Returns the documents changed.
   */
  private async pullFromArray(
    model: Model<any>,
    orgOid: Types.ObjectId,
    userOid: Types.ObjectId,
    field: string,
    countField: string,
  ): Promise<number> {
    const result = await model.updateMany(
      { organizationId: orgOid, [field]: userOid },
      [
        {
          $set: {
            [field]: {
              $filter: { input: `$${field}`, cond: { $ne: ["$$this", userOid] } },
            },
          },
        },
        { $set: { [countField]: { $size: `$${field}` } } },
      ],
      { updatePipeline: true },
    );
    return result.modifiedCount ?? 0;
  }

  /** Never throws: a failed S3 delete is logged and counted. */
  private async deleteS3Prefix(
    prefix: string,
    summary: AccountDeletionSummary,
  ): Promise<boolean> {
    try {
      summary.s3ObjectsDeleted += await this.s3Service.deletePrefix(prefix);
      return true;
    } catch (error) {
      summary.s3Failures++;
      this.logger.error(`Failed to delete S3 prefix ${prefix}`, error);
      return false;
    }
  }
}
