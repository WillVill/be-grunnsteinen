jest.mock('uuid', () => ({ v4: () => 'uuid' }));
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { TasksService } from './tasks.service';
import { Booking } from '../bookings/schemas/booking.schema';
import { HelpRequest } from '../sharing/schemas/help-request.schema';
import { Notification } from '../notifications/schemas/notification.schema';
import { User } from '../users/schemas/user.schema';
import {
  NotificationService,
  NotificationType,
} from '../../shared/services/notification.service';
import { EventsService } from '../events/events.service';

describe('TasksService expired help requests', () => {
  const requesterId = new Types.ObjectId();
  const requestId = new Types.ObjectId();
  let service: TasksService;
  let createNotification: jest.Mock;
  let notificationCreate: jest.Mock;

  beforeEach(async () => {
    createNotification = jest.fn().mockResolvedValue({});
    notificationCreate = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: getModelToken(Booking.name), useValue: {} },
        {
          provide: getModelToken(HelpRequest.name),
          useValue: {
            find: jest.fn().mockResolvedValue([{ _id: requestId, requesterId, title: 'Vanne planter' }]),
          },
        },
        { provide: getModelToken(Notification.name), useValue: { create: notificationCreate } },
        { provide: getModelToken(User.name), useValue: { findById: jest.fn().mockResolvedValue({ _id: requesterId }) } },
        { provide: NotificationService, useValue: { createNotification } },
        { provide: EventsService, useValue: {} },
      ],
    }).compile();
    service = module.get(TasksService);
  });

  it('routes the 30-day reminder through NotificationService without email', async () => {
    await service.handleExpiredHelpRequests();

    expect(notificationCreate).not.toHaveBeenCalled();
    expect(createNotification).toHaveBeenCalledWith(
      requesterId,
      NotificationType.HELP_REQUEST,
      'Påminnelse om hjelpeforespørsel',
      expect.stringContaining('Vanne planter'),
      `/sharing/help-requests/${requestId}`,
      false,
    );
    expect(NotificationType.HELP_REQUEST).toBe('help-request');
  });
});
