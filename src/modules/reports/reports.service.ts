import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { EmailService } from '../../shared/services/email.service';
import { NotificationService, NotificationType } from '../../shared/services/notification.service';
import { Comment } from '../posts/schemas/comment.schema';
import { Post } from '../posts/schemas/post.schema';
import { Conversation } from '../messages/schemas/conversation.schema';
import { Message } from '../messages/schemas/message.schema';
import { Group } from '../groups/schemas/group.schema';
import { User, UserRole } from '../users/schemas/user.schema';
import { CreateReportDto } from './dto/create-report.dto';
import { REASON_LABELS, TYPE_LABELS } from './report-labels';
import { ReportTargetModels, resolveReportTarget } from './report-targets';
import { Report, ReportDocument, ReportStatus } from './schemas/report.schema';

export { REASON_LABELS, TYPE_LABELS };

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  private readonly targetModels: ReportTargetModels;

  constructor(
    @InjectModel(Report.name) private reportModel: Model<ReportDocument>,
    @InjectModel(Post.name) postModel: Model<Post>,
    @InjectModel(Comment.name) commentModel: Model<Comment>,
    @InjectModel(Message.name) messageModel: Model<Message>,
    @InjectModel(Conversation.name) conversationModel: Model<Conversation>,
    @InjectModel(Group.name) groupModel: Model<Group>,
    @InjectModel(User.name) private userModel: Model<User>,
    private readonly notificationService: NotificationService,
    private readonly emailService: EmailService,
  ) {
    this.targetModels = {
      post: postModel,
      comment: commentModel,
      message: messageModel,
      conversation: conversationModel,
      group: groupModel,
    };
  }

  async create(dto: CreateReportDto, reporter: CurrentUserData): Promise<{ report: ReportDocument; isNew: boolean }> {
    const orgId = reporter.organizationId;
    const target = await resolveReportTarget(this.targetModels, dto.targetType, dto.targetId, reporter, orgId);
    if (target.ownerId === reporter.userId) {
      throw new BadRequestException('You cannot report your own content');
    }
    const key = {
      organizationId: new Types.ObjectId(orgId),
      reporterId: new Types.ObjectId(reporter.userId),
      targetType: dto.targetType,
      targetId: new Types.ObjectId(dto.targetId),
    };
    const existing = await this.reportModel.findOne({ ...key, status: ReportStatus.OPEN }).exec();
    if (existing) return { report: existing, isNew: false };

    const report = await this.reportModel.create({
      ...key,
      targetOwnerId: target.ownerId ? new Types.ObjectId(target.ownerId) : undefined,
      excerpt: target.excerpt,
      webPath: target.webPath,
      reason: dto.reason,
      details: dto.details?.trim() || undefined,
    });
    this.logger.log(`Report ${report.id}: ${dto.targetType} ${dto.targetId} (${dto.reason}) in org ${orgId}`);
    await this.notifyStaff(report, reporter).catch((error) =>
      this.logger.warn(`Report ${report.id}: staff notification failed: ${error?.message ?? error}`),
    );
    return { report, isNew: true };
  }

  private async notifyStaff(report: ReportDocument, reporter: CurrentUserData): Promise<void> {
    const staff = (
      await this.userModel
        .find({
          organizationId: new Types.ObjectId(reporter.organizationId),
          role: { $in: [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.BOARD] },
          isActive: true,
          isDeleted: { $ne: true },
        })
        .select('name email')
        .exec()
    ).filter((s) => s._id.toString() !== reporter.userId);
    if (!staff.length) return;

    const message = `${TYPE_LABELS[report.targetType]} rapportert: ${REASON_LABELS[report.reason]}`;
    await this.notificationService
      .createBulkNotifications(
        staff.map((s) => s._id.toString()),
        NotificationType.SYSTEM,
        'Innhold er rapportert',
        message,
        report.webPath,
        false,
      )
      .catch((error) => this.logger.warn(`Report ${report.id}: in-app notification failed: ${error?.message ?? error}`));

    const reporterDoc = await this.userModel.findById(reporter.userId).select('name').exec();
    await this.emailService.sendContentReport(
      staff.map((s) => ({ email: s.email, name: s.name })),
      report,
      reporterDoc?.name ?? 'En beboer',
    );
  }
}
