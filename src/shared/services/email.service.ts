import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as sgMail from "@sendgrid/mail";
import {
  renderButton,
  renderEmailLayout,
  renderH1,
  renderInfoBox,
  renderLinkFallback,
} from "../email-templates/base-layout";

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

    this.logger.log(
      `EmailService initialized: configured=${this.isConfigured}, apiKey=${apiKey ? `present (${apiKey.length} chars)` : "MISSING"}, fromEmail=${this.fromEmail || "MISSING"}, fromName=${this.fromName || "(none)"}, frontendUrl=${this.frontendUrl || "MISSING"}`,
    );
  }

  async sendEmail(
    to: string,
    subject: string,
    html: string,
    text?: string,
    attachments?: { content: string; filename: string; type: string }[],
  ): Promise<void> {
    this.logger.log(
      `sendEmail called: to=${to}, subject="${subject}", attachments=${attachments?.length || 0}`,
    );
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

      this.logger.log(
        `Dispatching to SendGrid: from=${JSON.stringify(from)}, to=${to}`,
      );
      const [response] = await sgMail.send({
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
      this.logger.log(
        `Email sent to ${to}: ${subject} (status=${response?.statusCode}, messageId=${response?.headers?.["x-message-id"] || "n/a"})`,
      );
    } catch (error) {
      const body = (error as { response?: { body?: unknown } })?.response?.body;
      const code = (error as { code?: number })?.code;
      this.logger.error(
        `Failed to send email to ${to}: code=${code}, body=${JSON.stringify(body)}`,
        (error as Error)?.stack,
      );
      throw error;
    }
  }

  async sendTemplateEmail(
    to: string,
    templateId: string,
    dynamicData: Record<string, unknown>,
  ): Promise<void> {
    this.logger.log(
      `sendTemplateEmail called: to=${to}, templateId=${templateId}`,
    );
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

      this.logger.log(
        `Dispatching template to SendGrid: from=${JSON.stringify(from)}, to=${to}, templateId=${templateId}`,
      );
      const [response] = await sgMail.send({
        to,
        from,
        templateId,
        dynamicTemplateData: dynamicData,
      });
      this.logger.log(
        `Template email sent to ${to}: ${templateId} (status=${response?.statusCode}, messageId=${response?.headers?.["x-message-id"] || "n/a"})`,
      );
    } catch (error) {
      const body = (error as { response?: { body?: unknown } })?.response?.body;
      const code = (error as { code?: number })?.code;
      this.logger.error(
        `Failed to send template email to ${to}: code=${code}, body=${JSON.stringify(body)}`,
        (error as Error)?.stack,
      );
      throw error;
    }
  }

  async sendWelcomeEmail(
    user: EmailUser,
    organization: EmailOrganization,
  ): Promise<void> {
    const subject = `Velkommen til ${organization.name} på Grunnsteinen!`;
    const content = `
      ${renderH1(`Velkommen, ${user.firstName}!`)}
      <p>Du er nå medlem av <strong>${organization.name}</strong>.</p>
      <p>Med Grunnsteinen kan du:</p>
      <ul style="padding-left:20px;margin:0 0 16px 0;">
        <li style="margin-bottom:8px;">Booke felles ressurser og fasiliteter</li>
        <li style="margin-bottom:8px;">Holde deg oppdatert på arrangementer i nabolaget</li>
        <li style="margin-bottom:8px;">Komme i kontakt med naboene dine</li>
        <li style="margin-bottom:8px;">Finne viktige dokumenter og kunngjøringer</li>
      </ul>
      ${renderButton("Gå til dashbord", `${this.frontendUrl}/dashboard`)}
      <p>Har du spørsmål? Ta gjerne kontakt med administratorene i nabolaget ditt.</p>
    `;

    await this.sendEmail(
      user.email,
      subject,
      renderEmailLayout(content, {
        frontendUrl: this.frontendUrl,
        userId: user._id,
        preheader: "Kontoen din er klar — velkommen til nabolaget.",
      }),
    );
  }

  async sendPasswordResetEmail(
    user: EmailUser,
    resetToken: string,
  ): Promise<void> {
    const resetLink = `${this.frontendUrl}/auth/reset-password?token=${resetToken}`;
    const subject = "Tilbakestill passordet ditt";
    const content = `
      ${renderH1("Tilbakestill passord")}
      <p>Hei ${user.firstName},</p>
      <p>Vi har mottatt en forespørsel om å tilbakestille passordet ditt. Klikk på knappen under for å velge et nytt passord:</p>
      ${renderButton("Tilbakestill passord", resetLink)}
      <p>Lenken utløper om 1 time.</p>
      <p>Hvis du ikke ba om å tilbakestille passordet, kan du trygt se bort fra denne e-posten. Passordet ditt vil ikke bli endret.</p>
      ${renderLinkFallback(resetLink)}
    `;

    await this.sendEmail(
      user.email,
      subject,
      renderEmailLayout(content, {
        frontendUrl: this.frontendUrl,
        userId: user._id,
        preheader: "Klikk lenken for å velge et nytt passord.",
      }),
    );
  }

  async sendBookingConfirmation(
    user: EmailUser,
    booking: EmailBooking,
  ): Promise<void> {
    const subject = `Booking bekreftet: ${booking.resource.name}`;
    const content = `
      ${renderH1("Booking bekreftet")}
      <p>Hei ${user.firstName},</p>
      <p>Bookingen din er bekreftet:</p>
      ${renderInfoBox(`
        <p style="margin:6px 0;"><strong>Ressurs:</strong> ${booking.resource.name}</p>
        <p style="margin:6px 0;"><strong>Dato:</strong> ${this.formatDate(booking.startTime)}</p>
        <p style="margin:6px 0;"><strong>Tid:</strong> ${this.formatTime(booking.startTime)} – ${this.formatTime(booking.endTime)}</p>
      `)}
      ${renderButton("Se booking", `${this.frontendUrl}/bookings/${booking._id}`)}
      <p>Trenger du å gjøre endringer? Du kan administrere bookingen din via lenken over.</p>
    `;

    await this.sendEmail(
      user.email,
      subject,
      renderEmailLayout(content, {
        frontendUrl: this.frontendUrl,
        userId: user._id,
        preheader: `Bookingen av ${booking.resource.name} er bekreftet.`,
      }),
    );
  }

  async sendBookingCancellation(
    user: EmailUser,
    booking: EmailBooking,
  ): Promise<void> {
    const subject = `Booking avlyst: ${booking.resource.name}`;
    const content = `
      ${renderH1("Booking avlyst")}
      <p>Hei ${user.firstName},</p>
      <p>Bookingen din er avlyst:</p>
      ${renderInfoBox(`
        <p style="margin:6px 0;"><strong>Ressurs:</strong> ${booking.resource.name}</p>
        <p style="margin:6px 0;"><strong>Dato:</strong> ${this.formatDate(booking.startTime)}</p>
        <p style="margin:6px 0;"><strong>Tid:</strong> ${this.formatTime(booking.startTime)} – ${this.formatTime(booking.endTime)}</p>
      `)}
      ${renderButton("Book en ny tid", `${this.frontendUrl}/resources`)}
    `;

    await this.sendEmail(
      user.email,
      subject,
      renderEmailLayout(content, {
        frontendUrl: this.frontendUrl,
        userId: user._id,
        preheader: `Bookingen av ${booking.resource.name} er avlyst.`,
      }),
    );
  }

  async sendEventReminder(user: EmailUser, event: EmailEvent): Promise<void> {
    const subject = `Påminnelse: ${event.title} nærmer seg`;
    const content = `
      ${renderH1("Påminnelse om arrangement")}
      <p>Hei ${user.firstName},</p>
      <p>Ikke glem det kommende arrangementet:</p>
      ${renderInfoBox(`
        <p style="margin:6px 0;"><strong>Arrangement:</strong> ${event.title}</p>
        <p style="margin:6px 0;"><strong>Dato:</strong> ${this.formatDate(event.startDate)}</p>
        <p style="margin:6px 0;"><strong>Tid:</strong> ${this.formatTime(event.startDate)}</p>
        ${event.location ? `<p style="margin:6px 0;"><strong>Sted:</strong> ${event.location}</p>` : ""}
      `)}
      ${renderButton("Se detaljer", `${this.frontendUrl}/events/${event._id}`)}
    `;

    await this.sendEmail(
      user.email,
      subject,
      renderEmailLayout(content, {
        frontendUrl: this.frontendUrl,
        userId: user._id,
        preheader: `${event.title} starter snart.`,
      }),
    );
  }

  async sendNewMessageNotification(
    user: EmailUser,
    sender: EmailUser,
  ): Promise<void> {
    const senderName = `${sender.firstName} ${sender.lastName}`;
    const subject = `Ny melding fra ${senderName}`;
    const content = `
      ${renderH1("Du har en ny melding")}
      <p>Hei ${user.firstName},</p>
      <p><strong>${senderName}</strong> har sendt deg en melding.</p>
      ${renderButton("Les melding", `${this.frontendUrl}/messages`)}
    `;

    await this.sendEmail(
      user.email,
      subject,
      renderEmailLayout(content, {
        frontendUrl: this.frontendUrl,
        userId: user._id,
        preheader: `${senderName} har sendt deg en melding.`,
      }),
    );
  }

  async sendInviteEmail(
    toEmail: string,
    organizationName: string,
    buildingName: string,
    inviteLink: string,
  ): Promise<void> {
    const subject = `Du er invitert til ${organizationName} — ${buildingName}`;
    const content = `
      ${renderH1("Du er invitert!")}
      <p>Du er invitert til å bli med i <strong>${organizationName}</strong> på <strong>${buildingName}</strong>.</p>
      <p>Klikk på knappen under for å opprette kontoen din og komme i gang:</p>
      ${renderButton("Godta invitasjon og registrer deg", inviteLink)}
      <p>Invitasjonslenken utløper om 7 dager.</p>
      ${renderLinkFallback(inviteLink)}
    `;

    await this.sendEmail(
      toEmail,
      subject,
      renderEmailLayout(content, {
        frontendUrl: this.frontendUrl,
        preheader: `Opprett kontoen din for ${organizationName}.`,
      }),
    );
  }

  async sendAdminSetupEmail(
    toEmail: string,
    organizationName: string,
    inviterName: string,
    roleLabel: string,
    setupLink: string,
  ): Promise<void> {
    const subject = `Du er invitert som ${roleLabel} i ${organizationName}`;
    const content = `
      ${renderH1(`Du er invitert som ${roleLabel}`)}
      <p><strong>${inviterName}</strong> har invitert deg til å bli ${roleLabel} i <strong>${organizationName}</strong> på Grunnsteinen.</p>
      <p>Klikk på knappen under for å fullføre oppsettet av kontoen din. Du velger ditt eget passord.</p>
      ${renderButton("Fullfør oppsett", setupLink)}
      <p>Lenken utløper om 72 timer.</p>
      ${renderLinkFallback(setupLink)}
    `;

    await this.sendEmail(
      toEmail,
      subject,
      renderEmailLayout(content, {
        frontendUrl: this.frontendUrl,
        preheader: "Fullfør oppsett av administratorkontoen din.",
      }),
    );
  }

  async sendBoardAnnouncement(
    users: EmailUser[],
    post: EmailPost,
  ): Promise<void> {
    const subject = `Ny kunngjøring: ${post.title}`;

    const sendPromises = users.map((user) => {
      const content = `
        ${renderH1("Ny kunngjøring fra styret")}
        <p>Hei ${user.firstName},</p>
        <p>En ny kunngjøring er publisert:</p>
        ${renderInfoBox(`
          <h2 style="color:#374151;font-size:17px;margin:0 0 10px 0;">${post.title}</h2>
          <p style="margin:0;">${this.truncateContent(post.content, 300)}</p>
        `)}
        ${renderButton("Les hele kunngjøringen", `${this.frontendUrl}/posts/${post._id}`)}
      `;

      return this.sendEmail(
        user.email,
        subject,
        renderEmailLayout(content, {
          frontendUrl: this.frontendUrl,
          userId: user._id,
          preheader: post.title,
        }),
      ).catch((error) => {
        this.logger.error(
          `Failed to send announcement to ${user.email}`,
          error,
        );
      });
    });

    await Promise.all(sendPromises);
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private formatDate(date: Date): string {
    return new Date(date).toLocaleDateString("nb-NO", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  private formatTime(date: Date): string {
    return new Date(date).toLocaleTimeString("nb-NO", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  private truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength).trim() + "...";
  }
}
