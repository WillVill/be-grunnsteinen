import { BadRequestException, Logger } from '@nestjs/common';
import { Types } from 'mongoose';

jest.mock('../../shared/services/s3.service', () => ({ S3Service: class S3Service {} }));
jest.mock('./report-targets', () => ({ resolveReportTarget: jest.fn() }));

import { NotificationType } from '../../shared/services/notification.service';
import { UserRole } from '../users/schemas/user.schema';
import { resolveReportTarget } from './report-targets';
import { ReportsService } from './reports.service';
import { ReportReason, ReportStatus, ReportTargetType } from './schemas/report.schema';

const oid = () => new Types.ObjectId();

const query = (result: unknown) => {
  const q: any = {};
  for (const m of ['populate', 'select', 'sort', 'skip', 'limit', 'lean']) q[m] = jest.fn(() => q);
  q.exec = jest.fn().mockResolvedValue(result);
  q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return q;
};

describe('ReportsService.create', () => {
  const orgId = oid();
  const reporterId = oid();
  const ownerId = oid();
  const targetId = oid();
  const reporter: any = {
    userId: String(reporterId),
    email: 'r@example.com',
    role: 'resident',
    organizationId: String(orgId),
    buildingIds: [],
  };
  const dto: any = {
    targetType: ReportTargetType.POST,
    targetId: String(targetId),
    reason: ReportReason.HARASSMENT,
    details: '  litt mer  ',
  };
  const resolved = { ownerId: String(ownerId), excerpt: 'Tittel — Tekst', webPath: `/posts/${targetId}` };

  let reportModel: { findOne: jest.Mock; create: jest.Mock };
  let userModel: { find: jest.Mock; findById: jest.Mock };
  let notificationService: { createBulkNotifications: jest.Mock };
  let emailService: { sendContentReport: jest.Mock };
  let service: ReportsService;
  let saved: any;
  const staffA = { _id: oid(), email: 'a@example.com', name: 'A' };
  const staffB = { _id: oid(), email: 'b@example.com', name: 'B' };
  const reporterAsStaff = { _id: reporterId, email: 'r@example.com', name: 'R' };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    (resolveReportTarget as jest.Mock).mockReset().mockResolvedValue(resolved);
    saved = undefined;
    reportModel = {
      findOne: jest.fn().mockReturnValue(query(null)),
      create: jest.fn().mockImplementation(async (data) => (saved = { id: 'rep1', status: ReportStatus.OPEN, ...data })),
    };
    userModel = {
      find: jest.fn().mockReturnValue(query([staffA, reporterAsStaff, staffB])),
      findById: jest.fn().mockReturnValue(query({ name: 'Kari' })),
    };
    notificationService = { createBulkNotifications: jest.fn().mockResolvedValue([]) };
    emailService = { sendContentReport: jest.fn().mockResolvedValue(undefined) };
    const stub = {} as any;
    service = new ReportsService(
      reportModel as any,
      stub,
      stub,
      stub,
      stub,
      stub,
      userModel as any,
      notificationService as any,
      emailService as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('saves a new report and returns isNew', async () => {
    const result = await service.create(dto, reporter);
    expect(result).toEqual({ report: saved, isNew: true });
    expect(reportModel.create).toHaveBeenCalledWith({
      organizationId: orgId,
      reporterId,
      targetType: ReportTargetType.POST,
      targetId,
      targetOwnerId: ownerId,
      excerpt: 'Tittel — Tekst',
      webPath: `/posts/${targetId}`,
      reason: ReportReason.HARASSMENT,
      details: 'litt mer',
    });
  });

  it('rejects reporting your own content without saving or notifying', async () => {
    (resolveReportTarget as jest.Mock).mockResolvedValue({ ...resolved, ownerId: reporter.userId });
    await expect(service.create(dto, reporter)).rejects.toBeInstanceOf(BadRequestException);
    expect(reportModel.create).not.toHaveBeenCalled();
    expect(notificationService.createBulkNotifications).not.toHaveBeenCalled();
    expect(emailService.sendContentReport).not.toHaveBeenCalled();
  });

  it('returns an existing open report without creating or notifying', async () => {
    const existing = { id: 'old', status: ReportStatus.OPEN };
    reportModel.findOne.mockReturnValue(query(existing));
    await expect(service.create(dto, reporter)).resolves.toEqual({ report: existing, isNew: false });
    expect(reportModel.findOne).toHaveBeenCalledWith({
      organizationId: orgId,
      reporterId,
      targetType: ReportTargetType.POST,
      targetId,
      status: 'open',
    });
    expect(reportModel.create).not.toHaveBeenCalled();
    expect(notificationService.createBulkNotifications).not.toHaveBeenCalled();
    expect(emailService.sendContentReport).not.toHaveBeenCalled();
  });

  it('looks up active staff in the org and excludes the reporter', async () => {
    await service.create(dto, reporter);
    expect(userModel.find).toHaveBeenCalledWith({
      organizationId: orgId,
      role: { $in: [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.BOARD] },
      isActive: true,
      isDeleted: { $ne: true },
    });
    expect(notificationService.createBulkNotifications.mock.calls[0][0]).toEqual([String(staffA._id), String(staffB._id)]);
  });

  it('notifies staff in-app and by email', async () => {
    await service.create(dto, reporter);
    expect(notificationService.createBulkNotifications).toHaveBeenCalledWith(
      [String(staffA._id), String(staffB._id)],
      NotificationType.SYSTEM,
      'Innhold er rapportert',
      'Oppslag rapportert: Trakassering eller mobbing',
      `/posts/${targetId}`,
      false,
    );
    expect(emailService.sendContentReport).toHaveBeenCalledWith(
      [
        { email: 'a@example.com', name: 'A' },
        { email: 'b@example.com', name: 'B' },
      ],
      saved,
      'Kari',
    );
  });

  it('still resolves when notification and email fail, logging warnings', async () => {
    notificationService.createBulkNotifications.mockRejectedValue(new Error('push down'));
    emailService.sendContentReport.mockRejectedValue(new Error('smtp down'));
    await expect(service.create(dto, reporter)).resolves.toMatchObject({ isNew: true, report: { id: 'rep1' } });
    expect(Logger.prototype.warn).toHaveBeenCalledTimes(2);
  });
});
