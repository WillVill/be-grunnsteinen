import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as sgMail from "@sendgrid/mail";

// Interfaces for email context (will be replaced with actual types later)
export interface EmailUser {
  _id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface EmailOrganization {
  _id: string;
  name: string;
}

export interface EmailBooking {
  _id: string;
  resource: { name: string };
  startTime: Date;
  endTime: Date;
}

export interface EmailEvent {
  _id: string;
  title: string;
  startDate: Date;
  location?: string;
}

export interface EmailPost {
  _id: string;
  title: string;
  content: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly isConfigured: boolean = false;
  private readonly fromEmail: string;
  private readonly fromName: string;
  private readonly frontendUrl: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("sendgrid.apiKey");
    if (apiKey) {
      sgMail.setApiKey(apiKey);
      this.isConfigured = true;
    }
    this.fromEmail = this.configService.get<string>("sendgrid.fromEmail");
    this.fromName = this.configService.get<string>("sendgrid.fromName");
    this.frontendUrl = this.configService.get<string>("frontendUrl");
  }

  /**
   * Send a single email via SendGrid
   */
  async sendEmail(
    to: string,
    subject: string,
    html: string,
    text?: string,
    attachments?: { content: string; filename: string; type: string }[],
  ): Promise<void> {
    if (!this.isConfigured) {
      this.logger.warn(
        `Email not sent to ${to}: SendGrid client not configured`,
      );
      return;
    }
    try {
      const from = this.fromName
        ? { name: this.fromName, email: this.fromEmail }
        : this.fromEmail;

      await sgMail.send({
        to,
        from,
        subject,
        html,
        text: text || this.stripHtml(html),
        ...(attachments?.length && {
          attachments: attachments.map((a) => ({
            filename: a.filename,
            content: a.content,
            type: a.type,
            disposition: "attachment" as const,
          })),
        }),
      });
      this.logger.log(`Email sent to ${to}: ${subject}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}`, error);
      throw error;
    }
  }

  /**
   * Send email using SendGrid dynamic template
   */
  async sendTemplateEmail(
    to: string,
    templateId: string,
    dynamicData: Record<string, unknown>,
  ): Promise<void> {
    if (!this.isConfigured) {
      this.logger.warn(
        `Template email not sent to ${to}: SendGrid client not configured`,
      );
      return;
    }
    try {
      const from = this.fromName
        ? { name: this.fromName, email: this.fromEmail }
        : this.fromEmail;

      await sgMail.send({
        to,
        from,
        templateId,
        dynamicTemplateData: dynamicData,
      });
      this.logger.log(`Template email sent to ${to}: ${templateId}`);
    } catch (error) {
      this.logger.error(`Failed to send template email to ${to}`, error);
      throw error;
    }
  }

  /**
   * Send welcome email to new user
   */
  async sendWelcomeEmail(
    user: EmailUser,
    organization: EmailOrganization,
  ): Promise<void> {
    const subject = `Welcome to ${organization.name} on Heime!`;
    const html = this.getEmailTemplate(
      `
      <h1>Welcome to Heime, ${user.firstName}!</h1>
      <p>You've successfully joined <strong>${organization.name}</strong>.</p>
      <p>With Heime, you can:</p>
      <ul>
        <li>Book shared resources and facilities</li>
        <li>Stay updated on community events</li>
        <li>Connect with your neighbors</li>
        <li>Access important documents and announcements</li>
      </ul>
      <p>
        <a href="${this.frontendUrl}/dashboard" class="button">Go to Dashboard</a>
      </p>
      <p>If you have any questions, feel free to reach out to your community administrators.</p>
    `,
      user,
    );

    await this.sendEmail(user.email, subject, html);
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(
    user: EmailUser,
    resetToken: string,
  ): Promise<void> {
    const resetLink = `${this.frontendUrl}/auth/reset-password?token=${resetToken}`;
    const subject = "Reset Your Heime Password";
    const html = this.getEmailTemplate(
      `
      <h1>Password Reset Request</h1>
      <p>Hi ${user.firstName},</p>
      <p>We received a request to reset your password. Click the button below to create a new password:</p>
      <p>
        <a href="${resetLink}" class="button">Reset Password</a>
      </p>
      <p>This link will expire in 1 hour.</p>
      <p>If you didn't request a password reset, you can safely ignore this email. Your password won't be changed.</p>
      <p style="font-size: 12px; color: #666;">
        If the button doesn't work, copy and paste this link into your browser:<br>
        <a href="${resetLink}">${resetLink}</a>
      </p>
    `,
      user,
    );

    await this.sendEmail(user.email, subject, html);
  }

  /**
   * Send booking confirmation email
   */
  async sendBookingConfirmation(
    user: EmailUser,
    booking: EmailBooking,
  ): Promise<void> {
    const subject = `Booking Confirmed: ${booking.resource.name}`;
    const html = this.getEmailTemplate(
      `
      <h1>Booking Confirmed!</h1>
      <p>Hi ${user.firstName},</p>
      <p>Your booking has been confirmed:</p>
      <div class="info-box">
        <p><strong>Resource:</strong> ${booking.resource.name}</p>
        <p><strong>Date:</strong> ${this.formatDate(booking.startTime)}</p>
        <p><strong>Time:</strong> ${this.formatTime(booking.startTime)} - ${this.formatTime(booking.endTime)}</p>
      </div>
      <p>
        <a href="${this.frontendUrl}/bookings/${booking._id}" class="button">View Booking</a>
      </p>
      <p>Need to make changes? You can manage your booking from the link above.</p>
    `,
      user,
    );

    await this.sendEmail(user.email, subject, html);
  }

  /**
   * Send booking cancellation email
   */
  async sendBookingCancellation(
    user: EmailUser,
    booking: EmailBooking,
  ): Promise<void> {
    const subject = `Booking Cancelled: ${booking.resource.name}`;
    const html = this.getEmailTemplate(
      `
      <h1>Booking Cancelled</h1>
      <p>Hi ${user.firstName},</p>
      <p>Your booking has been cancelled:</p>
      <div class="info-box">
        <p><strong>Resource:</strong> ${booking.resource.name}</p>
        <p><strong>Date:</strong> ${this.formatDate(booking.startTime)}</p>
        <p><strong>Time:</strong> ${this.formatTime(booking.startTime)} - ${this.formatTime(booking.endTime)}</p>
      </div>
      <p>
        <a href="${this.frontendUrl}/resources" class="button">Book Another Time</a>
      </p>
    `,
      user,
    );

    await this.sendEmail(user.email, subject, html);
  }

  /**
   * Send event reminder email
   */
  async sendEventReminder(user: EmailUser, event: EmailEvent): Promise<void> {
    const subject = `Reminder: ${event.title} is coming up!`;
    const html = this.getEmailTemplate(
      `
      <h1>Event Reminder</h1>
      <p>Hi ${user.firstName},</p>
      <p>Don't forget about the upcoming event:</p>
      <div class="info-box">
        <p><strong>Event:</strong> ${event.title}</p>
        <p><strong>Date:</strong> ${this.formatDate(event.startDate)}</p>
        <p><strong>Time:</strong> ${this.formatTime(event.startDate)}</p>
        ${event.location ? `<p><strong>Location:</strong> ${event.location}</p>` : ""}
      </div>
      <p>
        <a href="${this.frontendUrl}/events/${event._id}" class="button">View Event Details</a>
      </p>
    `,
      user,
    );

    await this.sendEmail(user.email, subject, html);
  }

  /**
   * Send new message notification
   */
  async sendNewMessageNotification(
    user: EmailUser,
    sender: EmailUser,
  ): Promise<void> {
    const subject = `New message from ${sender.firstName} ${sender.lastName}`;
    const html = this.getEmailTemplate(
      `
      <h1>You've Got a New Message</h1>
      <p>Hi ${user.firstName},</p>
      <p><strong>${sender.firstName} ${sender.lastName}</strong> sent you a message.</p>
      <p>
        <a href="${this.frontendUrl}/messages" class="button">Read Message</a>
      </p>
    `,
      user,
    );

    await this.sendEmail(user.email, subject, html);
  }

  /**
   * Send building invite email with signup link
   */
  async sendInviteEmail(
    toEmail: string,
    organizationName: string,
    buildingName: string,
    inviteLink: string,
  ): Promise<void> {
    const subject = `You're invited to join ${organizationName} – ${buildingName}`;
    const fakeUser: EmailUser = {
      _id: "",
      email: toEmail,
      firstName: "",
      lastName: "",
    };
    const html = this.getEmailTemplate(
      `
      <h1>You're invited!</h1>
      <p>You have been invited to join <strong>${organizationName}</strong> at <strong>${buildingName}</strong>.</p>
      <p>Click the button below to create your account and get started:</p>
      <p>
        <a href="${inviteLink}" class="button">Accept invitation &amp; sign up</a>
      </p>
      <p>This invitation link will expire in 7 days.</p>
      <p style="font-size: 12px; color: #666;">
        If the button doesn't work, copy and paste this link into your browser:<br>
        <a href="${inviteLink}">${inviteLink}</a>
      </p>
    `,
      fakeUser,
    );
    await this.sendEmail(toEmail, subject, html);
  }

  /**
   * Send board announcement to multiple users
   */
  async sendBoardAnnouncement(
    users: EmailUser[],
    post: EmailPost,
  ): Promise<void> {
    const subject = `New Announcement: ${post.title}`;

    const sendPromises = users.map((user) => {
      const html = this.getEmailTemplate(
        `
        <h1>New Board Announcement</h1>
        <p>Hi ${user.firstName},</p>
        <p>A new announcement has been posted:</p>
        <div class="info-box">
          <h2>${post.title}</h2>
          <p>${this.truncateContent(post.content, 300)}</p>
        </div>
        <p>
          <a href="${this.frontendUrl}/posts/${post._id}" class="button">Read Full Announcement</a>
        </p>
      `,
        user,
      );

      return this.sendEmail(user.email, subject, html).catch((error) => {
        this.logger.error(
          `Failed to send announcement to ${user.email}`,
          error,
        );
      });
    });

    await Promise.all(sendPromises);
  }

  /**
   * Generate email HTML template with consistent styling
   */
  private getEmailTemplate(content: string, user: EmailUser): string {
    const unsubscribeUrl = `${this.frontendUrl}/settings/notifications?user=${user._id}`;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Heime</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background-color: #ffffff;
      border-radius: 8px;
      padding: 40px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
    }
    .logo {
      font-size: 28px;
      font-weight: bold;
      color: #2563eb;
    }
    h1 {
      color: #1f2937;
      font-size: 24px;
      margin-bottom: 20px;
    }
    h2 {
      color: #374151;
      font-size: 18px;
      margin: 0 0 10px 0;
    }
    p {
      margin: 0 0 16px 0;
    }
    .button {
      display: inline-block;
      background-color: #2563eb;
      color: #ffffff !important;
      text-decoration: none;
      padding: 12px 24px;
      border-radius: 6px;
      font-weight: 600;
      margin: 10px 0;
    }
    .button:hover {
      background-color: #1d4ed8;
    }
    .info-box {
      background-color: #f3f4f6;
      border-radius: 6px;
      padding: 20px;
      margin: 20px 0;
    }
    .info-box p {
      margin: 8px 0;
    }
    ul {
      padding-left: 20px;
    }
    li {
      margin-bottom: 8px;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      font-size: 12px;
      color: #6b7280;
      text-align: center;
    }
    .footer a {
      color: #6b7280;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">Heime</div>
    </div>
    ${content}
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} Heime. All rights reserved.</p>
      <p>
        <a href="${unsubscribeUrl}">Manage notification preferences</a> |
        <a href="${this.frontendUrl}">Visit Heime</a>
      </p>
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Strip HTML tags from content
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Format date for display
   */
  private formatDate(date: Date): string {
    return new Date(date).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  /**
   * Format time for display
   */
  private formatTime(date: Date): string {
    return new Date(date).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  /**
   * Truncate content with ellipsis
   */
  private truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength).trim() + "...";
  }
}
