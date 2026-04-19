import { Test } from '@nestjs/testing';
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

function mockModel(aggResult: any[] = []) {
  const bulkWrite = jest.fn().mockResolvedValue({ upsertedCount: 0, modifiedCount: 0 });
  return {
    aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(aggResult) }),
    find: jest.fn().mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue([]) }) }),
    bulkWrite,
  };
}

describe('StatsService.runDailySnapshot', () => {
  let service: StatsService;
  let dailyStatModel: ReturnType<typeof mockModel>;

  beforeEach(async () => {
    dailyStatModel = mockModel();

    const orgId = '507f1f77bcf86cd799439011';
    const buildingId = '507f1f77bcf86cd799439022';

    const organizationModel = {
      find: jest.fn().mockReturnValue({
        lean: () => ({ exec: jest.fn().mockResolvedValue([{ _id: orgId }]) }),
      }),
    };
    const buildingModel = {
      find: jest.fn().mockReturnValue({
        lean: () => ({
          exec: jest.fn().mockResolvedValue([{ _id: buildingId, organizationId: orgId }]),
        }),
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        StatsService,
        { provide: getModelToken(DailyStat.name), useValue: dailyStatModel },
        { provide: getModelToken(User.name), useValue: mockModel() },
        { provide: getModelToken(Post.name), useValue: mockModel() },
        { provide: getModelToken(Comment.name), useValue: mockModel() },
        { provide: getModelToken(Event.name), useValue: mockModel() },
        { provide: getModelToken(Booking.name), useValue: mockModel() },
        { provide: getModelToken(HelpRequest.name), useValue: mockModel() },
        { provide: getModelToken(Message.name), useValue: mockModel() },
        { provide: getModelToken(Conversation.name), useValue: mockModel() },
        { provide: getModelToken(Building.name), useValue: buildingModel },
        { provide: getModelToken(Organization.name), useValue: organizationModel },
      ],
    }).compile();

    service = module.get(StatsService);
  });

  it('writes a zero-row snapshot per (org, building|null) when no activity', async () => {
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
});
