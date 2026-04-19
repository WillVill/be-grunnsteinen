import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { StatsService } from './stats.service';
import { DailyStat } from './schemas/daily-stat.schema';
import { User } from '../users/schemas/user.schema';
import { Post } from '../posts/schemas/post.schema';
import { Comment } from '../posts/schemas/comment.schema';
import { Event } from '../events/schemas/event.schema';
import { Booking } from '../bookings/schemas/booking.schema';
import { HelpRequest } from '../sharing/schemas/help-request.schema';
import { Message } from '../messages/schemas/message.schema';
import { Conversation } from '../messages/schemas/conversation.schema';
import { Building } from '../buildings/schemas/building.schema';
import { Organization } from '../organizations/schemas/organization.schema';

const orgId = '507f1f77bcf86cd799439011';
const buildingId = '507f1f77bcf86cd799439022';
// Real ObjectId instances so new Types.ObjectId(orgId) in the service doesn't throw
const orgObjectId = new Types.ObjectId(orgId);
const buildingObjectId = new Types.ObjectId(buildingId);

function mockModel(aggResult: any[] = []) {
  const bulkWrite = jest.fn().mockResolvedValue({ upsertedCount: 0, modifiedCount: 0 });
  return {
    aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(aggResult) }),
    find: jest.fn().mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue([]) }) }),
    bulkWrite,
  };
}

function makeOrganizationModel() {
  return {
    find: jest.fn().mockReturnValue({
      lean: () => ({ exec: jest.fn().mockResolvedValue([{ _id: orgId }]) }),
    }),
  };
}

function makeBuildingModel() {
  return {
    find: jest.fn().mockReturnValue({
      lean: () => ({
        exec: jest.fn().mockResolvedValue([{ _id: buildingId, organizationId: orgId }]),
      }),
    }),
  };
}

async function buildModule(overrides: {
  userModel?: ReturnType<typeof mockModel>;
  postModel?: ReturnType<typeof mockModel>;
  commentModel?: ReturnType<typeof mockModel>;
  eventModel?: ReturnType<typeof mockModel>;
  bookingModel?: ReturnType<typeof mockModel>;
  helpRequestModel?: ReturnType<typeof mockModel>;
  messageModel?: ReturnType<typeof mockModel>;
  conversationModel?: ReturnType<typeof mockModel>;
  dailyStatModel?: ReturnType<typeof mockModel>;
} = {}): Promise<{ module: TestingModule; dailyStatModel: ReturnType<typeof mockModel> }> {
  const daily = overrides.dailyStatModel ?? mockModel();

  const module = await Test.createTestingModule({
    providers: [
      StatsService,
      { provide: getModelToken(DailyStat.name), useValue: daily },
      { provide: getModelToken(User.name), useValue: overrides.userModel ?? mockModel() },
      { provide: getModelToken(Post.name), useValue: overrides.postModel ?? mockModel() },
      { provide: getModelToken(Comment.name), useValue: overrides.commentModel ?? mockModel() },
      { provide: getModelToken(Event.name), useValue: overrides.eventModel ?? mockModel() },
      { provide: getModelToken(Booking.name), useValue: overrides.bookingModel ?? mockModel() },
      { provide: getModelToken(HelpRequest.name), useValue: overrides.helpRequestModel ?? mockModel() },
      { provide: getModelToken(Message.name), useValue: overrides.messageModel ?? mockModel() },
      { provide: getModelToken(Conversation.name), useValue: overrides.conversationModel ?? mockModel() },
      { provide: getModelToken(Building.name), useValue: makeBuildingModel() },
      { provide: getModelToken(Organization.name), useValue: makeOrganizationModel() },
    ],
  }).compile();

  return { module, dailyStatModel: daily };
}

describe('StatsService.runDailySnapshot', () => {
  it('writes a zero-row snapshot per (org, building|null) when no activity', async () => {
    const { module, dailyStatModel } = await buildModule();
    const service = module.get(StatsService);

    await service.runDailySnapshot(new Date('2026-04-18T12:00:00Z'));

    expect(dailyStatModel.bulkWrite).toHaveBeenCalledTimes(1);
    const ops = dailyStatModel.bulkWrite.mock.calls[0][0];
    // One org, one building → two rows: building-row + null-row
    expect(ops).toHaveLength(2);
    for (const op of ops) {
      expect(op.updateOne.upsert).toBe(true);
      expect(op.updateOne.update.$set).toMatchObject({
        newUsers: 0, newPosts: 0, newEvents: 0, newBookings: 0,
        newHelpRequests: 0, newComments: 0, newMessages: 0,
      });
    }
    const filters = ops.map((o: any) => o.updateOne.filter);
    expect(filters.some((f: any) => f.buildingId === null)).toBe(true);
    expect(filters.some((f: any) => f.buildingId !== null)).toBe(true);
  });

  it('Test A: building-scoped posts land in both the building row and the org-wide row', async () => {
    // postModel returns one row tied to the known building
    const postModel = mockModel([{ organizationId: orgId, buildingId: buildingId, count: 5 }]);
    const { module, dailyStatModel } = await buildModule({ postModel });
    const service = module.get(StatsService);

    await service.runDailySnapshot(new Date('2026-04-18T12:00:00Z'));

    const ops: any[] = dailyStatModel.bulkWrite.mock.calls[0][0];
    const buildingOp = ops.find(
      (o: any) => o.updateOne.filter.buildingId !== null,
    );
    const orgWideOp = ops.find(
      (o: any) => o.updateOne.filter.buildingId === null,
    );

    // Double-entry: building row receives count directly; org-wide row also accumulates it
    expect(buildingOp.updateOne.update.$set.newPosts).toBe(5);
    expect(orgWideOp.updateOne.update.$set.newPosts).toBe(5);
  });

  it('Test B: org-wide posts (buildingId null from $cond collapse) land only in org-wide row', async () => {
    // postModel returns a row with buildingId null (isOrganizationWide collapsed)
    const postModel = mockModel([{ organizationId: orgId, buildingId: null, count: 3 }]);
    const { module, dailyStatModel } = await buildModule({ postModel });
    const service = module.get(StatsService);

    await service.runDailySnapshot(new Date('2026-04-18T12:00:00Z'));

    const ops: any[] = dailyStatModel.bulkWrite.mock.calls[0][0];
    const buildingOp = ops.find(
      (o: any) => o.updateOne.filter.buildingId !== null,
    );
    const orgWideOp = ops.find(
      (o: any) => o.updateOne.filter.buildingId === null,
    );

    // Only org-wide row gets the count; building row stays at zero
    expect(orgWideOp.updateOne.update.$set.newPosts).toBe(3);
    expect(buildingOp.updateOne.update.$set.newPosts).toBe(0);
  });

  it('Test C: messages (no building dimension) route to org-wide row only', async () => {
    // messageModel always returns buildingId null — no building dimension
    const messageModel = mockModel([{ organizationId: orgId, buildingId: null, count: 7 }]);
    const { module, dailyStatModel } = await buildModule({ messageModel });
    const service = module.get(StatsService);

    await service.runDailySnapshot(new Date('2026-04-18T12:00:00Z'));

    const ops: any[] = dailyStatModel.bulkWrite.mock.calls[0][0];
    const buildingOp = ops.find(
      (o: any) => o.updateOne.filter.buildingId !== null,
    );
    const orgWideOp = ops.find(
      (o: any) => o.updateOne.filter.buildingId === null,
    );

    // Messages use splitOrgWide=false → only org-wide row accumulates
    expect(orgWideOp.updateOne.update.$set.newMessages).toBe(7);
    expect(buildingOp.updateOne.update.$set.newMessages).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Helper: build a dailyStatModel that supports the find().sort().lean().exec()
// chain used by getRange, returning the supplied snapshot rows.
// ---------------------------------------------------------------------------
function makeDailyStatModelForRange(snapshots: any[]) {
  const exec = jest.fn().mockResolvedValue(snapshots);
  const lean = jest.fn().mockReturnValue({ exec });
  const sort = jest.fn().mockReturnValue({ lean });
  const find = jest.fn().mockReturnValue({ sort });
  const bulkWrite = jest.fn().mockResolvedValue({ upsertedCount: 0, modifiedCount: 0 });
  const aggregate = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
  return { find, sort, lean, exec, bulkWrite, aggregate };
}

// Helper: build a source model that supports countDocuments (returning n) and
// aggregate().exec() returning [{n: aggN}].
function makeSourceModel(countResult: number, aggResult: number) {
  return {
    countDocuments: jest.fn().mockResolvedValue(countResult),
    aggregate: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(aggResult > 0 ? [{ n: aggResult }] : []),
    }),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) }),
    }),
    bulkWrite: jest.fn().mockResolvedValue({ upsertedCount: 0, modifiedCount: 0 }),
  };
}

describe('StatsService.getRange', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('past-only range returns snapshots, zero-fills missing days, and no isLive flag', async () => {
    // Stub "today" to be 2026-04-19 in Oslo (UTC noon is unambiguously 2026-04-19 in Oslo, UTC+2)
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-19T10:00:00Z'));

    // Snapshots exist only for 2026-04-01 and 2026-04-03; 2026-04-02 is missing
    const snapshot01 = {
      date: new Date('2026-03-31T22:00:00Z'), // Oslo midnight 2026-04-01
      newUsers: 2, newPosts: 3, newEvents: 1, newBookings: 0,
      newHelpRequests: 0, newComments: 5, newMessages: 4,
    };
    const snapshot03 = {
      date: new Date('2026-04-02T22:00:00Z'), // Oslo midnight 2026-04-03
      newUsers: 1, newPosts: 1, newEvents: 0, newBookings: 2,
      newHelpRequests: 1, newComments: 3, newMessages: 2,
    };

    const dailyStat = makeDailyStatModelForRange([snapshot01, snapshot03]);

    // All source models return zeros (range is past-only, computeLiveToday won't be called)
    const zeroSourceModel = makeSourceModel(0, 0);

    const module = await Test.createTestingModule({
      providers: [
        StatsService,
        { provide: getModelToken(DailyStat.name), useValue: dailyStat },
        { provide: getModelToken(User.name), useValue: zeroSourceModel },
        { provide: getModelToken(Post.name), useValue: zeroSourceModel },
        { provide: getModelToken(Comment.name), useValue: zeroSourceModel },
        { provide: getModelToken(Event.name), useValue: zeroSourceModel },
        { provide: getModelToken(Booking.name), useValue: zeroSourceModel },
        { provide: getModelToken(HelpRequest.name), useValue: zeroSourceModel },
        { provide: getModelToken(Message.name), useValue: zeroSourceModel },
        { provide: getModelToken(Conversation.name), useValue: zeroSourceModel },
        { provide: getModelToken(Building.name), useValue: makeBuildingModel() },
        { provide: getModelToken(Organization.name), useValue: makeOrganizationModel() },
      ],
    }).compile();

    const service = module.get(StatsService);
    const result = await service.getRange(orgId, '2026-04-01', '2026-04-03', undefined);

    // Should have exactly 3 days
    expect(result.days).toHaveLength(3);

    // Days must be sorted ascending
    expect(result.days[0].date).toBe('2026-04-01');
    expect(result.days[1].date).toBe('2026-04-02');
    expect(result.days[2].date).toBe('2026-04-03');

    // 2026-04-02 was missing from snapshots → zero-filled, no isLive
    const missingDay = result.days[1];
    expect(missingDay.date).toBe('2026-04-02');
    expect(missingDay.newUsers).toBe(0);
    expect(missingDay.newPosts).toBe(0);
    expect(missingDay.newEvents).toBe(0);
    expect(missingDay.newBookings).toBe(0);
    expect(missingDay.newHelpRequests).toBe(0);
    expect(missingDay.newComments).toBe(0);
    expect(missingDay.newMessages).toBe(0);
    expect(missingDay.isLive).toBeUndefined();

    // None of the three days should have isLive: true (all past)
    for (const day of result.days) {
      expect(day.isLive).not.toBe(true);
    }

    // totals.newPosts should be the sum across all three days (3 + 0 + 1 = 4)
    expect(result.totals.newPosts).toBe(snapshot01.newPosts + 0 + snapshot03.newPosts);
  });

  it('range ending today merges snapshots with a live today row (isLive: true)', async () => {
    // Stub "today" to be 2026-04-19 in Oslo
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-19T10:00:00Z'));

    // Snapshots for 2026-04-17 and 2026-04-18 (both past)
    const snapshot17 = {
      date: new Date('2026-04-16T22:00:00Z'), // Oslo midnight 2026-04-17
      newUsers: 1, newPosts: 2, newEvents: 0, newBookings: 1,
      newHelpRequests: 0, newComments: 3, newMessages: 5,
    };
    const snapshot18 = {
      date: new Date('2026-04-17T22:00:00Z'), // Oslo midnight 2026-04-18
      newUsers: 2, newPosts: 4, newEvents: 1, newBookings: 0,
      newHelpRequests: 2, newComments: 6, newMessages: 8,
    };

    const dailyStat = makeDailyStatModelForRange([snapshot17, snapshot18]);

    // Live-today values returned by mocked source models
    const liveUsers = 3;
    const livePosts = 5;
    const liveEvents = 2;
    const liveBookings = 1;
    const liveHelpRequests = 1;
    const liveComments = 7; // via aggregate returning [{n: 7}]
    const liveMessages = 4; // via aggregate returning [{n: 4}]

    const userModel = makeSourceModel(liveUsers, 0);
    const postModel = makeSourceModel(livePosts, 0);
    const eventModel = makeSourceModel(liveEvents, 0);
    const bookingModel = makeSourceModel(liveBookings, 0);
    const helpRequestModel = makeSourceModel(liveHelpRequests, 0);
    const commentModel = makeSourceModel(0, liveComments);
    const messageModel = makeSourceModel(0, liveMessages);

    const module = await Test.createTestingModule({
      providers: [
        StatsService,
        { provide: getModelToken(DailyStat.name), useValue: dailyStat },
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(Post.name), useValue: postModel },
        { provide: getModelToken(Comment.name), useValue: commentModel },
        { provide: getModelToken(Event.name), useValue: eventModel },
        { provide: getModelToken(Booking.name), useValue: bookingModel },
        { provide: getModelToken(HelpRequest.name), useValue: helpRequestModel },
        { provide: getModelToken(Message.name), useValue: messageModel },
        { provide: getModelToken(Conversation.name), useValue: makeSourceModel(0, 0) },
        { provide: getModelToken(Building.name), useValue: makeBuildingModel() },
        { provide: getModelToken(Organization.name), useValue: makeOrganizationModel() },
      ],
    }).compile();

    const service = module.get(StatsService);
    // Range: 2026-04-17 through 2026-04-19 (today)
    const result = await service.getRange(orgId, '2026-04-17', '2026-04-19', undefined);

    // Should have exactly 3 days
    expect(result.days).toHaveLength(3);

    // Last row should be today with isLive: true
    const liveDay = result.days[2];
    expect(liveDay.date).toBe('2026-04-19');
    expect(liveDay.isLive).toBe(true);

    // Live row counts should match what our mocks returned
    expect(liveDay.newUsers).toBe(liveUsers);
    expect(liveDay.newPosts).toBe(livePosts);
    expect(liveDay.newEvents).toBe(liveEvents);
    expect(liveDay.newBookings).toBe(liveBookings);
    expect(liveDay.newHelpRequests).toBe(liveHelpRequests);
    expect(liveDay.newComments).toBe(liveComments);
    expect(liveDay.newMessages).toBe(liveMessages);

    // totals should include the live row
    const expectedTotalPosts = snapshot17.newPosts + snapshot18.newPosts + livePosts;
    expect(result.totals.newPosts).toBe(expectedTotalPosts);

    const expectedTotalUsers = snapshot17.newUsers + snapshot18.newUsers + liveUsers;
    expect(result.totals.newUsers).toBe(expectedTotalUsers);
  });
});
