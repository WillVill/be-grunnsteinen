/**
 * Seed the App Store review demo: a self-contained "Demo Borettslag" organisation with one
 * building, three residents and realistic content in every tab of the resident app.
 *
 * Apple's reviewer signs in as Ola Nordmann (resident). Kari Nordmann (resident) and Per Hansen
 * (board) exist so messaging, comments, reporting and blocking have someone on the other side.
 * Ola/Kari Nordmann are the standard Norwegian placeholder names; no real person's data is used.
 *
 * Usage:
 *   yarn ts-node scripts/seed-review-demo.ts            # create; refuses if the demo org exists
 *   yarn ts-node scripts/seed-review-demo.ts --reset    # delete the demo org's data and recreate
 *
 * Passwords are generated per run and printed once, at the end. Set DEMO_PASSWORD to choose the
 * reviewer's password yourself (it must meet the app's rules: 8+ chars, a digit, upper and lower).
 * Set DEMO_MODERATOR_EMAIL to a real inbox to add a board account that receives every report.
 *
 * Writes go straight to the models, not the services, so no push, email or in-app notification
 * fan-out reaches anyone. Email notifications are switched off for all three demo users.
 * Only data whose organizationId is the demo org is ever deleted.
 */

import { randomBytes } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { AppModule } from '../src/app.module';
import { S3Service } from '../src/shared/services/s3.service';

export const DEMO_ORG_CODE = 'DEMO-APPREVIEW';
const DEMO_DOC_KEY = 'private/documents/demo-appreview/husordensregler.pdf';

/**
 * Days from the run date to the two demo events. An App Store review can take 2–4 weeks, plus a
 * possible resubmission, and the events must still be upcoming the whole time.
 */
const EVENT_DAYS_AHEAD = [56, 84] as const;

const USERS = {
  reviewer: { email: 'appreview@example.com', name: 'Ola Nordmann', role: 'resident', unit: 'H0101' },
  neighbour: { email: 'kari.demo@example.com', name: 'Kari Nordmann', role: 'resident', unit: 'H0102' },
  board: { email: 'per.demo@example.com', name: 'Per Hansen', role: 'board', unit: 'H0201' },
} as const;

/** Collections whose documents carry organizationId and belong wholly to the demo org on reset. */
const ORG_SCOPED = [
  'concepts', 'buildings', 'apartments', 'posts', 'events', 'resources', 'bookings',
  'documentfolders', 'documents', 'conversations', 'groups', 'shareditems', 'helprequests',
  'tenantprofiles', 'reports', 'dailystats', 'invitations', 'users',
];

function password(): string {
  // 8+ chars with a digit, an uppercase and a lowercase letter (backend and app rules).
  return `Demo-${randomBytes(5).toString('hex')}K7`;
}

function daysFromNow(days: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 3600 * 1000);
}

/** A one-page PDF with plain ASCII text; enough for the document viewer. */
function husordensreglerPdf(): Buffer {
  const lines = [
    'Husordensregler - Demo Borettslag',
    '',
    '1. Ro i bygget mellom kl. 23 og 07.',
    '2. Sykler parkeres i sykkelboden.',
    '3. Avfall sorteres i miljostasjonen.',
    '4. Fellesrommet bookes i Grunnsteinen-appen.',
  ];
  const text = lines
    .map((l, i) => `BT /F1 ${i === 0 ? 16 : 12} Tf 60 ${760 - i * 24} Td (${l}) Tj ET`)
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function main() {
  const reset = process.argv.includes('--reset');
  const reviewerPassword = process.env.DEMO_PASSWORD || password();
  const moderatorEmail = process.env.DEMO_MODERATOR_EMAIL?.trim().toLowerCase() || undefined;

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const db = app.get<Connection>(getConnectionToken()).db;
  const model = <T = any>(name: string) => app.get<Model<T>>(getModelToken(name));

  try {
    const existing = await db.collection('organizations').findOne({ code: DEMO_ORG_CODE });
    if (existing && !reset) {
      console.error(`Demo org ${DEMO_ORG_CODE} already exists (${existing._id}). Re-run with --reset to recreate it.`);
      process.exitCode = 1;
      return;
    }
    if (existing) await deleteDemoOrg(db, existing._id as Types.ObjectId);

    // Refuse to collide with a real account that happens to use one of the demo emails.
    const taken = await db
      .collection('users')
      .find({ email: { $in: [...Object.values(USERS).map((u) => u.email), ...(moderatorEmail ? [moderatorEmail] : [])] } })
      .project({ email: 1 })
      .toArray();
    if (taken.length) {
      console.error(`Demo email already in use outside the demo org: ${taken.map((u) => u.email).join(', ')}`);
      process.exitCode = 1;
      return;
    }

    const org = await model('Organization').create({
      name: 'Demo Borettslag',
      code: DEMO_ORG_CODE,
      address: 'Eksempelveien 1',
      city: 'Oslo',
      postalCode: '0150',
      description: 'Demo-organisasjon for App Store-gjennomgang.',
    });
    const orgId = org._id as Types.ObjectId;
    const concept = await model('Concept').create({ organizationId: orgId, name: 'Demo', code: 'demo' });
    const conceptId = concept._id as Types.ObjectId;
    const building = await model('Building').create({
      organizationId: orgId,
      conceptId,
      name: 'Solsiden',
      code: 'demo-solsiden',
      address: 'Eksempelveien 1',
      city: 'Oslo',
      postalCode: '0150',
    });
    const buildingId = building._id as Types.ObjectId;
    const scope = { organizationId: orgId, conceptId, buildingId };

    const off = {
      newPosts: false, comments: false, events: false, eventReminders: false,
      bookings: false, helpRequests: false, messages: false, boardAnnouncements: false,
    };
    const passwords: Record<string, string> = {};
    const ids: Record<keyof typeof USERS, Types.ObjectId> = {} as any;
    for (const [key, u] of Object.entries(USERS) as [keyof typeof USERS, (typeof USERS)[keyof typeof USERS]][]) {
      passwords[key] = key === 'reviewer' ? reviewerPassword : password();
      const user = await model('User').create({
        email: u.email,
        password: passwords[key],
        name: u.name,
        role: u.role,
        organizationId: orgId,
        buildingIds: [buildingId],
        primaryBuildingId: buildingId,
        isActive: true,
        notificationPreferences: { email: off },
      });
      ids[key] = user._id as Types.ObjectId;
      await model('Apartment').create({
        ...scope,
        unitNumber: u.unit,
        floor: Number(u.unit.slice(1, 3)),
        entrance: 'A',
        apartmentType: '3-room',
        tenantIds: [ids[key]],
      });
    }

    // Reports never reach the author of the reported content, and Per writes the board posts and
    // events. A staff account that authors nothing makes sure every report reaches a real person.
    if (moderatorEmail) {
      passwords.moderator = password();
      await model('User').create({
        email: moderatorEmail,
        password: passwords.moderator,
        name: 'Styret – moderering',
        role: 'board',
        organizationId: orgId,
        buildingIds: [buildingId],
        primaryBuildingId: buildingId,
        isActive: true,
        // Report emails ignore these; everything else stays quiet.
        notificationPreferences: { email: off },
      });
    }

    const welcome = await model('Post').create({
      ...scope,
      authorId: ids.board,
      title: 'Velkommen til Grunnsteinen!',
      content:
        'Her finner du oppslag fra styret, aktiviteter i nabolaget, booking av fellesrommet og viktige dokumenter. Ta gjerne kontakt med styret om du lurer på noe.',
      category: 'announcement',
      isPinned: true,
      isFromBoard: true,
      createdAt: hoursAgo(72),
    });
    await model('Post').create({
      ...scope,
      authorId: ids.board,
      title: 'Vask av trappeoppgang tirsdag',
      content: 'Trappeoppgang A vaskes tirsdag mellom kl. 09 og 12. Vennligst ikke sett sko eller sykler i oppgangen den dagen.',
      category: 'maintenance',
      isFromBoard: true,
      createdAt: hoursAgo(30),
    });
    const drill = await model('Post').create({
      ...scope,
      authorId: ids.neighbour,
      title: 'Noen som kan låne meg en drill?',
      content: 'Skal henge opp noen hyller i helgen. Er det noen i oppgang A som har en drill jeg kan låne?',
      category: 'question',
      likes: [ids.board],
      likesCount: 1,
      commentsCount: 2,
      createdAt: hoursAgo(20),
    });
    await model('Comment').create({
      postId: drill._id, authorId: ids.reviewer, content: 'Du kan låne min! Bare ring på hos meg i H0101.', createdAt: hoursAgo(19),
    });
    await model('Comment').create({
      postId: drill._id, authorId: ids.neighbour, content: 'Tusen takk, kommer innom i kveld!', createdAt: hoursAgo(18),
    });

    const dugnad = await model('Event').create({
      ...scope,
      organizerId: ids.board,
      isFromBoard: true,
      title: 'Dugnad i bakgården',
      description: 'Vi rydder bakgården, planter blomster og griller pølser etterpå. Alle er velkomne!',
      location: 'Bakgården',
      startDate: daysFromNow(EVENT_DAYS_AHEAD[0], 11),
      endDate: daysFromNow(EVENT_DAYS_AHEAD[0], 15),
      category: 'social',
      participants: [ids.board, ids.neighbour],
      participantsCount: 2,
    });
    await model('Event').create({
      ...scope,
      organizerId: ids.neighbour,
      title: 'Strikkekveld i fellesrommet',
      description: 'Ta med strikketøyet ditt, så koker vi kaffe. Nybegynnere er hjertelig velkomne.',
      location: 'Fellesrommet',
      startDate: daysFromNow(EVENT_DAYS_AHEAD[1], 18),
      endDate: daysFromNow(EVENT_DAYS_AHEAD[1], 20, 30),
      category: 'cultural',
      participants: [ids.neighbour],
      participantsCount: 1,
    });

    await model('Resource').create({
      ...scope,
      name: 'Fellesrommet',
      type: 'selskapslokale',
      description: 'Lyst fellesrom med kjøkken og plass til 20 personer. Passer til selskap, møter og bursdager.',
      pricePerHour: 0,
      rules: 'Rommet skal ryddes og vaskes etter bruk. Ro etter kl. 23.',
      minBookingHours: 1,
      maxBookingDays: 1,
      availableDays: [0, 1, 2, 3, 4, 5, 6],
      availableTimeStart: '08:00',
      availableTimeEnd: '23:00',
    });

    const folder = await model('DocumentFolder').create({
      ...scope,
      name: 'Husregler',
      documentCount: 1,
      createdById: ids.board,
    });
    const pdf = husordensreglerPdf();
    const fileUrl = await app.get(S3Service).uploadBuffer(pdf, DEMO_DOC_KEY, 'application/pdf');
    await model('Document').create({
      ...scope,
      folderId: folder._id,
      title: 'Husordensregler',
      description: 'Gjeldende husordensregler for Demo Borettslag.',
      fileUrl,
      fileKey: DEMO_DOC_KEY,
      fileName: 'husordensregler.pdf',
      fileSize: pdf.length,
      mimeType: 'application/pdf',
      uploadedById: ids.board,
      isPublic: true,
    });

    const lastMessage = 'Hei Ola! Takk for drillen, jeg leverer den tilbake i morgen.';
    const conversation = await model('Conversation').create({
      organizationId: orgId,
      participants: [ids.reviewer, ids.neighbour],
      lastMessageAt: hoursAgo(2),
      lastMessagePreview: lastMessage,
      unreadCount: new Map([[ids.reviewer.toString(), 1], [ids.neighbour.toString(), 0]]),
    });
    await model('Message').create({
      conversationId: conversation._id, senderId: ids.reviewer, content: 'Hei Kari, drillen ligger klar til deg.', isRead: true, createdAt: hoursAgo(5),
    });
    await model('Message').create({
      conversationId: conversation._id, senderId: ids.neighbour, content: lastMessage, createdAt: hoursAgo(2),
    });

    // Raw insert: two schemas are registered as "Notification" with different type enums.
    const now = new Date();
    await db.collection('notifications').insertMany([
      {
        userId: ids.reviewer, type: 'message_received', title: 'Ny melding fra Kari Nordmann',
        message: lastMessage, linkTo: `/messages/${conversation._id}`, isRead: false,
        createdAt: hoursAgo(2), updatedAt: now,
      },
      {
        userId: ids.reviewer, type: 'event_created', title: 'Ny aktivitet',
        message: '«Dugnad i bakgården» – Bakgården', linkTo: `/events/${dugnad._id}`, isRead: false,
        createdAt: hoursAgo(24), updatedAt: now,
      },
      {
        userId: ids.reviewer, type: 'announcement', title: 'Velkommen til Grunnsteinen!',
        message: 'Styret har lagt ut et nytt oppslag.', linkTo: `/posts/${welcome._id}`, isRead: true,
        readAt: hoursAgo(48), createdAt: hoursAgo(72), updatedAt: now,
      },
    ]);

    console.log('\nDemo organisation created for App Store review.');
    console.log(`  Organisation: Demo Borettslag (${orgId})`);
    console.log(`  Building:     Solsiden (${buildingId})\n`);
    console.log('  Reviewer login (paste into App Store Connect → App Review Information):');
    console.log(`    E-post:  ${USERS.reviewer.email}`);
    console.log(`    Passord: ${passwords.reviewer}\n`);
    console.log('  Other demo users (not needed by Apple):');
    console.log(`    ${USERS.neighbour.email}  ${passwords.neighbour}`);
    console.log(`    ${USERS.board.email}  ${passwords.board}\n`);
    if (moderatorEmail) {
      console.log('  Moderator (receives every report by email and in the app):');
      console.log(`    ${moderatorEmail}  ${passwords.moderator}\n`);
    } else {
      console.log('  No DEMO_MODERATOR_EMAIL set: reports on Per Hansen\'s posts and events reach nobody.\n');
    }
  } finally {
    await app.close();
  }
}

/** Delete everything that belongs to the demo org. Never touches documents outside it. */
async function deleteDemoOrg(db: Connection['db'], orgId: Types.ObjectId) {
  const userIds = (await db.collection('users').find({ organizationId: orgId }).project({ _id: 1 }).toArray()).map((u) => u._id);
  const postIds = (await db.collection('posts').find({ organizationId: orgId }).project({ _id: 1 }).toArray()).map((p) => p._id);
  const convIds = (await db.collection('conversations').find({ organizationId: orgId }).project({ _id: 1 }).toArray()).map((c) => c._id);

  await db.collection('comments').deleteMany({ postId: { $in: postIds } });
  await db.collection('messages').deleteMany({ conversationId: { $in: convIds } });
  await db.collection('notifications').deleteMany({ userId: { $in: userIds } });
  for (const name of ORG_SCOPED) {
    await db.collection(name).deleteMany({ organizationId: orgId });
  }
  await db.collection('organizations').deleteOne({ _id: orgId, code: DEMO_ORG_CODE });
  console.log(`Deleted the previous demo org (${orgId}) and its data.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
