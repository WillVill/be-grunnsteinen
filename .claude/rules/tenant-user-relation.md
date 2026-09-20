---
paths:
  - "be_grunnsteinen/src/modules/tenant-profiles/**"
  - "be_grunnsteinen/src/modules/apartments/**"
  - "be_grunnsteinen/src/modules/auth/**"
  - "fe_grunnsteinen/src/hooks/api/useTenantProfiles.ts"
  - "fe_grunnsteinen/src/app/admin/buildings/**"
---

# Tenant ↔ User Relationship

## Overview

There are two separate but linked concepts: a **TenantProfile** (who lives in an apartment, managed by admins) and a **User** (an active app account). A tenant can exist without ever having a user account.

---

## Data Model

### `TenantProfile` (new collection)
Persistent admin-managed record for anyone who lives or has lived in an apartment.

```
organizationId, buildingId, apartmentId  — required, scoped
firstName (required), lastName?, email?, phone?
notes?       — admin-only internal notes, never shown to the tenant
moveInDate?
status       — 'unregistered' | 'invited' | 'registered'
userId?      — populated when the tenant registers (→ users)
invitationId? — populated when an invitation email is sent (→ invitations)
addedBy      — admin who created the profile
```

### `Apartment.tenantIds: ObjectId[]`
Array of **User** ObjectIds. Only contains registered users. Kept in sync:
- Added when a registered user is assigned via `POST /apartments/:id/tenant`
- Added automatically when a user accepts an invitation that was sent from a TenantProfile
- Removed when `DELETE /apartments/:id/tenant/:userId` is called

### `Invitation` (existing collection)
Short-lived (7-day expiry) token for the signup flow. Created when an admin sends an invite. Not a permanent tenant record — use TenantProfile for that.

---

## Lifecycle

```
Admin adds tenant info
        ↓
TenantProfile  (status: unregistered)
        ↓  Admin clicks "Send invitasjon"
TenantProfile  (status: invited)    +   Invitation (status: pending)
        ↓  Tenant registers at /register?invite=TOKEN
TenantProfile  (status: registered, userId set)
User created + added to apartment.tenantIds
Invitation  (status: accepted)
```

---

## Key Invariants

1. **TenantProfile is the persistent record** — it outlives any invitation. Even if an invitation expires, the TenantProfile stays.
2. **`apartment.tenantIds` only contains registered Users** — never unregistered tenants.
3. **A registered user may exist in `apartment.tenantIds` without a TenantProfile** (e.g. assigned via the old `POST /apartments/:id/tenant` endpoint directly). Both sources are shown in the admin UI.
4. **email is optional** on a TenantProfile — an admin can track a tenant with only a name/phone. An invitation cannot be sent until an email is added.
5. **Unique email per apartment** — enforced at DB level `(apartmentId, email)` sparse unique index.
6. **Deleting a TenantProfile** with `status=invited` also expires the linked Invitation.
7. **`markRegistered`** is called automatically in `auth.service.ts` during registration when the invitation came from a TenantProfile — no manual step needed.

---

## Backend API

| Method | Endpoint | Auth | Notes |
|--------|----------|------|-------|
| POST | `/tenant-profiles` | ADMIN, BOARD | Create profile (status=unregistered) |
| GET | `/tenant-profiles?apartmentId=` | ADMIN, BOARD | List all profiles for an apartment |
| PATCH | `/tenant-profiles/:id` | ADMIN, BOARD | Update info/notes |
| DELETE | `/tenant-profiles/:id` | ADMIN, BOARD | Delete; expires invitation if status=invited |
| POST | `/tenant-profiles/:id/invite` | ADMIN, BOARD | Send invite email → status becomes invited |

The existing apartment tenant endpoints remain:

| Method | Endpoint | Notes |
|--------|----------|-------|
| POST | `/apartments/:id/tenant` | Assign existing registered user |
| DELETE | `/apartments/:id/tenant/:userId` | Remove registered user |

---

## Frontend

**Hooks** (`fe_grunnsteinen/src/hooks/api/useTenantProfiles.ts`):
```
useTenantProfiles(apartmentId)       — list profiles
useCreateTenantProfile()             — POST /tenant-profiles
useUpdateTenantProfile()             — PATCH /tenant-profiles/:id  (pass id + apartmentId)
useDeleteTenantProfile()             — DELETE /tenant-profiles/:id (pass id + apartmentId)
useSendTenantProfileInvite()         — POST /tenant-profiles/:id/invite (pass id + apartmentId)
```

**Types** (`fe_grunnsteinen/src/types/index.ts`):
```
TenantProfileStatus = 'unregistered' | 'invited' | 'registered'
TenantProfile       — full document type
CreateTenantProfileInput — form input for creation
UpdateTenantProfileInput — form input for update
```

**UI** (`apartment-tenants-tab.tsx`):
- Registered tenants: sourced from `apartment.tenantIds` (populated User objects)
- Unregistered/invited: sourced from `useTenantProfiles()`, filtered to `status !== 'registered'`
- Status badges: `Ikke registrert` (gray) / `Invitasjon sendt` (amber) / `Registrert` (green)
- "Send invite" button only shown when `status !== 'registered'` AND `email` is present

---

## Key File Paths

| Role | Path |
|------|------|
| BE schema | `be_grunnsteinen/src/modules/tenant-profiles/schemas/tenant-profile.schema.ts` |
| BE service | `be_grunnsteinen/src/modules/tenant-profiles/tenant-profiles.service.ts` |
| BE controller | `be_grunnsteinen/src/modules/tenant-profiles/tenant-profiles.controller.ts` |
| BE module | `be_grunnsteinen/src/modules/tenant-profiles/tenant-profiles.module.ts` |
| BE DTOs | `be_grunnsteinen/src/modules/tenant-profiles/dto/` |
| FE hooks | `fe_grunnsteinen/src/hooks/api/useTenantProfiles.ts` |
| FE types | `fe_grunnsteinen/src/types/index.ts` (TenantProfile section at bottom) |
| FE endpoints | `fe_grunnsteinen/src/lib/api/endpoints.ts` (TENANT_PROFILES) |
| FE query keys | `fe_grunnsteinen/src/lib/api/queryKeys.ts` (tenantProfiles) |
| FE admin UI | `fe_grunnsteinen/src/app/admin/buildings/[buildingId]/apartment-tenants-tab.tsx` |
| Registration hook | `be_grunnsteinen/src/modules/auth/auth.service.ts` (register method) |
