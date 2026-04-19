import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
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
