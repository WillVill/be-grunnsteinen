---
paths:
  - "be_grunnsteinen/src/modules/organizations/**"
  - "fe_grunnsteinen/src/hooks/api/useAdmin.ts"
  - "fe_grunnsteinen/src/app/admin/**"
---

# Organizations

## Overview

The Organizations module manages housing associations (customer tenants in the SaaS model). Each organization is the top-level entity in the multi-tenant hierarchy: **Organization** → Building → Apartment → Residents.

An organization represents a single housing association with:
- Basic identity (name, unique code, address, description)
- Logo/branding (uploaded to S3)
- Global settings (post/event permissions, booking approval requirements, default booking rules)
- Aggregated statistics (user count, active bookings, upcoming events)

All data in the system is scoped by `organizationId` — organizations are completely isolated from one another.

---

## Data Model

### Schema: Organization

**Collection:** `organizations`

```
_id             → ObjectId (serialized as `id` in JSON)
name            → string, required, trimmed (2+ chars)
code            → string, required, unique, indexed, uppercase (4+ chars, alphanumeric only)
address?        → string, optional, trimmed
city?           → string, optional, trimmed
postalCode?     → string, optional, trimmed
description?    → string, optional, trimmed
logoUrl?        → string, optional (S3 URL from file upload)
settings        → OrganizationSettings (embedded object)
isActive        → boolean, default: true
createdAt       → Date (auto-set)
updatedAt       → Date (auto-updated)
```

### Schema: OrganizationSettings

Embedded sub-schema controlling organization-wide feature availability.

```
allowResidentPosts      → boolean, default: true
allowResidentEvents     → boolean, default: true
requireBookingApproval  → boolean, default: false
defaultBookingRules?    → string, default: "" (free-text booking guidelines)
```

### Indexes

- `code` (unique, sparse) — enforced at schema level and explicit index
- `_id` (primary)

---

## API Endpoints

| Method | Endpoint | Auth | Response | Notes |
|--------|----------|------|----------|-------|
| GET | `/organizations/current` | JWT (any role) | `OrganizationResponseDto` | Retrieve current user's organization details |
| PATCH | `/organizations/current` | JWT + BOARD/ADMIN | `OrganizationResponseDto` | Update org info, address, settings (not code) |
| POST | `/organizations/current/logo` | JWT + BOARD/ADMIN | `OrganizationResponseDto` | Upload logo (multipart/form-data, 5MB max) |
| GET | `/organizations/current/stats` | JWT + BOARD/ADMIN | `OrganizationStats` | Fetch org statistics |

**Note:** Organization creation (`POST /organizations`) is not exposed to the frontend (super-admin only via CLI/backend scripts).

---

## Business Rules & Logic

### Code Uniqueness

- **Required** on creation, **optional** on update
- Automatically converted to **UPPERCASE** during creation and update
- Must match pattern: `^[A-Z0-9]+$` (4+ chars)
- Checked for uniqueness at the database level with conflict handling
- If updating the code, the system checks that no other organization uses the new code

### Settings Structure

Default settings allow residents to post and create events, require no booking approval:

```json
{
  "allowResidentPosts": true,
  "allowResidentEvents": true,
  "requireBookingApproval": false,
  "defaultBookingRules": ""
}
```

Settings are **partial-updatable** — only specified fields are changed. Used by downstream modules (posts, events, bookings) to enforce permissions.

### Logo Upload & Replacement

- **Endpoint:** `POST /organizations/current/logo`
- **File validation:** JPEG, PNG, WebP only; max 5MB
- **Rate limit:** 10 requests/min (via `@ThrottleUpload()`)
- **Storage:** Uploaded to S3 at path `organizations/{organizationId}/logos`
- **Replacement logic:** If an old logo exists, it is deleted from S3 before the new one is saved
- **Error handling:** Deletion failures are logged as warnings (non-blocking)
- **Response:** Returns the updated organization document with the new `logoUrl`

### Stats Aggregation

**Endpoint:** `GET /organizations/current/stats` (Board/Admin only)

Returns:
```json
{
  "userCount": 42,
  "activeBookings": 5,
  "upcomingEvents": 3
}
```

**Implementation:**
- `userCount`: Count of users with `organizationId` matching and `isActive: true`
- `activeBookings`: Placeholder (returns 0) — to be implemented when bookings module is complete
- `upcomingEvents`: Placeholder (returns 0) — to be implemented when events module is complete

These queries run in parallel via `Promise.all()` for performance.

---

## Notifications & Side Effects

**Creation:**
- Organization code is logged (info level): `"Organization created: {name} ({code})"`

**Update:**
- Organization update is logged (info level): `"Organization updated: {name}"`

**Logo Upload:**
- Successful upload is logged (info level): `"Logo uploaded for organization: {name}"`
- Failed deletion of old logo is logged as warning (does not prevent operation)

No email notifications or user-facing notifications are triggered by organization changes.

---

## Frontend

### Types

All types defined in `fe_grunnsteinen/src/types/index.ts`:

```typescript
interface Organization {
  id: string;
  name: string;
  code: string;
  address?: string;
  city?: string;
  postalCode?: string;
  description?: string;
  logoUrl?: string;
  settings: {
    allowResidentPosts: boolean;
    allowResidentEvents: boolean;
    requireBookingApproval: boolean;
    defaultBookingRules?: string;
  };
  isActive: boolean;
}

interface OrganizationStats {
  userCount: number;
  totalResidents?: number;
  activeBookings: number;
  upcomingEvents: number;
  pendingBookings: number;
  totalPosts: number;
  openHelpRequests: number;
}

interface UpdateOrganizationData {
  name?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  description?: string;
  settings?: Partial<Organization['settings']>;
}
```

### Hooks

Located in `fe_grunnsteinen/src/hooks/api/useAdmin.ts`:

**Get current organization:**
```typescript
useOrganization()
```
- Query hook, returns `Organization | undefined`
- Endpoint: `GET /organizations/current`
- Available to all authenticated users

**Get organization statistics (Board/Admin only):**
```typescript
useOrganizationStats()
```
- Query hook, returns `OrganizationStats | undefined`
- Endpoint: `GET /organizations/current/stats`
- Only accessible by Board/Admin roles

**Update organization (Board/Admin only):**
```typescript
useUpdateOrganization()
```
- Mutation hook
- Accepts: `UpdateOrganizationData`
- Endpoint: `PATCH /organizations/current`
- On success: invalidates `queryKeys.organization.current`

**Upload logo (Board/Admin only):**
```typescript
useUploadOrganizationLogo()
```
- Mutation hook
- Accepts: `File`
- Endpoint: `POST /organizations/current/logo`
- On success: invalidates `queryKeys.organization.current`
- File validation should occur on client before calling

### Query Keys

In `fe_grunnsteinen/src/lib/api/queryKeys.ts`:

```typescript
organization: {
  current: [...]  // used by useOrganization()
  stats: [...]    // used by useOrganizationStats()
}
```

---

## Key File Paths

| Role | Path |
|------|------|
| BE Controller | `be_grunnsteinen/src/modules/organizations/organizations.controller.ts` |
| BE Service | `be_grunnsteinen/src/modules/organizations/organizations.service.ts` |
| BE Schema | `be_grunnsteinen/src/modules/organizations/schemas/organization.schema.ts` |
| BE DTOs | `be_grunnsteinen/src/modules/organizations/dto/` |
| BE DTO: Create | `be_grunnsteinen/src/modules/organizations/dto/create-organization.dto.ts` |
| BE DTO: Update | `be_grunnsteinen/src/modules/organizations/dto/update-organization.dto.ts` |
| BE DTO: Response | `be_grunnsteinen/src/modules/organizations/dto/organization-response.dto.ts` |
| FE Hooks | `fe_grunnsteinen/src/hooks/api/useAdmin.ts` (useOrganization, useOrganizationStats, useUpdateOrganization, useUploadOrganizationLogo) |
| FE Types | `fe_grunnsteinen/src/types/index.ts` (Organization, OrganizationStats, UpdateOrganizationData) |
| FE API Endpoints | `fe_grunnsteinen/src/lib/api/endpoints.ts` (API_ENDPOINTS.ORGANIZATION.*) |
| FE Query Keys | `fe_grunnsteinen/src/lib/api/queryKeys.ts` (queryKeys.organization.*) |

---

## DTO Validation Rules

### CreateOrganizationDto

| Field | Type | Required | Rules |
|-------|------|----------|-------|
| `name` | string | Yes | Min 2 chars |
| `code` | string | Yes | Min 4 chars, uppercase letters & numbers only |
| `address` | string | No | — |
| `city` | string | No | — |
| `postalCode` | string | No | — |
| `description` | string | No | — |

### UpdateOrganizationDto

All fields optional. Supports partial updates to:
- `name`, `address`, `city`, `postalCode`, `description`, `logoUrl`
- `settings` (nested object, accepts partial settings)
- `isActive`

**Code update:** If provided, must follow same rules (min 4 chars, uppercase alphanumeric). Uniqueness is checked against other organizations.

---

## Scoping & Security

- **Organization Scoping:** The `/organizations/current` endpoint uses `@CurrentUser() user` to extract `user.organizationId`, ensuring users only see/modify their own organization
- **Role-Based Access:** Update and stats endpoints require `@Roles('board', 'admin')` + `@UseGuards(RolesGuard)`
- **Logical Isolation:** All organization data is scoped; users cannot access other organizations' data via this module
