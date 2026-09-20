# Grunnsteinen

Full-stack community neighborhood platform. Multi-tenant SaaS: organizations (housing associations) → buildings → apartments → residents.

```
/code
├── be_grunnsteinen/   NestJS 10 backend (MongoDB, Mongoose)
│   ├── CLAUDE.md      this file
│   └── .claude/rules/ Detailed coding conventions (backend + frontend)
└── fe_grunnsteinen/   Next.js 16 frontend (React 19, Tailwind CSS 4)
```

`be_grunnsteinen` and `fe_grunnsteinen` are **separate GitHub repos**; `/code` is just the
workspace folder that contains them. This file and the rule files are tracked in the backend
repo — including `rules/frontend.md`, which documents the frontend repo.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Backend | NestJS 10, TypeScript, MongoDB + Mongoose 9 |
| Frontend | Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS 4 |
| Auth | JWT (access + refresh), Passport |
| File Storage | AWS S3 |
| Email / SMS | SendGrid, Twilio |
| State (FE) | Zustand (client), TanStack Query v5 (server) |
| Validation | class-validator (BE), Zod + React Hook Form (FE) |
| UI Components | shadcn/ui (Radix), Lucide icons, Sonner toasts |
| Package Manager | Yarn 4.5.1 |

## Dev Commands

```bash
cd be_grunnsteinen && yarn start:dev   # Backend (watch mode)
cd fe_grunnsteinen && yarn dev         # Frontend (Turbopack)
```

## Environment Variables

**Backend (`.env`):** `NODE_ENV`, `PORT`, `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRATION`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`, `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `FRONTEND_URL`

**Frontend (`.env.local`):** `NEXT_PUBLIC_API_URL`

## Database: MongoDB (Mongoose)

### Tenant Hierarchy

```
Organization (housing association)
└── Concept (brand, e.g. Leva / Hjemom) — optional
    └── Building (one or more)
        ├── Apartment (units)
        │   └── TenantProfile (residents, registered or not)
        └── Users (residents)
```

Most documents carry both `organizationId` and `buildingId`. Many also have `isOrganizationWide: boolean`. `conceptId` is optional on `buildings`, `apartments`, and `tenantprofiles`.

### Base Schema

All schemas: `_id` → serialized as `id` in JSON, `createdAt`/`updatedAt` timestamps, virtuals enabled.

### Collections

#### `users`
```
email (unique, lowercase), password (select:false, bcrypt), name, phone, avatarUrl, dateOfBirth
organizationId → organizations, buildingIds → buildings[], primaryBuildingId → buildings
role: RESIDENT | BOARD | ADMIN | SUPER_ADMIN
interests[], isHelpfulNeighbor, helpfulSkills[], isProfilePrivate
notificationPreferences { email: {posts,comments,events,bookings,messages,helpRequests,boardAnnouncements}, push: {same} }
isActive, lastLoginAt, passwordResetToken (select:false), passwordResetExpires (select:false)
```

#### `organizations`
```
name, code (unique), address, city, postalCode, description, logoUrl, isActive
settings { allowResidentPosts, allowResidentEvents, requireBookingApproval, defaultBookingRules }
```

#### `concepts`
```
organizationId → organizations, name, code, logoUrl, brandColor, description, isActive
brandColors { primary, secondary, tertiary, quaternary }
Index: unique sparse (organizationId, code)
```

#### `buildings`
```
organizationId → organizations, conceptId → concepts?, name, code, address, city, postalCode, description, isActive
settings { allowResidentPosts, allowResidentEvents, requireBookingApproval }
```

#### `apartments`
```
organizationId → organizations, buildingId → buildings, conceptId → concepts?
unitNumber, floor, entrance (oppgang), sizeSqm, numberOfRooms
apartmentType: 1-room | 2-room | 3-room | 4-room | 5+room | other
tags[] (e.g. 'garasje' — used with entrance for recipient segmentation)
description, tenantIds → users[] (registered users only), isActive
Index: unique (buildingId, unitNumber)
```

#### `posts`
```
organizationId → organizations, authorId → users, buildingId → buildings?, groupId → groups?
isOrganizationWide, title, content (text-indexed), category: GENERAL | MAINTENANCE | SOCIAL | QUESTION | ANNOUNCEMENT
isPinned, isFromBoard, likes → users[], likesCount, commentsCount
```

#### `comments`
```
postId → posts, authorId → users, content
```

#### `events`
```
organizationId → organizations, organizerId → users, groupId → groups?, buildingId → buildings?
isOrganizationWide, title, description, location, imageUrl, startDate, endDate
maxParticipants, participants → users[], participantsCount
category: SOCIAL | SPORTS | CULTURAL | WORKSHOP | OTHER
status: UPCOMING | ONGOING | COMPLETED | CANCELLED
isRecurring, recurringPattern
```

#### `resources`
```
organizationId → organizations, buildingId → buildings?, isOrganizationWide
name, type: GUEST_APARTMENT | COMMON_AREA | PARKING | EQUIPMENT
description, imageUrls[], pricePerDay, pricePerHour, currency, rules
minBookingHours, maxBookingDays, requiresApproval, isActive
availableDays[] (0-6), availableTimeStart, availableTimeEnd (HH:MM)
```

#### `bookings`
```
organizationId → organizations, resourceId → resources, buildingId → buildings, userId → users
startDate, endDate, status: PENDING | CONFIRMED | CANCELLED | COMPLETED
totalPrice, currency, notes, adminNotes, cancelledAt, cancelledBy → users, cancellationReason
Index: (resourceId, startDate, endDate, status)
```

#### `groups`
```
organizationId → organizations, name, description, imageUrl, creatorId → users
buildingId → buildings?, isOrganizationWide, members → users[], memberCount, isPrivate, isActive
```

#### `conversations`
```
organizationId → organizations, participants → users[2] (exactly 2)
lastMessageAt, lastMessagePreview, unreadCount Map<userId, Number>
Index: unique (organizationId, participants)
```

#### `messages`
```
conversationId → conversations, senderId → users, content, isRead, readAt
```

#### `documents`
```
organizationId → organizations, buildingId → buildings?, isOrganizationWide
title, description, category: RULES | MINUTES | FDV | MANUALS | CONTRACTS | FLOOR_PLAN | OTHER
fileUrl (S3), fileKey (S3), fileName, fileSize, mimeType, uploadedById → users
apartmentId → apartments?, isPublic
```

#### `documentfolders`
```
organizationId → organizations, conceptId → concepts (required), buildingId → buildings?
name, description, documentCount, createdById → users
Index: unique (organizationId, conceptId, name)
```

#### `notifications`
```
userId → users, type: POST | COMMENT | EVENT | BOOKING | MESSAGE | HELP_REQUEST | SYSTEM
title, message, linkTo, relatedId, relatedType, isRead, readAt
TTL: auto-delete after 90 days
```

#### `shareditems`
```
organizationId → organizations, ownerId → users, buildingId → buildings?, isOrganizationWide
name, description, category: TOOLS | OUTDOOR | TOYS | KITCHEN | ELECTRONICS | OTHER
imageUrl, isAvailable, borrowedBy → users, borrowedAt
```

#### `helprequests`
```
organizationId → organizations, requesterId → users, buildingId → buildings?, isOrganizationWide
title, description, category: PET_CARE | PLANT_CARE | HANDYMAN | TUTORING | ERRANDS | OTHER
status: OPEN | ACCEPTED | COMPLETED | CANCELLED, helperId → users, acceptedAt, completedAt
```

#### `invitations`
```
email, buildingId → buildings, organizationId → organizations, unitNumber, apartmentId → apartments
firstName, lastName, phone, token (unique), expiresAt, createdBy → users
status: PENDING | ACCEPTED | EXPIRED
```

#### `tenantprofiles`
```
organizationId → organizations, buildingId → buildings, conceptId → concepts?, apartmentId → apartments
firstName, lastName, email, phone, notes (admin-only), moveInDate
status: UNREGISTERED | INVITED | REGISTERED
userId → users? (set on registration), invitationId → invitations?, addedBy → users
Index: unique sparse (apartmentId, email)
```

Persistent admin-managed record of who lives in an apartment — outlives any invitation and
exists whether or not the tenant ever registers. `apartment.tenantIds` holds only registered
users; unregistered tenants live here. See `.claude/rules/tenant-user-relation.md`.

#### `dailystats`
```
organizationId → organizations, buildingId → buildings|null, conceptId → concepts|null
date (Oslo midnight, UTC-stored)
newUsers, newPosts, newEvents, newBookings, newHelpRequests, newComments, newMessages
Index: unique (organizationId, buildingId, date)
```

Pre-computed analytics snapshots — `/stats` reads these rows, it never aggregates the
content collections on the fly. Written by a cron in `stats.service.ts` at 01:00
Europe/Oslo for the previous day; idempotent upsert, so re-running a date overwrites it.
Backfill historical days with `scripts/backfill-stats.ts`.

**Contract:** the `buildingId: null` row is the organization-wide **total** for that day.
Building rows partition only the records tied to a specific building, so they do **not**
sum to the org-wide row — org-wide records (concept-wide items, messages, users with no
`primaryBuildingId`) land solely in the `null` row.

## API Endpoints

| Resource | Base Path |
| --- | --- |
| Auth | `/auth` |
| Users | `/users` |
| Organizations | `/organizations` |
| Concepts | `/concepts` |
| Buildings | `/buildings` |
| Apartments | `/apartments` |
| Tenant Profiles | `/tenant-profiles` |
| Posts | `/posts` |
| Events | `/events` |
| Resources | `/resources` |
| Bookings | `/bookings` |
| Groups | `/groups` |
| Messages | `/messages` |
| Notifications | `/notifications` |
| Documents | `/documents` |
| Document Folders | `/document-folders` |
| Sharing (items + help) | `/sharing` |
| Invitations | `/invitations` |
| Stats | `/stats` |
