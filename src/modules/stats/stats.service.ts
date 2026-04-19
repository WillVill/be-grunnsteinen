import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { DailyStat, DailyStatDocument } from './schemas/daily-stat.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Post, PostDocument } from '../posts/schemas/post.schema';
import { Comment, CommentDocument } from '../posts/schemas/comment.schema';
import { Event, EventDocument } from '../events/schemas/event.schema';
import { Booking, BookingDocument } from '../bookings/schemas/booking.schema';
import { HelpRequest, HelpRequestDocument } from '../sharing/schemas/help-request.schema';
import { Message, MessageDocument } from '../messages/schemas/message.schema';
import { Conversation, ConversationDocument } from '../messages/schemas/conversation.schema';
import { Building, BuildingDocument } from '../buildings/schemas/building.schema';
import { Organization, OrganizationDocument } from '../organizations/schemas/organization.schema';
import { osloDayBounds, osloDayStart, osloYmd } from './util/oslo-date';

type Counts = {
  newUsers: number;
  newPosts: number;
  newEvents: number;
  newBookings: number;
  newHelpRequests: number;
  newComments: number;
  newMessages: number;
};

const ZERO_COUNTS: Counts = {
  newUsers: 0, newPosts: 0, newEvents: 0, newBookings: 0,
  newHelpRequests: 0, newComments: 0, newMessages: 0,
};

function key(orgId: string, buildingId: string | null): string {
  return `${orgId}::${buildingId ?? 'null'}`;
}

@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);

  constructor(
    @InjectModel(DailyStat.name) private readonly dailyStatModel: Model<DailyStatDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Post.name) private readonly postModel: Model<PostDocument>,
    @InjectModel(Comment.name) private readonly commentModel: Model<CommentDocument>,
    @InjectModel(Event.name) private readonly eventModel: Model<EventDocument>,
    @InjectModel(Booking.name) private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(HelpRequest.name) private readonly helpRequestModel: Model<HelpRequestDocument>,
    @InjectModel(Message.name) private readonly messageModel: Model<MessageDocument>,
    @InjectModel(Conversation.name) private readonly conversationModel: Model<ConversationDocument>,
    @InjectModel(Building.name) private readonly buildingModel: Model<BuildingDocument>,
    @InjectModel(Organization.name) private readonly organizationModel: Model<OrganizationDocument>,
  ) {}

  @Cron('0 1 * * *', { timeZone: 'Europe/Oslo' })
  async handleDailySnapshotCron(): Promise<void> {
    const todayStart = osloDayStart(new Date());
    const yesterday = new Date(todayStart.getTime() - 1);
    this.logger.log(`Running daily stats snapshot for ${osloYmd(yesterday)}`);
    try {
      await this.runDailySnapshot(yesterday);
    } catch (error) {
      this.logger.error('Daily stats snapshot failed', error);
    }
  }

  /**
   * Write one daily stat row per (org, building|null) to `dailystats`.
   *
   * Contract: the org-wide row (buildingId: null) carries the TOTAL for the
   * organization for the day. Building rows partition the subset of records
   * tied to a specific building — they do NOT sum to the org-wide row because
   * org-wide records (isOrganizationWide: true, or messages, or users with no
   * primaryBuildingId) land only in the org-wide row.
   *
   * Idempotent — re-running for the same targetDate overwrites via upsert.
   */
  async runDailySnapshot(targetDate: Date): Promise<{ written: number }> {
    const { start, end } = osloDayBounds(targetDate);
    const bucketDate = osloDayStart(targetDate);

    const [
      newUsersAgg,
      newPostsAgg,
      newCommentsAgg,
      newEventsAgg,
      newBookingsAgg,
      newHelpAgg,
      newMessagesAgg,
      orgs,
      buildings,
    ] = await Promise.all([
      this.aggNewUsers(start, end),
      this.aggNewPosts(start, end),
      this.aggNewComments(start, end),
      this.aggNewEvents(start, end),
      this.aggNewBookings(start, end),
      this.aggNewHelpRequests(start, end),
      this.aggNewMessages(start, end),
      this.organizationModel.find({}, { _id: 1 }).lean().exec(),
      this.buildingModel.find({}, { _id: 1, organizationId: 1 }).lean().exec(),
    ]);

    // scopes: build the full set of (org, buildingId|null) pairs we need to write
    const scopes = new Map<string, { orgId: string; buildingId: string | null }>();
    for (const o of orgs) {
      const orgId = String(o._id);
      scopes.set(key(orgId, null), { orgId, buildingId: null });
    }
    for (const b of buildings) {
      const orgId = String(b.organizationId);
      const buildingId = String(b._id);
      scopes.set(key(orgId, buildingId), { orgId, buildingId });
    }

    // counts: seeded with zeros for every scope, then deltas applied
    const counts = new Map<string, Counts>();
    for (const k of scopes.keys()) counts.set(k, { ...ZERO_COUNTS });

    const apply = (
      rows: Array<{ organizationId: unknown; buildingId: unknown; count: number }>,
      field: keyof Counts,
      splitOrgWide: boolean,
    ) => {
      for (const r of rows) {
        const orgId = String(r.organizationId);
        const buildingId = r.buildingId ? String(r.buildingId) : null;

        if (splitOrgWide) {
          // Building row (if any)
          if (buildingId) {
            const k = key(orgId, buildingId);
            if (!counts.has(k)) {
              scopes.set(k, { orgId, buildingId });
              counts.set(k, { ...ZERO_COUNTS });
            }
            counts.get(k)![field] += r.count;
          }
          // Org-wide row always gets +count as well
          const ok = key(orgId, null);
          if (!counts.has(ok)) {
            scopes.set(ok, { orgId, buildingId: null });
            counts.set(ok, { ...ZERO_COUNTS });
          }
          counts.get(ok)![field] += r.count;
        } else {
          // Pre-grouped as org-wide only (messages) — always buildingId: null
          const ok = key(orgId, null);
          if (!counts.has(ok)) {
            scopes.set(ok, { orgId, buildingId: null });
            counts.set(ok, { ...ZERO_COUNTS });
          }
          counts.get(ok)![field] += r.count;
        }
      }
    };

    apply(newUsersAgg, 'newUsers', true);
    apply(newPostsAgg, 'newPosts', true);
    apply(newCommentsAgg, 'newComments', true);
    apply(newEventsAgg, 'newEvents', true);
    apply(newBookingsAgg, 'newBookings', true);
    apply(newHelpAgg, 'newHelpRequests', true);
    apply(newMessagesAgg, 'newMessages', false);

    const ops = Array.from(scopes.entries()).map(([k, scope]) => ({
      updateOne: {
        filter: {
          organizationId: new Types.ObjectId(scope.orgId),
          buildingId: scope.buildingId ? new Types.ObjectId(scope.buildingId) : null,
          date: bucketDate,
        },
        update: { $set: { ...counts.get(k)! } },
        upsert: true,
      },
    }));

    if (ops.length === 0) return { written: 0 };

    await this.dailyStatModel.bulkWrite(ops);
    this.logger.log(`Wrote ${ops.length} daily-stat rows for ${bucketDate.toISOString()}`);
    return { written: ops.length };
  }

  private aggNewUsers(start: Date, end: Date) {
    return this.userModel.aggregate<{ organizationId: unknown; buildingId: unknown; count: number }>([
      { $match: { createdAt: { $gte: start, $lt: end } } },
      {
        $group: {
          _id: { organizationId: '$organizationId', buildingId: '$primaryBuildingId' },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          organizationId: '$_id.organizationId',
          buildingId: '$_id.buildingId',
          count: 1,
        },
      },
    ]).exec();
  }

  private aggNewPosts(start: Date, end: Date) {
    return this.groupByOrgBuilding(this.postModel, start, end);
  }

  private aggNewEvents(start: Date, end: Date) {
    return this.groupByOrgBuilding(this.eventModel, start, end);
  }

  private aggNewBookings(start: Date, end: Date) {
    return this.groupByOrgBuilding(this.bookingModel, start, end);
  }

  private aggNewHelpRequests(start: Date, end: Date) {
    return this.groupByOrgBuilding(this.helpRequestModel, start, end);
  }

  private aggNewComments(start: Date, end: Date) {
    // Comments have no organizationId/buildingId — lookup parent post for both.
    // Collapse org-wide posts' comments to buildingId: null.
    return this.commentModel.aggregate<{ organizationId: unknown; buildingId: unknown; count: number }>([
      { $match: { createdAt: { $gte: start, $lt: end } } },
      {
        $lookup: {
          from: 'posts',
          localField: 'postId',
          foreignField: '_id',
          as: 'post',
        },
      },
      { $unwind: '$post' },
      {
        $group: {
          _id: {
            organizationId: '$post.organizationId',
            buildingId: {
              $cond: [{ $eq: ['$post.isOrganizationWide', true] }, null, '$post.buildingId'],
            },
          },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          organizationId: '$_id.organizationId',
          buildingId: '$_id.buildingId',
          count: 1,
        },
      },
    ]).exec();
  }

  private aggNewMessages(start: Date, end: Date) {
    // Messages have no organizationId — lookup conversation. No building dimension.
    return this.messageModel.aggregate<{ organizationId: unknown; buildingId: null; count: number }>([
      { $match: { createdAt: { $gte: start, $lt: end } } },
      {
        $lookup: {
          from: 'conversations',
          localField: 'conversationId',
          foreignField: '_id',
          as: 'conv',
        },
      },
      { $unwind: '$conv' },
      {
        $group: { _id: '$conv.organizationId', count: { $sum: 1 } },
      },
      {
        $project: { _id: 0, organizationId: '$_id', buildingId: { $literal: null }, count: 1 },
      },
    ]).exec();
  }

  private groupByOrgBuilding(model: Model<any>, start: Date, end: Date) {
    // Collapse isOrganizationWide records to buildingId: null so they are
    // counted only in the org-wide row, never in any building row.
    return model.aggregate<{ organizationId: unknown; buildingId: unknown; count: number }>([
      { $match: { createdAt: { $gte: start, $lt: end } } },
      {
        $group: {
          _id: {
            organizationId: '$organizationId',
            buildingId: {
              $cond: [{ $eq: ['$isOrganizationWide', true] }, null, '$buildingId'],
            },
          },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          organizationId: '$_id.organizationId',
          buildingId: '$_id.buildingId',
          count: 1,
        },
      },
    ]).exec();
  }
}
