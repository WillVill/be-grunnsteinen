---
paths:
  - "be_grunnsteinen/src/modules/sharing/**"
  - "fe_grunnsteinen/src/hooks/api/useSharing.ts"
  - "fe_grunnsteinen/src/app/sharing/**"
---

# Sharing (Items & Help Requests)

## Overview

The Sharing module manages two interconnected features enabling community resource exchange and mutual support:

1. **Shared Items** — Residents share personal belongings (tools, equipment, toys, etc.) that neighbors can request to borrow
2. **Help Requests** — Residents post requests for assistance with tasks (pet care, handyman, tutoring, errands, etc.) that helpful neighbors can accept and complete

The system tracks item availability, help request status lifecycle (OPEN → ACCEPTED → COMPLETED/CANCELLED), and triggers notifications when requests are made or accepted.

---

## Data Model

### SharedItem Schema

**Collection:** `shareditems`

```
_id                 → ObjectId (serialized as `id`)
organizationId      → ObjectId, required, indexed (→ organizations)
ownerId             → ObjectId, required, indexed (→ users)
buildingId          → ObjectId, optional, indexed (→ buildings)
isOrganizationWide  → boolean, default: false

name                → string, required, trimmed (2-50 chars)
description         → string, optional, trimmed (max 500 chars)
category            → SharedItemCategory enum (required, indexed)
  (TOOLS, OUTDOOR, TOYS, KITCHEN, ELECTRONICS, OTHER)

imageUrl            → string, optional (S3 URL from upload)
isAvailable         → boolean, default: true, indexed
borrowedBy          → ObjectId, optional (→ users, who currently has it)
borrowedAt          → Date, optional (when borrowed)

createdAt           → Date (auto-set)
updatedAt           → Date (auto-updated)
```

### Shared Item Compound Indexes

```
organizationId + isAvailable
organizationId + category + isAvailable
ownerId + isAvailable
organizationId + buildingId + isAvailable
buildingId + isOrganizationWide
name + description (text search)
```

### HelpRequest Schema

**Collection:** `helprequests`

```
_id                 → ObjectId (serialized as `id`)
organizationId      → ObjectId, required, indexed (→ organizations)
requesterId         → ObjectId, required, indexed (→ users, who asked for help)
buildingId          → ObjectId, optional, indexed (→ buildings)
isOrganizationWide  → boolean, default: false

title               → string, required, trimmed (5-100 chars)
description         → string, required, trimmed (1-1000 chars)
category            → HelpRequestCategory enum (required, indexed)
  (PET_CARE, PLANT_CARE, HANDYMAN, TUTORING, ERRANDS, OTHER)

status              → HelpRequestStatus enum (default: OPEN, indexed)
  (OPEN, ACCEPTED, COMPLETED, CANCELLED)
helperId            → ObjectId, optional (→ users, who is helping)
acceptedAt          → Date, optional (when helper accepted)
completedAt         → Date, optional (when marked complete)

createdAt           → Date (auto-set)
updatedAt           → Date (auto-updated)
```

### Help Request Compound Indexes

```
organizationId + status
organizationId + category + status
requesterId + status
organizationId + buildingId + status
buildingId + isOrganizationWide
title + description (text search)
```

---

## API Endpoints

### Shared Items Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/sharing/items` | JWT | Create new shared item |
| GET | `/sharing/items` | JWT | Get paginated shared items with filters |
| GET | `/sharing/items/:id` | JWT | Get shared item by ID |
| PATCH | `/sharing/items/:id` | JWT (owner) | Update shared item (owner only) |
| POST | `/sharing/items/:id/toggle-availability` | JWT (owner) | Toggle item availability (owner only) |
| POST | `/sharing/items/:id/request-borrow` | JWT | Send message to owner requesting to borrow |
| DELETE | `/sharing/items/:id` | JWT (owner) | Delete shared item (owner only, cannot if borrowed) |
| POST | `/sharing/items/:id/image` | JWT (owner) | Upload item image (multipart, max 5MB, throttled 10/min) |

### Help Requests Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/sharing/help-requests` | JWT | Create new help request |
| GET | `/sharing/help-requests` | JWT | Get paginated help requests with filters |
| GET | `/sharing/help-requests/:id` | JWT | Get help request by ID |
| POST | `/sharing/help-requests/:id/accept` | JWT (any) | Accept help request (cannot accept own) |
| POST | `/sharing/help-requests/:id/complete` | JWT (requester/helper) | Mark as completed |
| POST | `/sharing/help-requests/:id/cancel` | JWT (requester) | Cancel request (requester only) |

---

## Business Rules & Logic

### Shared Items: Creation

**Endpoint:** `POST /sharing/items`

**Request body:**
```json
{
  "buildingId": "507f1f77bcf86cd799439011",
  "name": "Power Drill",
  "description": "Cordless power drill with drill bits",
  "category": "tools"
}
```

**Backend logic:**
1. Validate buildingId, name (2-50 chars), description (max 500), category enum
2. Create item with `ownerId` from auth user, `organizationId` from user context
3. Set `isAvailable: true` by default
4. Return populated item with owner details

**Validation:**
- Name: required, 2-50 chars
- Description: optional, max 500 chars
- Category: required, one of TOOLS, OUTDOOR, TOYS, KITCHEN, ELECTRONICS, OTHER
- BuildingId: required, valid MongoDB ObjectId

### Shared Items: Availability Toggle

**Endpoint:** `POST /sharing/items/:id/toggle-availability`

**Authorization:** Owner only (throws 403 if not owner)

**Behavior:**
1. Toggle `isAvailable` boolean
2. If marking unavailable and item is borrowed: clear `borrowedBy` and `borrowedAt` fields
3. Returns updated item

**Use case:** Owner temporarily unavailable, then reopens availability

### Shared Items: Borrow Request

**Endpoint:** `POST /sharing/items/:id/request-borrow`

**Authorization:** Any authenticated user (not owner)

**Behavior:**
1. Verify item exists and is available (throws 400 if not)
2. Verify user ≠ owner (throws 400 if trying to borrow own item)
3. Create MESSAGE_RECEIVED notification to owner
   - Type: `MESSAGE_RECEIVED`
   - Title: "Borrow request"
   - Message: `"{requesterName} wants to borrow your \"{itemName}\""`
   - Link: `/sharing/items/{itemId}`
   - SendEmail: true
4. Returns 204 No Content (no response body)

**Note:** No explicit acceptance/denial mechanism — owner responds via direct message (opens messaging flow)

### Shared Items: Delete

**Endpoint:** `DELETE /sharing/items/:id`

**Authorization:** Owner only (throws 403 if not owner)

**Validation:**
- Cannot delete if currently borrowed (throws 400: "Cannot delete an item that is currently borrowed")

**Behavior:**
1. Verify owner and not borrowed
2. Hard delete from database
3. Returns 204 No Content

### Shared Items: Image Upload

**Endpoint:** `POST /sharing/items/:id/image`

**Authorization:** Owner only (throws 403 if not owner)

**Validation:**
- File types: jpg, jpeg, png, webp
- Max size: 5 MB
- Rate limited: 10 requests/min via `@ThrottleUpload()`

**Flow:**
1. File validated by `ParseFilePipe`
2. Uploaded to S3 at path: `sharing/items/{itemId}/images`
3. Item document updated with `imageUrl`
4. Returns updated item with new imageUrl

### Help Requests: Creation

**Endpoint:** `POST /sharing/help-requests`

**Request body:**
```json
{
  "buildingId": "507f1f77bcf86cd799439011",
  "title": "Need someone to walk my dog",
  "description": "I need someone to walk my dog on Saturday morning around 8 AM",
  "category": "pet-care"
}
```

**Backend logic:**
1. Validate buildingId, title (5-100 chars), description (1-1000 chars), category enum
2. Create request with `requesterId` from auth user, `organizationId` from user context
3. Set `status: OPEN` by default
4. Return populated request with requester details

**Validation:**
- Title: required, 5-100 chars
- Description: required, 1-1000 chars
- Category: required, one of PET_CARE, PLANT_CARE, HANDYMAN, TUTORING, ERRANDS, OTHER
- BuildingId: required, valid MongoDB ObjectId

### Help Requests: Accept

**Endpoint:** `POST /sharing/help-requests/:id/accept`

**Authorization:** Any authenticated user (not requester)

**Behavior:**
1. Fetch request
2. Verify status is OPEN (throws 400 if not)
3. Verify current user ≠ requester (throws 400: "Cannot accept your own help request")
4. Update request:
   - Set `status: ACCEPTED`
   - Set `helperId` to current user
   - Set `acceptedAt: now`
5. Create MESSAGE_RECEIVED notification to requester
   - Type: `MESSAGE_RECEIVED`
   - Title: "Help request accepted"
   - Message: `"{helperName} has accepted your help request: \"{title}\""`
   - Link: `/sharing/help-requests/{requestId}`
   - SendEmail: true
6. Return updated request

**Note:** No notification to accepter (they initiated the action)

### Help Requests: Complete

**Endpoint:** `POST /sharing/help-requests/:id/complete`

**Authorization:** Requester or Helper only (throws 403 if neither)

**Behavior:**
1. Fetch request
2. Verify status is ACCEPTED (throws 400 if not: "Help request must be accepted before completion")
3. Verify current user is either requester or helper (throws 403 if neither)
4. Update request:
   - Set `status: COMPLETED`
   - Set `completedAt: now`
5. Create MESSAGE_RECEIVED notification to other party (helper if requester completing, requester if helper completing)
   - Type: `MESSAGE_RECEIVED`
   - Title: "Help request completed"
   - Message: `"{currentUserName} has marked the help request \"{title}\" as completed"`
   - Link: `/sharing/help-requests/{requestId}`
   - SendEmail: true
6. Return updated request

### Help Requests: Cancel

**Endpoint:** `POST /sharing/help-requests/:id/cancel`

**Authorization:** Requester only (throws 403 if not requester)

**Behavior:**
1. Fetch request
2. Verify status is not COMPLETED (throws 400 if completed: "Cannot cancel a completed help request")
3. Verify status is not already CANCELLED (throws 400 if already cancelled)
4. Verify current user is requester (throws 403 if not)
5. Update request:
   - Set `status: CANCELLED`
6. If helper assigned: create MESSAGE_RECEIVED notification to helper
   - Type: `MESSAGE_RECEIVED`
   - Title: "Help request cancelled"
   - Message: "The help request \"{title}\" has been cancelled"
   - Link: `/sharing/help-requests`
   - SendEmail: true
7. Return updated request

### Querying Shared Items

**Endpoint:** `GET /sharing/items`

**Query parameters:**
```
page: number              // default: 1
limit: number             // default: 20
sortBy: string            // default: "name"
sortOrder: "asc" | "desc" // default: "asc"
category?: string         // filter by category
isAvailable?: boolean     // filter by availability (default: true = available only)
ownerId?: string          // filter by owner
buildingId?: string       // filter by building or org-wide
```

**Scoping rules:**
- Always scoped by `organizationId` from user token
- Default filters to available items only (`isAvailable: true`)
- If `buildingId` provided: show items from that building OR org-wide items via `$or`

**Response includes:** owner details (name, avatar, role), borrowedBy user if applicable

### Querying Help Requests

**Endpoint:** `GET /sharing/help-requests`

**Query parameters:**
```
page: number              // default: 1
limit: number             // default: 20
sortBy: string            // default: "createdAt"
sortOrder: "asc" | "desc" // default: "desc"
category?: string         // filter by category
status?: string           // filter by status (default: OPEN only)
buildingId?: string       // filter by building or org-wide
```

**Scoping rules:**
- Always scoped by `organizationId` from user token
- Default filters to OPEN requests only if status not specified
- If `buildingId` provided: show requests from that building OR org-wide requests via `$or`

**Response includes:** requester and helper details (name, avatar, role)

---

## Notifications & Side Effects

### BORROW_REQUEST (Shared Items)

Sent when user requests to borrow an item.

**Recipient:** Item owner
**Type:** `MESSAGE_RECEIVED`
**Title:** "Borrow request"
**Message:** `"{requesterName} wants to borrow your \"{itemName}\""`
**Link:** `/sharing/items/{itemId}`
**Email:** true

### HELP_REQUEST_ACCEPTED

Sent when someone accepts a help request.

**Recipient:** Requester (person who asked for help)
**Type:** `MESSAGE_RECEIVED`
**Title:** "Help request accepted"
**Message:** `"{helperName} has accepted your help request: \"{title}\""`
**Link:** `/sharing/help-requests/{requestId}`
**Email:** true

### HELP_REQUEST_COMPLETED

Sent when requester or helper marks the request as completed.

**Recipient:** Other party (helper if requester completing, requester if helper completing)
**Type:** `MESSAGE_RECEIVED`
**Title:** "Help request completed"
**Message:** `"{currentUserName} has marked the help request \"{title}\" as completed"`
**Link:** `/sharing/help-requests/{requestId}`
**Email:** true

### HELP_REQUEST_CANCELLED

Sent when requester cancels a help request that has an assigned helper.

**Recipient:** Helper
**Type:** `MESSAGE_RECEIVED`
**Title:** "Help request cancelled"
**Message:** "The help request \"{title}\" has been cancelled"
**Link:** `/sharing/help-requests`
**Email:** true

---

## Frontend

### Hooks

Located in `fe_grunnsteinen/src/hooks/api/useSharing.ts`

#### Shared Items Queries

**useSharedItems(params?: SharedItemQueryParams)**
- Fetch paginated shared items with filters
- Params: page, limit, sortBy, sortOrder, category, isAvailable, buildingId
- Returns: `{ data: PaginatedResponse<SharedItem>, isLoading, error }`
- Query key: `queryKeys.sharing.items(params)`
- Default: available items only

**useSharedItem(id: string)**
- Fetch single shared item by ID
- Returns: `{ data: SharedItem, isLoading, error }`
- Query key: `queryKeys.sharing.item(id)`
- Disabled if no id

#### Shared Items Mutations

**useCreateSharedItem()**
- Input: `{ name, description?, category, buildingId }`
- On success: invalidates items list queries

**useUpdateSharedItem()**
- Input: `{ id, data: { name?, description?, category?, isAvailable? } }`
- On success: invalidates detail and list queries

**useToggleItemAvailability()**
- Input: item id
- On success: optimistically updates detail query + invalidates list
- Use case: Quick toggle of availability without full form

**useRequestBorrow()**
- Input: item id
- Returns 204 No Content (no response body)
- Side effect: Sends notification to owner (handled server-side)
- Note: No cache invalidation needed (request only sends notification)

**useUploadItemImage()**
- Input: `{ id, file }`
- Returns updated SharedItem with imageUrl
- On success: updates detail query with new image
- Rate limited: 10 req/min

**useDeleteSharedItem()**
- Input: item id
- Returns 204 No Content
- On success: invalidates items list
- Note: Throws error if item is currently borrowed

#### Help Requests Queries

**useHelpRequests(params?: HelpRequestQueryParams)**
- Fetch paginated help requests with filters
- Params: page, limit, sortBy, sortOrder, category, status, buildingId
- Returns: `{ data: PaginatedResponse<HelpRequest>, isLoading, error }`
- Query key: `queryKeys.sharing.helpRequests(params)`
- Default: OPEN requests only

**useHelpRequest(id: string)**
- Fetch single help request by ID
- Returns: `{ data: HelpRequest, isLoading, error }`
- Query key: `queryKeys.sharing.helpRequest(id)`
- Disabled if no id

#### Help Requests Mutations

**useCreateHelpRequest()**
- Input: `{ title, description, category, buildingId }`
- On success: invalidates help requests list queries

**useAcceptHelpRequest()**
- Input: request id
- On success: invalidates detail and list queries
- Error: Throws 400 if not OPEN or if trying to accept own request

**useCompleteHelpRequest()**
- Input: request id
- On success: invalidates detail and list queries
- Error: Throws 400 if not ACCEPTED; throws 403 if not requester/helper

**useCancelHelpRequest()**
- Input: request id
- On success: invalidates detail and list queries
- Error: Throws 400 if not cancellable; throws 403 if not requester

### Pages

#### `/sharing` (Sharing Hub)

Main sharing page (assumed to exist, may be tabs with items + help requests).

**Features:**
- Tabs or toggle: "Verktøy & Ting" (Shared Items) vs "Få Hjelp" (Help Requests)
- Quick stats: total items, available items, open help requests
- Quick create buttons for both items and help requests
- Filtering options for each tab

#### `/sharing/items`

Shared items listing page.

**Features:**
- Grid of shared item cards (mobile: 1 col, tablet: 2, desktop: 3)
- Category filter (tab bar or dropdown)
- Availability toggle filter
- Search by name or description
- Pagination

**Item Cards:**
- Image with fallback (category icon on gradient)
- Item name (bold)
- Owner avatar, name, building (smaller text)
- Category badge (colored)
- "Available" status indicator
- Action buttons:
  - If owner: Edit, Delete, Toggle Availability
  - If not owner: "Spør om lån" (Request to Borrow) button
- Click card → detail page

#### `/sharing/items/[id]`

Shared item detail page.

**Features:**
- Large image carousel/viewer
- Item name, description, category, owner info
- Owner profile card (name, avatar, contact info if available)
- Building and availability status
- If owner:
  - Edit button → opens update dialog
  - Delete button (with confirmation)
  - Toggle availability switch
  - Upload additional images button
- If not owner:
  - "Spør om lån" button → opens message dialog to start conversation
- Related items (same category, same building)
- Comments or discussion thread (if integrated with messaging)

#### `/sharing/help`

Help requests listing page.

**Features:**
- List or grid of help request cards
- Category filter (tab bar: All, Pet Care, Handyman, Tutoring, Errands, etc.)
- Status filter: Open, Accepted, Completed, Cancelled
- Search by title or description
- Pagination
- "Treng hjelp?" button to create new request

**Help Request Cards:**
- Requester avatar, name, building
- Category badge (colored)
- Title (bold), description snippet (line-clamp-2)
- Status badge (Open = green, Accepted = blue, Completed = gray, Cancelled = red)
- Participant count: requester + helper (if assigned)
- Created date (relative: "2 hours ago")
- Action buttons:
  - If not requester & status is OPEN: "Jeg kan hjelpe" (Accept) button
  - If helper or requester: View button → detail page
  - If requester: Cancel button (if status not COMPLETED/CANCELLED)

#### `/sharing/help/[id]`

Help request detail page.

**Features:**
- Title, description, category, status
- Requester profile card
- Timeline of events:
  - Created at
  - Accepted by [helper name] at [date]
  - Completed at [date]
- If helper assigned: helper profile card
- If status OPEN:
  - "Jeg kan hjelpe" button (if not requester)
- If status ACCEPTED:
  - If requester: "Markér som ferdig" button
  - If helper: "Markér som ferdig" button
  - "Avbryt" button (requester only)
- If status COMPLETED or CANCELLED:
  - View-only, no action buttons
- Comments or discussion thread

### Types

Located in `fe_grunnsteinen/src/types/index.ts`

```typescript
interface SharedItem {
  id: string;
  organizationId: string;
  ownerId: string | { id: string; name: string; avatarUrl?: string; role: UserRole };
  buildingId?: string;
  isOrganizationWide: boolean;
  name: string;
  description?: string;
  category: 'tools' | 'outdoor' | 'toys' | 'kitchen' | 'electronics' | 'other';
  imageUrl?: string;
  isAvailable: boolean;
  borrowedBy?: string | { id: string; name: string; avatarUrl?: string };
  borrowedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface HelpRequest {
  id: string;
  organizationId: string;
  requesterId: string | { id: string; name: string; avatarUrl?: string; role: UserRole };
  buildingId?: string;
  isOrganizationWide: boolean;
  title: string;
  description: string;
  category: 'pet-care' | 'plant-care' | 'handyman' | 'tutoring' | 'errands' | 'other';
  status: 'open' | 'accepted' | 'completed' | 'cancelled';
  helperId?: string | { id: string; name: string; avatarUrl?: string; role: UserRole };
  acceptedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface SharedItemQueryParams extends PaginationParams {
  category?: string;
  isAvailable?: boolean;
}

interface HelpRequestQueryParams extends PaginationParams {
  category?: string;
  status?: string;
}

interface CreateSharedItemData {
  name: string;
  description?: string;
  category: string;
  buildingId: string;
}

interface UpdateSharedItemData {
  name?: string;
  description?: string;
  category?: string;
  isAvailable?: boolean;
}

interface CreateHelpRequestData {
  title: string;
  description: string;
  category: string;
  buildingId: string;
}
```

### Query Keys

Located in `fe_grunnsteinen/src/lib/api/queryKeys.ts`

```typescript
sharing: {
  items: (params?) => [...],
  item: (id) => [...],
  helpRequests: (params?) => [...],
  helpRequest: (id) => [...],
}
```

### API Endpoints

Located in `fe_grunnsteinen/src/lib/api/endpoints.ts`

```typescript
API_ENDPOINTS.SHARING = {
  ITEMS: '/sharing/items',
  ITEM_BY_ID: (id) => `/sharing/items/${id}`,
  ITEM_IMAGE: (id) => `/sharing/items/${id}/image`,
  TOGGLE_AVAILABILITY: (id) => `/sharing/items/${id}/toggle-availability`,
  REQUEST_BORROW: (id) => `/sharing/items/${id}/request-borrow`,
  HELP_REQUESTS: '/sharing/help-requests',
  HELP_REQUEST_BY_ID: (id) => `/sharing/help-requests/${id}`,
  ACCEPT_HELP: (id) => `/sharing/help-requests/${id}/accept`,
  COMPLETE_HELP: (id) => `/sharing/help-requests/${id}/complete`,
  CANCEL_HELP: (id) => `/sharing/help-requests/${id}/cancel`,
}
```

---

## DTO Validation Rules

### CreateSharedItemDto

| Field | Type | Required | Rules |
|-------|------|----------|-------|
| `buildingId` | string | Yes | Valid MongoDB ObjectId |
| `name` | string | Yes | 2–50 chars |
| `description` | string | No | Max 500 chars |
| `category` | enum | Yes | One of: tools, outdoor, toys, kitchen, electronics, other |

### UpdateSharedItemDto

All fields optional, same validation rules as creation where applicable.

**Additional field:**
| `isAvailable` | boolean | No | — |

### SharedItemQueryDto (extends PaginationQueryDto)

| Field | Type | Constraints |
|-------|------|-------------|
| `category` | enum | Optional |
| `isAvailable` | boolean | Optional (transform: string 'true'/'false' → boolean) |
| `ownerId` | string | Optional, valid MongoDB ObjectId |

### CreateHelpRequestDto

| Field | Type | Required | Rules |
|-------|------|----------|-------|
| `buildingId` | string | Yes | Valid MongoDB ObjectId |
| `title` | string | Yes | 5–100 chars |
| `description` | string | Yes | 1–1000 chars |
| `category` | enum | Yes | One of: pet-care, plant-care, handyman, tutoring, errands, other |

### HelpRequestQueryDto (extends PaginationQueryDto)

| Field | Type | Constraints |
|-------|------|-------------|
| `category` | enum | Optional |
| `status` | enum | Optional |

---

## Key File Paths

| Role | Path |
|------|------|
| **BE Controller** | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/sharing/sharing.controller.ts` |
| **BE Service** | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/sharing/sharing.service.ts` |
| **BE SharedItem Schema** | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/sharing/schemas/shared-item.schema.ts` |
| **BE HelpRequest Schema** | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/sharing/schemas/help-request.schema.ts` |
| **BE DTOs** | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/sharing/dto/` |
| DTO: Create SharedItem | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/sharing/dto/create-shared-item.dto.ts` |
| DTO: Update SharedItem | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/sharing/dto/update-shared-item.dto.ts` |
| DTO: Create HelpRequest | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/sharing/dto/create-help-request.dto.ts` |
| **BE Module** | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/sharing/sharing.module.ts` |
| **FE Hooks** | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/hooks/api/useSharing.ts` |
| **FE Page: Hub** | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/app/sharing/page.tsx` |
| **FE Page: Items List** | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/app/sharing/items/page.tsx` |
| **FE Page: Item Detail** | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/app/sharing/items/[id]/page.tsx` |
| **FE Page: Help Detail** | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/app/sharing/help/[id]/page.tsx` |
| **FE Types** | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/types/index.ts` (SharedItem, HelpRequest sections) |
| **FE API Endpoints** | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/lib/api/endpoints.ts` (API_ENDPOINTS.SHARING) |
| **FE Query Keys** | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/lib/api/queryKeys.ts` (queryKeys.sharing) |

---

## Common Patterns

### Fetch and display available shared items

```typescript
const { data: itemsData, isLoading } = useSharedItems({
  category: 'tools',
  isAvailable: true,
  buildingId: buildingId,
  limit: 20,
  page: 1
});

if (isLoading) return <Skeleton />;
if (!itemsData?.data?.length) return <EmptySharedItems />;

itemsData.data.map(item => (
  <SharedItemCard key={item.id} item={item} />
));
```

### Request to borrow an item

```typescript
const requestBorrow = useRequestBorrow();

const handleRequestBorrow = async (itemId: string) => {
  try {
    await requestBorrow.mutateAsync(itemId);
    toast.success('Forespørsel sendt til eier!');
    // Message conversation may open automatically if implemented
  } catch (error) {
    if (error.message?.includes('not available')) {
      toast.error('Gjenstanden er ikke tilgjengelig');
    } else {
      toast.error('Kunne ikke sende forespørsel');
    }
  }
};
```

### Accept a help request

```typescript
const acceptHelp = useAcceptHelpRequest();

const handleAcceptHelp = async (requestId: string) => {
  try {
    await acceptHelp.mutateAsync(requestId);
    toast.success('Du har akseptert forespørselen!');
    // Detail query invalidated, page refetched
  } catch (error) {
    if (error.message?.includes('Cannot accept your own')) {
      toast.error('Du kan ikke akseptere din egen forespørsel');
    } else {
      toast.error('Kunne ikke akseptere forespørselen');
    }
  }
};
```

### Create and manage shared item

```typescript
const createItem = useCreateSharedItem();
const updateItem = useUpdateSharedItem();
const deleteItem = useDeleteSharedItem();

// Create
const handleCreate = async (formData: CreateSharedItemData) => {
  try {
    await createItem.mutateAsync(formData);
    toast.success('Gjenstand opprettet!');
  } catch (error) {
    toast.error(handleApiError(error));
  }
};

// Update availability
const handleToggleAvailability = async (itemId: string) => {
  try {
    await updateItem.mutateAsync({
      id: itemId,
      data: { isAvailable: !item.isAvailable }
    });
    toast.success('Status oppdatert!');
  } catch (error) {
    toast.error(handleApiError(error));
  }
};

// Delete
const handleDelete = async (itemId: string) => {
  if (!confirm('Slette gjenstanden?')) return;
  try {
    await deleteItem.mutateAsync(itemId);
    toast.success('Gjenstand slettet!');
    router.push('/sharing/items');
  } catch (error) {
    toast.error(handleApiError(error));
  }
};
```

### Complete a help request

```typescript
const completeHelp = useCompleteHelpRequest();

const handleMarkComplete = async (requestId: string) => {
  try {
    await completeHelp.mutateAsync(requestId);
    toast.success('Forespørsel merket som ferdig!');
  } catch (error) {
    toast.error(handleApiError(error));
  }
};
```

