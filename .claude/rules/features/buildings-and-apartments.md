---
paths:
  - "be_grunnsteinen/src/modules/buildings/**"
  - "be_grunnsteinen/src/modules/apartments/**"
  - "fe_grunnsteinen/src/hooks/api/useBuildings.ts"
  - "fe_grunnsteinen/src/hooks/api/useApartments.ts"
  - "fe_grunnsteinen/src/app/admin/buildings/**"
---

# Buildings & Apartments

## Overview

The Buildings & Apartments modules manage the physical organization structure within each housing association (organization). Buildings represent distinct residential properties (houses, apartment complexes), and Apartments represent individual units within those buildings. Together they form the foundational hierarchy: **Organization** → **Building** → **Apartment** → **Users (Tenants)**.

Key responsibilities:
- **Buildings module:** Create, read, update, soft-delete buildings; manage user assignments; send broadcast messages (email/SMS) to tenants
- **Apartments module:** Create, read, update, soft-delete apartments; track tenant assignments (registered users only); enforce unit number uniqueness per building

---

## Data Model

### Building Schema

**Collection:** `buildings`

```
_id                 → ObjectId (serialized as `id`)
organizationId      → ObjectId, ref Organization, required, indexed
name                → string, required, trimmed (1-100 chars)
code?               → string, optional, trimmed, indexed (max 20 chars)
address?            → string, optional, trimmed (max 200 chars)
city?               → string, optional, trimmed (max 100 chars)
postalCode?         → string, optional, trimmed (max 20 chars)
description?        → string, optional, trimmed (max 500 chars)
settings            → BuildingSettings (embedded object)
isActive            → boolean, default: true, indexed
createdAt           → Date (auto)
updatedAt           → Date (auto)
```

**BuildingSettings (embedded):**

```
allowResidentPosts      → boolean, default: true
allowResidentEvents     → boolean, default: true
requireBookingApproval  → boolean, default: false
```

**Indexes:**

- `(organizationId, code)` — unique (sparse) — code must be unique per organization
- `(organizationId, isActive)` — compound index for filtering
- Single field indexes: `organizationId`, `isActive`

---

### Apartment Schema

**Collection:** `apartments`

```
_id                 → ObjectId (serialized as `id`)
organizationId      → ObjectId, ref Organization, required, indexed
buildingId          → ObjectId, ref Building, required, indexed
unitNumber          → string, required, trimmed (1-20 chars)
floor?              → number, optional
sizeSqm?            → number, optional, min 0
numberOfRooms?      → number, optional, min 0
apartmentType?      → enum ApartmentType (see below)
description?        → string, optional, trimmed (max 500 chars)
tenantIds[]         → ObjectId[], ref User, default: []
  (populated users only — only registered users in this array)
isActive            → boolean, default: true, indexed
createdAt           → Date (auto)
updatedAt           → Date (auto)
```

**ApartmentType Enum:**

```
"1-room"      — 1-room apartment
"2-room"      — 2-room apartment
"3-room"      — 3-room apartment
"4-room"      — 4-room apartment
"5+room"      — 5+ room apartment
"other"       — other/unspecified type
```

**Indexes:**

- `(buildingId, unitNumber)` — unique — unit number must be unique within a building
- `(buildingId, isActive)` — query active apartments in building
- `(organizationId, buildingId)` — compound query across organization

---

## API Endpoints

### Buildings Endpoints

| Method | Endpoint | Auth | Request | Response | Notes |
|--------|----------|------|---------|----------|-------|
| POST | `/buildings` | ADMIN | `CreateBuildingDto` | `Building` | Create new building |
| GET | `/buildings` | ADMIN, BOARD | `BuildingQueryDto` (query) | `PaginatedResponse<Building>` | List buildings with pagination + search |
| GET | `/buildings/:id` | ADMIN, BOARD | — | `Building` | Get single building |
| PATCH | `/buildings/:id` | ADMIN | `UpdateBuildingDto` | `Building` | Update building info/settings |
| DELETE | `/buildings/:id` | ADMIN | — | `Building` | Soft-delete (sets `isActive: false`) |
| GET | `/buildings/:id/users` | ADMIN, BOARD | — | `User[]` | Get all users assigned to building |
| POST | `/buildings/:id/users` | ADMIN | `AssignUserToBuildingDto` | `User` | Assign user to building |
| DELETE | `/buildings/:id/users/:userId` | ADMIN | — | `User` | Remove user from building |
| GET | `/buildings/:id/stats` | ADMIN, BOARD | — | `BuildingStats` | Get building statistics |
| POST | `/buildings/:id/send-message` | ADMIN, BOARD | `SendBuildingMessageDto` | `SendMessageResult` | Send email/SMS to tenants |

**Query Parameters for GET /buildings:**

```
page: number              // default 1
limit: number             // default 20
search: string            // search name, code, or address (regex, case-insensitive)
isActive: boolean         // filter by active status (optional)
```

### Apartments Endpoints

| Method | Endpoint | Auth | Request | Response | Notes |
|--------|----------|------|---------|----------|-------|
| POST | `/apartments` | ADMIN | `CreateApartmentDto` | `Apartment` | Create new apartment |
| GET | `/apartments` | ADMIN, BOARD | `ApartmentQueryDto` (query) | `PaginatedResponse<Apartment>` | List apartments with pagination |
| GET | `/apartments/:id` | ADMIN, BOARD | — | `Apartment` | Get single apartment (populates tenantIds) |
| PATCH | `/apartments/:id` | ADMIN | `UpdateApartmentDto` | `Apartment` | Update apartment info |
| DELETE | `/apartments/:id` | ADMIN | — | `Apartment` | Soft-delete (sets `isActive: false`) |
| POST | `/apartments/:id/tenant` | ADMIN | `AssignTenantDto` | `Apartment` | Assign registered user to apartment |
| DELETE | `/apartments/:id/tenant/:userId` | ADMIN | — | `Apartment` | Remove user from apartment |

**Query Parameters for GET /apartments:**

```
page: number              // default 1
limit: number             // default 50
buildingId: string        // filter by building (optional)
search: string            // search unitNumber or description (regex, case-insensitive)
isActive: boolean         // filter by active status (optional)
```

---

## Business Rules & Logic

### Building CRUD

**Create:**
- All fields optional except `name` (1-100 chars)
- If `code` provided: must be unique per organization (409 ConflictException)
- `settings` defaults to `{ allowResidentPosts: true, allowResidentEvents: true, requireBookingApproval: false }`
- `isActive` defaults to `true`
- `organizationId` auto-populated from authenticated user

**Read:**
- Filtered by `organizationId` (scoped access)
- Pagination: page/limit with default sort by name (ascending)
- Search filters by name, code, or address (case-insensitive regex)
- Optional `isActive` filter

**Update:**
- All fields optional (partial update via `UpdateBuildingDto`)
- If updating `code`: check uniqueness against other buildings in org (409 ConflictException)
- Cannot update `organizationId`
- Settings are nested partial update (only changed fields merged)
- `isActive` can be toggled

**Delete (Soft Delete):**
- Sets `isActive: false` (not removed from DB)
- Prevents deletion if building has assigned users (BadRequestException: "Cannot delete building with N assigned user(s). Remove users first.")
- User must be removed via `DELETE /buildings/:id/users/:userId` first
- Soft-deleted buildings excluded from default queries

### User Assignment to Buildings

**Assign User** (`POST /buildings/:id/users`)
- User must exist and belong to same organization
- If user already assigned to this building: returns 200 with no changes
- Auto-adds `buildingId` to `user.buildingIds` array (idempotent via `$addToSet`)
- If `isPrimary: true` OR user has no `primaryBuildingId`: sets this as primary building
- Returns updated user (without password fields)

**Remove User** (`DELETE /buildings/:id/users/:userId`)
- Removes `buildingId` from `user.buildingIds` array
- If this was their `primaryBuildingId`:
  - Finds next remaining building (if any)
  - Sets as new primary
  - Otherwise clears `primaryBuildingId`
- Returns updated user (without password fields)

### Building Statistics

**Endpoint:** `GET /buildings/:id/stats`

Returns:
```json
{
  "totalUsers": 42,
  "activeUsers": 38,
  "usersByRole": {
    "resident": 35,
    "board": 2,
    "admin": 1
  }
}
```

**Logic:**
- `totalUsers`: count of all users with this building in `buildingIds` (active or inactive)
- `activeUsers`: count of users with `isActive: true`
- `usersByRole`: aggregated count by user role (via MongoDB aggregation pipeline)

### Building Messaging (Email & SMS)

**Endpoint:** `POST /buildings/:id/send-message`

**Purpose:** Send broadcast messages (email and/or SMS) to all tenants in a building.

**Recipients:**
1. **Registered users** in the building (from `building.users`)
2. **Unregistered/invited TenantProfiles** (status !== 'registered') if targeting them

**Behavior:**
- If `recipientIds` provided: filter to only those user IDs
- If `tenantProfileIds` provided: filter to only those tenant profile IDs
- If neither provided: send to all building users + all unregistered/invited tenant profiles

**Message Types:**
- `email`: Send via SendGrid to user.email
- `sms`: Send via Twilio to user.phone (normalized to E.164 format)
- `both`: Send both email and SMS

**Email:**
- Requires `subject` (auto-generated if not provided: `Message from {buildingName}`)
- `body` newlines converted to `<br/>` tags for HTML
- Optional `attachments` array (base64-encoded files with MIME type)
- Logged warning if individual send fails (non-blocking)

**SMS:**
- Phone numbers normalized to E.164 format via TwilioService
- Skipped if phone invalid (counted in `skippedSms`)
- Logged warning if Twilio not configured (non-blocking)
- Logged warning if individual send fails (non-blocking)

**Response:**
```json
{
  "sentEmail": 42,
  "sentSms": 35,
  "skippedSms": 7
}
```

**Validation:**
- `type` required: 'email' | 'sms' | 'both'
- `body` required (string)
- `subject` required if type is 'email' or 'both'
- `recipientIds`, `tenantProfileIds` optional arrays of valid MongoDB ObjectIds
- `attachments` optional array of base64-encoded file objects

---

### Apartment CRUD

**Create:**
- `buildingId` required (must exist and belong to user's organization)
- `unitNumber` required (1-20 chars, must be unique per building — 409 ConflictException)
- All other fields optional
- `apartmentType` must be one of enum values (1-room, 2-room, ..., other)
- `tenantIds` defaults to empty array
- `isActive` defaults to `true`

**Read:**
- Filtered by `organizationId` and optional `buildingId`
- Pagination: page/limit with default sort by unitNumber
- `tenantIds` auto-populated with User documents (fields: all except password, reset token)
- Search filters by unitNumber or description (case-insensitive regex)
- Optional `isActive` filter

**Update:**
- All fields optional except `buildingId` (cannot move apartment to different building)
- If updating `unitNumber`: check uniqueness within the same building (409 ConflictException)
- `tenantIds` not directly updatable via this endpoint (use tenant assignment endpoints)
- `isActive` can be toggled

**Delete (Soft Delete):**
- Sets `isActive: false`
- Prevents deletion if apartment has tenants assigned (BadRequestException: "Cannot deactivate apartment with assigned tenants. Remove all tenants first.")
- All tenants must be removed via `DELETE /apartments/:id/tenant/:userId` first

### Tenant Assignment to Apartments

**Assign Tenant** (`POST /apartments/:id/tenant`)
- `userId` required (user must exist and belong to same organization)
- Prevents duplicate: if user already a tenant, returns 400 (BadRequestException)
- Auto-adds apartment's building to user's `buildingIds` (if not already assigned)
- Sets building as `primaryBuildingId` if user has no primary
- Adds user to `apartment.tenantIds` array
- Returns populated apartment

**Remove Tenant** (`DELETE /apartments/:id/tenant/:userId`)
- User must be current tenant of apartment (else 400 BadRequestException)
- Removes user from `apartment.tenantIds`
- Does NOT remove from `building.buildingIds` (keeps building assignment)
- Does NOT remove from `user.primaryBuildingId` (primary building unchanged)
- Returns populated apartment

**Key Invariant:** `apartment.tenantIds` contains **only registered User ObjectIds**. Never contains unregistered TenantProfiles. Use TenantProfile module for managing unregistered tenants.

---

## Notifications & Side Effects

### Building Operations

**Create building:**
- Logged at info level

**Update building:**
- Logged at info level

**Assign user to building:**
- Cache invalidated: `queryKeys.buildings.users(buildingId)` + `queryKeys.buildings.stats(buildingId)` + `queryKeys.users.all`

**Remove user from building:**
- Cache invalidated: same as assign
- If removed user's primary building is this building: primary is reassigned or cleared

**Send building message:**
- All email/SMS failures are caught and logged as warnings (non-blocking)
- Twilio configuration check performed before SMS attempts
- Result count is logged

### Apartment Operations

**Create apartment:**
- Logged at info level

**Update apartment:**
- Logged at info level

**Assign tenant:**
- User auto-added to building if not already assigned
- User's `primaryBuildingId` set if no primary exists
- Cache invalidated: `queryKeys.apartments.all` + `queryKeys.buildings.all` + `queryKeys.users.all`

**Remove tenant:**
- Only removed from apartment (building and primary building unchanged)
- Cache invalidated: `queryKeys.apartments.all`

---

## Frontend

### Building Hooks

**Location:** `fe_grunnsteinen/src/hooks/api/useBuildings.ts`

```typescript
// Query Hooks
useBuildings(params)              // Fetch paginated list
  → { data: { data: Building[], total, page, limit }, isLoading, isError }

useBuilding(id)                   // Fetch single building
  → { data: Building | undefined, isLoading, isError }

useBuildingUsers(buildingId)      // Fetch users assigned to building
  → { data: User[] | undefined, isLoading, isError }

useBuildingStats(buildingId)      // Fetch building stats
  → { data: BuildingStats | undefined, isLoading, isError }

// Mutation Hooks
useCreateBuilding()               // Create new building
  → { mutate, mutateAsync, isLoading, error }

useUpdateBuilding()               // Update building
  → { mutate, mutateAsync, isLoading, error }

useDeleteBuilding()               // Delete (soft) building
  → { mutate, mutateAsync, isLoading, error }

useAssignUserToBuilding()         // Assign user to building
  → { mutate, mutateAsync, isLoading, error }

useRemoveUserFromBuilding()       // Remove user from building
  → { mutate, mutateAsync, isLoading, error }

useSendBuildingMessage()          // Send message to tenants
  → { mutate, mutateAsync, isLoading, error }
  // Returns SendBuildingMessageResult { sentEmail, sentSms, skippedSms }
```

**Query Parameters:**
```typescript
interface BuildingQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  isActive?: boolean;
}
```

**Input Types:**
```typescript
interface CreateBuildingInput {
  name: string;
  code?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  description?: string;
  settings?: {
    allowResidentPosts?: boolean;
    allowResidentEvents?: boolean;
    requireBookingApproval?: boolean;
  };
}

interface UpdateBuildingInput extends Partial<CreateBuildingInput> {
  isActive?: boolean;
}

interface AssignUserInput {
  userId: string;
  isPrimary?: boolean;
}

interface SendBuildingMessageInput {
  type: 'email' | 'sms' | 'both';
  subject?: string;
  body: string;
  recipientIds?: string[];
  tenantProfileIds?: string[];
  attachments?: EmailAttachment[];
}
```

### Apartment Hooks

**Location:** `fe_grunnsteinen/src/hooks/api/useApartments.ts`

```typescript
// Query Hooks
useApartments(params)             // Fetch paginated list
  → { data: { data: Apartment[], total, page, limit }, isLoading, isError }

useApartment(id)                  // Fetch single apartment
  → { data: Apartment | undefined, isLoading, isError }

// Mutation Hooks
useCreateApartment()              // Create new apartment
  → { mutate, mutateAsync, isLoading, error }

useUpdateApartment()              // Update apartment
  → { mutate, mutateAsync, isLoading, error }

useDeleteApartment()              // Delete (soft) apartment
  → { mutate, mutateAsync, isLoading, error }

useAssignTenant()                 // Assign user to apartment
  → { mutate, mutateAsync, isLoading, error }

useRemoveTenant()                 // Remove user from apartment
  → { mutate, mutateAsync, isLoading, error }
```

**Query Parameters:**
```typescript
interface ApartmentQueryParams {
  page?: number;
  limit?: number;
  buildingId?: string;
  search?: string;
  isActive?: boolean;
}
```

**Input Types:**
```typescript
interface CreateApartmentInput {
  buildingId: string;
  unitNumber: string;
  floor?: number;
  sizeSqm?: number;
  numberOfRooms?: number;
  apartmentType?: string;
  description?: string;
}

interface UpdateApartmentInput extends Partial<Omit<CreateApartmentInput, 'buildingId'>> {
  isActive?: boolean;
}
```

### Building Store

**Location:** `fe_grunnsteinen/src/store/building-store.ts`

Manages selected building context for filtering apartments, users, and documents.

```typescript
interface BuildingStore {
  selectedBuildingId: string | null;
  setSelectedBuilding: (id: string | null) => void;
}

// Usage:
const buildingStore = useBuildingStore();
buildingStore.setSelectedBuilding(buildingId);
const selected = buildingStore.selectedBuildingId;
```

### Admin Pages

**Buildings List** (`/admin/buildings/page.tsx`)

- Table of all buildings with columns: Name, Code, Address, City, Actions
- Search by name/code/address
- Filter by active status
- Create building button → `CreateBuildingDialog`
- Pagination controls
- Click row → drill-down to `/admin/buildings/[buildingId]`

**Building Detail** (`/admin/buildings/[buildingId]/page.tsx`)

Tabbed interface:

1. **Overview Tab** — Display building summary, stats
   - Total users, active users, by-role breakdown
   - Edit building button → `CreateBuildingDialog` (controlled mode)
   - Building settings display

2. **Apartments Tab** — List apartments in building
   - Table with columns: Unit Number, Floor, Type, Size, Tenants, Actions
   - Search/filter by unitNumber or type
   - Create apartment button
   - Click apartment → `ApartmentDetailDialog` for full details + tenant management
   - Edit/delete actions

3. **Apartment Tenants Tab** — Manage apartment tenants
   - Registered tenants list (from apartment.tenantIds)
   - Unregistered/invited tenant profiles (from TenantProfile module)
   - Add tenant form → search registered users → assign
   - Remove tenant action
   - Status badges for tenant profiles

4. **Tenants Tab** — List all users assigned to building
   - User cards with avatar, name, role, email, phone
   - Assign new user button
   - Remove user action with confirmation

5. **Communication Tab** — Send broadcast messages
   - Message type selector: email / SMS / both
   - Subject field (for email)
   - Body textarea with formatting hints
   - Recipient selector: all / specific users / specific tenant profiles
   - Send button → `useSendBuildingMessage()`
   - Result display (emails sent, SMS sent, SMS skipped)

6. **Settings Tab** — Edit building details and settings
   - Name, Code, Address, City, PostalCode, Description
   - Settings checkboxes (allowResidentPosts, allowResidentEvents, requireBookingApproval)
   - Save button → `useUpdateBuilding()`

7. **Documents Tab** — Building-specific documents (if Documents module complete)

### Type Definitions

**Location:** `fe_grunnsteinen/src/types/index.ts`

```typescript
interface Building {
  id: string;
  organizationId: string;
  name: string;
  code?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  description?: string;
  settings: {
    allowResidentPosts: boolean;
    allowResidentEvents: boolean;
    requireBookingApproval: boolean;
  };
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface BuildingStats {
  totalUsers: number;
  activeUsers: number;
  usersByRole: Record<string, number>;
}

interface Apartment {
  id: string;
  organizationId: string;
  buildingId: string;
  unitNumber: string;
  floor?: number;
  sizeSqm?: number;
  numberOfRooms?: number;
  apartmentType?: string;
  description?: string;
  tenantIds: User[];  // Populated user objects
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
```

---

## Key File Paths

### Backend

| Role | Path |
|------|------|
| **Buildings Controller** | `be_grunnsteinen/src/modules/buildings/buildings.controller.ts` |
| **Buildings Service** | `be_grunnsteinen/src/modules/buildings/buildings.service.ts` |
| **Buildings Schema** | `be_grunnsteinen/src/modules/buildings/schemas/building.schema.ts` |
| **Buildings Module** | `be_grunnsteinen/src/modules/buildings/buildings.module.ts` |
| **Buildings DTOs** | `be_grunnsteinen/src/modules/buildings/dto/` |
| DTO: Create | `be_grunnsteinen/src/modules/buildings/dto/create-building.dto.ts` |
| DTO: Update | `be_grunnsteinen/src/modules/buildings/dto/update-building.dto.ts` |
| DTO: Query | `be_grunnsteinen/src/modules/buildings/dto/building-query.dto.ts` |
| DTO: AssignUser | `be_grunnsteinen/src/modules/buildings/dto/assign-user.dto.ts` |
| DTO: SendMessage | `be_grunnsteinen/src/modules/buildings/dto/send-building-message.dto.ts` |
| **Apartments Controller** | `be_grunnsteinen/src/modules/apartments/apartments.controller.ts` |
| **Apartments Service** | `be_grunnsteinen/src/modules/apartments/apartments.service.ts` |
| **Apartments Schema** | `be_grunnsteinen/src/modules/apartments/schemas/apartment.schema.ts` |
| **Apartments Module** | `be_grunnsteinen/src/modules/apartments/apartments.module.ts` |
| **Apartments DTOs** | `be_grunnsteinen/src/modules/apartments/dto/` |
| DTO: Create | `be_grunnsteinen/src/modules/apartments/dto/create-apartment.dto.ts` |
| DTO: Update | `be_grunnsteinen/src/modules/apartments/dto/update-apartment.dto.ts` |
| DTO: Query | `be_grunnsteinen/src/modules/apartments/dto/apartment-query.dto.ts` |
| DTO: AssignTenant | `be_grunnsteinen/src/modules/apartments/dto/assign-tenant.dto.ts` |

### Frontend

| Role | Path |
|------|------|
| **Building Hooks** | `fe_grunnsteinen/src/hooks/api/useBuildings.ts` |
| **Apartment Hooks** | `fe_grunnsteinen/src/hooks/api/useApartments.ts` |
| **Building Store** | `fe_grunnsteinen/src/store/building-store.ts` |
| **Admin Pages** | `fe_grunnsteinen/src/app/admin/buildings/` |
| Page: List | `fe_grunnsteinen/src/app/admin/buildings/page.tsx` |
| Page: Detail | `fe_grunnsteinen/src/app/admin/buildings/[buildingId]/page.tsx` |
| Tab: Overview | `fe_grunnsteinen/src/app/admin/buildings/[buildingId]/overview-tab.tsx` |
| Tab: Apartments | `fe_grunnsteinen/src/app/admin/buildings/[buildingId]/apartments-tab.tsx` |
| Tab: Apartment Tenants | `fe_grunnsteinen/src/app/admin/buildings/[buildingId]/apartment-tenants-tab.tsx` |
| Tab: Building Tenants | `fe_grunnsteinen/src/app/admin/buildings/[buildingId]/tenants-tab.tsx` |
| Tab: Communication | `fe_grunnsteinen/src/app/admin/buildings/[buildingId]/communication-tab.tsx` |
| Tab: Settings | `fe_grunnsteinen/src/app/admin/buildings/[buildingId]/settings-tab.tsx` |
| **Types** | `fe_grunnsteinen/src/types/index.ts` (Building, BuildingStats, Apartment sections) |
| **Endpoints** | `fe_grunnsteinen/src/lib/api/endpoints.ts` (API_ENDPOINTS.BUILDINGS, API_ENDPOINTS.APARTMENTS) |
| **Query Keys** | `fe_grunnsteinen/src/lib/api/queryKeys.ts` (queryKeys.buildings, queryKeys.apartments) |

---

## DTO Validation Summary

### Building DTOs

**CreateBuildingDto:**
| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `name` | string | Yes | 1-100 chars |
| `code` | string | No | max 20 chars |
| `address` | string | No | max 200 chars |
| `city` | string | No | max 100 chars |
| `postalCode` | string | No | max 20 chars |
| `description` | string | No | max 500 chars |
| `settings` | BuildingSettingsDto | No | nested object (all optional) |

**BuildingSettingsDto:**
| Field | Type | Constraints |
|-------|------|-------------|
| `allowResidentPosts` | boolean | optional |
| `allowResidentEvents` | boolean | optional |
| `requireBookingApproval` | boolean | optional |

**UpdateBuildingDto:** Extends `CreateBuildingDto` + `isActive` (optional boolean)

**BuildingQueryDto:** Pagination (inherited) + optional `search` (string), `isActive` (boolean)

**AssignUserToBuildingDto:**
| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `userId` | string | Yes | Valid MongoDB ObjectId |
| `isPrimary` | boolean | No | — |

**SendBuildingMessageDto:**
| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `type` | string | Yes | 'email' \| 'sms' \| 'both' |
| `subject` | string | No | Required if type is email/both |
| `body` | string | Yes | — |
| `recipientIds` | string[] | No | Array of valid ObjectIds |
| `tenantProfileIds` | string[] | No | Array of valid ObjectIds |
| `attachments` | EmailAttachmentDto[] | No | Base64-encoded, with filename + MIME type |

### Apartment DTOs

**CreateApartmentDto:**
| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `buildingId` | string | Yes | Valid MongoDB ObjectId |
| `unitNumber` | string | Yes | 1-20 chars |
| `floor` | number | No | — |
| `sizeSqm` | number | No | min 0 |
| `numberOfRooms` | number | No | min 0 |
| `apartmentType` | string | No | One of ApartmentType enum |
| `description` | string | No | max 500 chars |

**UpdateApartmentDto:** Extends `CreateApartmentDto` (without `buildingId`) + `isActive` (optional boolean)

**ApartmentQueryDto:** Pagination (inherited) + optional `buildingId` (string), `search` (string), `isActive` (boolean)

**AssignTenantDto:**
| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `userId` | string | Yes | Valid MongoDB ObjectId |

---

## Common Patterns

### Fetch and display buildings list
```typescript
const { data, isLoading } = useBuildings({ page: 1, limit: 20 });
if (isLoading) return <Skeleton />;
if (!data?.data.length) return <EmptyState message="Ingen bygg" />;
return data.data.map(building => <BuildingCard key={building.id} building={building} />);
```

### Create building
```typescript
const createBuilding = useCreateBuilding();

const handleCreate = async (formData: CreateBuildingInput) => {
  try {
    await createBuilding.mutateAsync(formData);
    toast.success('Bygg opprettet!');
    onClose();
  } catch (error) {
    toast.error(handleApiError(error));
  }
};
```

### Assign user to building
```typescript
const assignUser = useAssignUserToBuilding();

const handleAssign = async (userId: string) => {
  try {
    await assignUser.mutateAsync({
      buildingId: buildingId,
      data: { userId, isPrimary: true }
    });
    toast.success('Bruker lagt til!');
  } catch (error) {
    toast.error(handleApiError(error));
  }
};
```

### Send message to building tenants
```typescript
const sendMessage = useSendBuildingMessage();

const handleSend = async (messageData: SendBuildingMessageInput) => {
  try {
    const result = await sendMessage.mutateAsync({
      buildingId: buildingId,
      data: messageData
    });
    toast.success(
      `Sent: ${result.sentEmail} emails, ${result.sentSms} SMS` +
      (result.skippedSms > 0 ? `, ${result.skippedSms} SMS skipped` : '')
    );
  } catch (error) {
    toast.error(handleApiError(error));
  }
};
```

### Manage apartment tenants
```typescript
const assignTenant = useAssignTenant();
const removeTenant = useRemoveTenant();

const handleAddTenant = async (userId: string) => {
  try {
    await assignTenant.mutateAsync({ apartmentId, userId });
    toast.success('Beboer lagt til!');
  } catch (error) {
    toast.error(handleApiError(error));
  }
};

const handleRemoveTenant = async (userId: string) => {
  try {
    await removeTenant.mutateAsync({ apartmentId, userId });
    toast.success('Beboer fjernet!');
  } catch (error) {
    toast.error(handleApiError(error));
  }
};
```
