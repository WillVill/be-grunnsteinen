---
paths:
  - "be_grunnsteinen/src/modules/events/**"
  - "fe_grunnsteinen/src/hooks/api/useEvents.ts"
  - "fe_grunnsteinen/src/app/activities/**"
---

# Events & Activities

## Overview

The Events module manages community events and activities within buildings and organizations. Residents can create, join, and organize social, sports, cultural, and workshop events. Organizers and board members can manage event details, upload images, and view participants. The system supports event lifecycle management (upcoming, ongoing, completed, cancelled), capacity limits, and automatic notifications.

## Data Model

### Event Schema

**Collection:** `events`

```
_id                 → ObjectId (serialized as `id` in JSON)
organizationId      → ObjectId (required, indexed) → organizations
organizerId         → ObjectId (required) → users (event creator)
groupId?            → ObjectId (optional) → groups (if part of a group)
buildingId?         → ObjectId (optional, indexed) → buildings
isOrganizationWide  → boolean, default: false (applies to entire org)
title               → string (required, 3-100 chars)
description         → string (required, max 2000 chars)
location            → string (required, event location)
imageUrl?           → string (optional, S3 URL from upload)
startDate           → Date (required, indexed)
endDate             → Date (required, must be after startDate)
maxParticipants     → number, default: 0 (0 = unlimited)
participants        → ObjectId[] (array of user references)
participantsCount   → number (denormalized count)
category            → EventCategory enum (indexed)
isRecurring         → boolean, default: false
recurringPattern?   → string (e.g., "weekly", "monthly")
status              → EventStatus enum (indexed, default: UPCOMING)
createdAt           → Date (auto-set)
updatedAt           → Date (auto-updated)
```

### EventCategory Enum

```
SOCIAL      → Community, social gatherings
SPORTS      → Sports activities, competitions
CULTURAL    → Arts, music, cultural events
WORKSHOP    → Educational workshops, training
OTHER       → Miscellaneous events
```

### EventStatus Enum

```
UPCOMING    → Event not yet started
ONGOING     → Event currently in progress
COMPLETED   → Event finished
CANCELLED   → Event cancelled by organizer/board
```

### Compound Indexes

```
organizationId + startDate
organizationId + status + startDate
organizationId + category + startDate
organizerId + startDate
groupId + startDate
organizationId + buildingId + startDate
buildingId + isOrganizationWide
title, description, location (text search)
```

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/events` | JWT | Create new event (organizer auto-added as participant) |
| GET | `/events` | JWT | Get paginated events in organization (supports filters) |
| GET | `/events/upcoming` | JWT | Get upcoming events (default limit: 5) |
| GET | `/events/:id` | JWT | Get event details with participants |
| PATCH | `/events/:id` | JWT (org/board) | Update event (organizer or board only) |
| DELETE | `/events/:id` | JWT (org/board) | Delete event (organizer or board only) |
| POST | `/events/:id/cancel` | JWT (org/board) | Cancel event (changes status to CANCELLED) |
| POST | `/events/:id/join` | JWT | Join event as participant |
| POST | `/events/:id/leave` | JWT | Leave event (remove from participants) |
| GET | `/events/:id/participants` | JWT | Get list of event participants |
| POST | `/events/:id/image` | JWT (org/board) | Upload event image (max 5MB, throttled 10/min) |

## Business Rules & Logic

### Event Creation

**Endpoint:** `POST /events`

**Validation:**
- `endDate` must be after `startDate` (throws 400 if violated)
- Title: 3-100 chars
- Description: max 2000 chars
- Location: required
- Category: must be valid enum value
- BuildingId: required, must be valid MongoDB ID
- MaxParticipants: optional, default 0 (unlimited), must be >= 0

**Behavior:**
- Organizer (creator) is automatically added as first participant
- `participantsCount` set to 1
- Status set to UPCOMING
- Organization scope automatically applied from auth user

**Side effects:**
- Notification created for building/group/organization members
  - Type: `EVENT_CREATED`
  - Excludes organizer from recipients
  - Recipients determined by scope: group > building > organization-wide
  - Deduplicates recipients using Set

### Event Lifecycle

**Status Flow:**

```
UPCOMING (initial)
  ↓
(optional manual transition)
ONGOING / COMPLETED
  ↓ (or manual cancel)
CANCELLED
```

**Status determines:**
- Joining rules: cannot join CANCELLED events
- Participant visibility
- Reminder notifications (only UPCOMING events)

### Participation Management

**Join Event:**
- User cannot join if:
  - Event is CANCELLED (throws 400)
  - User already participating (throws 400)
  - Event is full: `maxParticipants > 0` AND `participantsCount >= maxParticipants` (throws 400)
- On success: user added to participants array, count incremented
- Confirmation notification sent to user

**Leave Event:**
- User cannot leave if not participating (throws 400)
- On success: user removed from participants array, count decremented
- No notification sent

**Participant Limits:**
- `maxParticipants: 0` = unlimited (no capacity check)
- `maxParticipants: > 0` = enforced, additional join attempts rejected with "Event is full"

### Event Updates

**Endpoint:** `PATCH /events/:id`

**Authorization:**
- Only organizer or board/admin members can update
- Throws 403 if user is neither

**Validation:**
- If both `startDate` and `endDate` provided: `endDate` must be after `startDate`

**Date Change Logic:**
- System detects if `startDate` or `endDate` changed
- If dates changed: notification sent to all participants
  - Type: `EVENT_UPDATED`
  - Message: "The event ... has been updated"
  - Includes participant emails for email service

**Updatable fields:**
- title, description, location, category, status
- startDate, endDate, maxParticipants
- groupId, imageUrl, isRecurring, recurringPattern

### Event Deletion

**Endpoint:** `DELETE /events/:id`

**Authorization:**
- Only organizer or board/admin can delete
- Throws 403 if unauthorized

**Behavior:**
- Hard delete from database (event is removed)
- Participants notified before deletion
  - Type: `EVENT_CANCELLED`
  - Message: "The event ... has been cancelled"

### Event Cancellation

**Endpoint:** `POST /events/:id/cancel`

**Authorization:**
- Only organizer or board/admin can cancel
- Throws 403 if unauthorized

**Behavior:**
- Sets `status = CANCELLED` (soft delete)
- Event remains in database but appears cancelled
- All participants notified
  - Type: `EVENT_CANCELLED`
- Prevents new joins immediately

### Image Upload

**Endpoint:** `POST /events/:id/image`

**Requirements:**
- File types: jpg, jpeg, png, webp
- Max size: 5 MB
- Rate limited: 10 requests/min via `@ThrottleUpload()`

**Flow:**
1. File validated by `ParseFilePipe` with MaxFileSizeValidator + FileTypeValidator
2. Uploaded to S3 at path: `events/{eventId}/images`
3. Event document updated with `imageUrl` from S3
4. Updated event returned in response

**Authorization:**
- Only organizer or board/admin can upload

### Recurring Events

**Fields:**
- `isRecurring: boolean` (default: false)
- `recurringPattern?: string` (e.g., "weekly", "monthly", rrule format)

**Current Implementation:**
- Fields stored but no automatic recurrence logic implemented
- Admins must manually create recurring instances or use pattern for reference

### Building & Organization Scoping

**Building-specific events:**
- `buildingId` set → visible to building residents
- `isOrganizationWide: false` → restricted to building

**Organization-wide events:**
- `isOrganizationWide: true` → visible to all organization members
- Applies across all buildings
- `buildingId` may still be set for reference

**Query filtering:**
- If `buildingId` provided in request: return events for that building OR org-wide events
- Uses `$or` query: `{ $or: [{ buildingId }, { isOrganizationWide: true }] }`

## Notifications & Side Effects

### EVENT_CREATED

Sent when event is created.

**Recipients:**
- Determined by scope (group → building → organization)
- Excludes organizer
- Deduplicates recipients

**Fields:**
- Type: `EVENT_CREATED`
- Title: "New event"
- Message: `"[title]" - [location], [formatted date]`
- Link: `/events/{eventId}`
- SendEmail: true

### EVENT_UPDATED

Sent when event details change, only if dates changed.

**Recipients:**
- All current participants (by ID)
- Includes email details for email service

**Fields:**
- Type: `EVENT_UPDATED`
- Title: "Event date changed"
- Message: "The event "[title]" has been updated"
- Link: `/events/{eventId}`
- SendEmail: true

### EVENT_CANCELLED

Sent when event is deleted or cancelled.

**Recipients:**
- All participants (by ID)
- Includes email details for email service

**Fields:**
- Type: `EVENT_CANCELLED`
- Title: "Event cancelled"
- Message: "The event "[title]" has been cancelled"
- Link: `/events` or `/events/{eventId}` (delete uses `/events`)
- SendEmail: true

### EVENT_REMINDER

Sent 24 hours before event start (via background task).

**Recipients:**
- All participants with `notificationPreferences.email.eventReminders = true`

**Fields:**
- Type: `EVENT_REMINDER`
- Title: "Event reminder"
- Message: 'Reminder: "[title]" starts tomorrow'
- Link: `/events/{eventId}`
- SendEmail: true + email via SendGrid

### Background Task: sendReminders()

**Trigger:** Scheduled periodically (cron job, not yet configured)

**Logic:**
- Query events where:
  - `status = UPCOMING`
  - `startDate between now and now + 24 hours`
- For each event:
  - Create in-app notifications for all participants
  - Send email reminders via SendGrid
  - Catch errors, log warnings (non-blocking)

## Frontend

### Hooks (fe_grunnsteinen/src/hooks/api/useEvents.ts)

**useEvents(params: EventQueryParams)**
- Query hook for paginated event list
- Returns: `{ data: PaginatedResponse<Event>, isLoading, error }`
- Query key: `queryKeys.events.list(params)`

**useUpcomingEvents(limit = 5, params?)**
- Query hook for upcoming events (default 5)
- Returns: `{ data: Event[], isLoading, error }`
- Query key: `queryKeys.events.upcoming(limit)`

**useEvent(eventId: string)**
- Query hook for single event details
- Returns: `{ data: Event, isLoading, error }`
- Query key: `queryKeys.events.detail(eventId)`
- Disabled if no eventId

**useCreateEvent()**
- Mutation hook to create event
- Input: partial Event data (title, description, location, startDate, endDate, category, buildingId, maxParticipants, groupId)
- Returns: mutate, mutateAsync, isLoading, error
- On success: invalidates `queryKeys.events.all` and `queryKeys.events.upcoming`

**useUpdateEvent()**
- Mutation hook to update event
- Input: `{ eventId: string, data: UpdateEventData }`
- On success: invalidates detail and all list queries

**useJoinEvent()**
- Mutation hook to join event
- Input: eventId
- On success: updates detail query, invalidates list

**useLeaveEvent()**
- Mutation hook to leave event
- Input: eventId
- On success: updates detail query, invalidates list

**useDeleteEvent()**
- Mutation hook to delete event
- Input: eventId
- On success: removes detail query, invalidates lists

**useCancelEvent()**
- Mutation hook to cancel event
- Input: eventId
- On success: invalidates lists

**useUploadEventImage()**
- Mutation hook for image upload
- Input: `{ eventId: string, file: File }`
- On success: updates detail query with new imageUrl
- Rate limited: 10 req/min

### Pages

#### /activities (fe_grunnsteinen/src/app/activities/page.tsx)

Events list page with filtering, search, and pagination.

**Features:**
- **List/Calendar views** (toggle via button): currently list only, calendar coming soon
- **Category tabs**: All, Sosialt (Social), Sport, Kultur (Cultural), Other + count badges
- **Advanced filters** (collapsible):
  - Participation toggle: "Mine aktiviteter" vs all
  - Date range: from/to inputs or presets (Today, This week, This month)
- **Search & building filter**: via `useBuildingFilter()` hook
- **Event cards** (grid 1/2/3 columns):
  - Image with fallback calendar icon
  - Title, description snippet (line-clamp-2)
  - Category badge (colored: green/blue/purple/slate)
  - Date badge (month + day in corner)
  - Location with MapPin icon
  - Participant count with User icon
  - "Fullt" (Full) badge if at capacity
  - "Pameldt" (Registered) badge if user participating
  - Hover effect: border highlight, image scale-up
- **Pagination**: previous/next buttons with current page info
- **Empty states**: no events, no filters applied, loading skeletons
- **Loading state**: ListSkeleton with 6 placeholder cards
- **Error state**: destructive alert with error message

**URL Parameters:**
```
view=list|calendar          (default: list)
category=social|sports|...  (default: all)
participating=true|false
startDateFrom=YYYY-MM-DD
startDateTo=YYYY-MM-DD
page=NUMBER
buildingId=ID (from filter)
```

**Default behavior:**
- Shows all events in current organization/building
- Sorted by startDate ascending
- 10 events per page
- Category counts calculated from current page events

#### /activities/create

Event creation page (referenced in code, component likely in `/components/features/events/CreateEventDialog.tsx`)

**Expected form fields:**
- Title, description, location
- Start date/time, end date/time
- Category (dropdown)
- Building (if applicable)
- Max participants (optional)
- Group selection (optional)
- Image upload (optional, preview, drag-drop)

#### /activities/[id]

Event detail page (referenced but not provided in files)

**Expected features:**
- Event header with image
- Title, description, location, dates
- Organizer profile card
- Join/Leave button (based on participation status)
- Participants list/avatars
- Event details (status, category, capacity)
- Edit button (if organizer/board)
- Delete/Cancel button (if organizer/board)
- Related events (same building/category)

### Types (fe_grunnsteinen/src/types/index.ts)

```typescript
interface Event {
  id: string;
  organizationId: string;
  organizerId: string;
  organizer: {
    id: string;
    name: string;
    avatarUrl?: string;
    role: UserRole;
  };
  groupId?: string;
  buildingId?: string;
  isOrganizationWide: boolean;
  title: string;
  description: string;
  location: string;
  imageUrl?: string;
  startDate: Date;
  endDate: Date;
  maxParticipants: number;
  participants: string[];  // user IDs
  participantsCount: number;
  category: 'social' | 'sports' | 'cultural' | 'workshop' | 'other';
  isRecurring: boolean;
  recurringPattern?: string;
  status: 'upcoming' | 'ongoing' | 'completed' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}

type EventQueryParams = {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  category?: string;
  status?: string;
  startDateFrom?: Date | string;
  startDateTo?: Date | string;
  organizerId?: string;
  participating?: boolean;
  buildingId?: string;
}

interface CreateEventInput {
  title: string;
  description: string;
  location: string;
  startDate: Date;
  endDate: Date;
  category: EventCategory;
  buildingId: string;
  maxParticipants?: number;
  groupId?: string;
}

interface UpdateEventInput {
  title?: string;
  description?: string;
  location?: string;
  startDate?: Date;
  endDate?: Date;
  category?: EventCategory;
  maxParticipants?: number;
  status?: EventStatus;
  groupId?: string;
  isRecurring?: boolean;
  recurringPattern?: string;
  imageUrl?: string;
}
```

### Query Keys (fe_grunnsteinen/src/lib/api/queryKeys.ts)

```typescript
events: {
  all: [...]
  list: (params) => [...]
  upcoming: (limit) => [...]
  detail: (eventId) => [...]
}
```

### API Endpoints (fe_grunnsteinen/src/lib/api/endpoints.ts)

```typescript
API_ENDPOINTS.EVENTS = {
  LIST: '/events',
  CREATE: '/events',
  UPCOMING: '/events/upcoming',
  BY_ID: (id) => `/events/${id}`,
  JOIN: (id) => `/events/${id}/join`,
  LEAVE: (id) => `/events/${id}/leave`,
  CANCEL: (id) => `/events/${id}/cancel`,
  PARTICIPANTS: (id) => `/events/${id}/participants`,
  UPLOAD_IMAGE: (id) => `/events/${id}/image`,
}
```

## DTO Validation Rules

### CreateEventDto

| Field | Type | Required | Rules |
|-------|------|----------|-------|
| `title` | string | Yes | 3-100 chars |
| `description` | string | Yes | max 2000 chars |
| `location` | string | Yes | required |
| `startDate` | Date | Yes | must be Date, transformed by @Type |
| `endDate` | Date | Yes | must be Date, must be after startDate |
| `category` | EventCategory | Yes | enum: social, sports, cultural, workshop, other |
| `buildingId` | string | Yes | valid MongoDB ID |
| `maxParticipants` | number | No | >= 0, default 0 |
| `groupId` | string | No | valid MongoDB ID if provided |

### UpdateEventDto

All fields optional, same validation rules as CreateEventDto where applicable.

### EventQueryDto (extends PaginationQueryDto)

| Field | Type | Default | Rules |
|-------|------|---------|-------|
| `page` | number | 1 | inherited from PaginationQueryDto |
| `limit` | number | 20 | inherited from PaginationQueryDto |
| `sortBy` | string | startDate | inherited from PaginationQueryDto |
| `sortOrder` | 'asc' \| 'desc' | 'asc' | inherited from PaginationQueryDto |
| `category` | EventCategory | optional | enum if provided |
| `status` | EventStatus | optional | enum if provided |
| `startDateFrom` | Date | optional | date transform |
| `startDateTo` | Date | optional | date transform |
| `organizerId` | string | optional | valid MongoDB ID |
| `participating` | boolean | optional | boolean with transform (handles 'true'/'false' strings) |
| `buildingId` | string | optional | inherited from base (query scoping) |

## Common Patterns

### Fetch and display events list

```typescript
const { data, isLoading, error } = useEvents({
  page: 1,
  limit: 10,
  category: 'social',
  buildingId: buildingId
});

if (isLoading) return <Skeleton />;
if (error) return <GenericError />;
if (!data?.data.length) return <EmptyEvents />;

return data.data.map(event => <EventCard key={event.id} event={event} />);
```

### Create event

```typescript
const createEvent = useCreateEvent();

const handleCreate = async (formData: CreateEventInput) => {
  try {
    await createEvent.mutateAsync(formData);
    toast.success('Opprettet!');
    router.push('/activities');
  } catch (error) {
    toast.error(handleApiError(error));
  }
};
```

### Join/Leave event

```typescript
const joinEvent = useJoinEvent();
const leaveEvent = useLeaveEvent();

const handleJoin = async (eventId: string) => {
  try {
    await joinEvent.mutateAsync(eventId);
    toast.success('Registrert!');
  } catch (error) {
    toast.error(handleApiError(error));
  }
};

const handleLeave = async (eventId: string) => {
  try {
    await leaveEvent.mutateAsync(eventId);
    toast.success('Du har forlatt arrangementet');
  } catch (error) {
    toast.error(handleApiError(error));
  }
};
```

### Upload event image

```typescript
const uploadImage = useUploadEventImage();

const handleImageSelect = async (file: File) => {
  if (!file.type.startsWith('image/')) {
    toast.error('Kun bildefiler er tillatt');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    toast.error('Bildet kan ikke være større enn 5MB');
    return;
  }

  try {
    await uploadImage.mutateAsync({ eventId, file });
    toast.success('Bilde lastet opp!');
  } catch (error) {
    toast.error(handleApiError(error));
  }
};
```

## Key File Paths

| Role | Path |
|------|------|
| BE Controller | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/events/events.controller.ts` |
| BE Service | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/events/events.service.ts` |
| BE Schema | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/events/schemas/event.schema.ts` |
| BE DTOs (all) | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/events/dto/` |
| BE DTO: Create | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/events/dto/create-event.dto.ts` |
| BE DTO: Update | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/events/dto/update-event.dto.ts` |
| BE DTO: Query | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/events/dto/event-query.dto.ts` |
| BE DTO: Response | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/events/dto/event-response.dto.ts` |
| FE Hooks | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/hooks/api/useEvents.ts` |
| FE Page: List | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/app/activities/page.tsx` |
| FE Page: Create | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/app/activities/create/page.tsx` (likely) |
| FE Page: Detail | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/app/activities/[id]/page.tsx` (likely) |
| FE Types | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/types/index.ts` |
| FE API Endpoints | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/lib/api/endpoints.ts` |
| FE Query Keys | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/lib/api/queryKeys.ts` |
