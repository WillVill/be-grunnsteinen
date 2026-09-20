---
paths:
  - "be_grunnsteinen/src/modules/users/**"
  - "fe_grunnsteinen/src/hooks/api/useUsers.ts"
  - "fe_grunnsteinen/src/app/profile/**"
  - "fe_grunnsteinen/src/app/neighbors/**"
---

# Users & Profiles

## Overview

The Users module manages resident profiles, neighborhood discovery, and user administration. Users represent active app accounts within an organization (housing association). Each user has identity information, role-based permissions, profile preferences, notification settings, and optional helpful-neighbor status.

Key concepts:
- **User vs TenantProfile**: User = active account; TenantProfile = persistent admin-managed apartment record (see `tenant-user-relation.md`)
- **Profile Privacy**: Residents can hide themselves from neighbor lists and prevent profile viewing by others
- **Helpful Neighbors**: Residents can opt-in as helpful neighbors with skills and interests
- **Notification Preferences**: Granular email & push notification settings per feature

## Data Model

### User Schema

```typescript
// be_grunnsteinen/src/modules/users/schemas/user.schema.ts

{
  // Authentication
  email: string                    // unique, lowercase, indexed
  password: string                 // bcrypt hashed, not selected by default
  passwordResetToken?: string      // not selected
  passwordResetExpires?: Date      // not selected

  // Identity
  name: string                     // full name, required
  phone?: string                   // optional
  avatarUrl?: string               // S3 URL to uploaded avatar
  avatarColor?: string             // hex color for fallback background
  dateOfBirth?: Date               // optional

  // Organization & Building
  organizationId: ObjectId         // required, indexed
  buildingIds: ObjectId[]          // array of buildings, indexed
  primaryBuildingId?: ObjectId     // first building in buildingIds
  building?: string                // building name/label
  unitNumber?: string              // apartment number

  // Role & Permissions
  role: UserRole                   // "resident" | "board" | "admin" | "super_admin", default: resident

  // Profile Settings
  interests: string[]              // hobbies, activities (e.g. ["gardening", "coding"])
  isHelpfulNeighbor: boolean       // default: false
  helpfulSkills: string[]          // skills for helpful neighbors (e.g. ["plumbing", "IT-support"])
  isProfilePrivate: boolean        // default: false; when true, hidden from neighbors & not viewable

  // Notifications
  notificationPreferences: {
    email: {
      newPosts: boolean            // default: true
      comments: boolean
      events: boolean
      eventReminders: boolean
      bookings: boolean
      helpRequests: boolean
      messages: boolean
      boardAnnouncements: boolean
    },
    push: { /* same fields */ }
  }

  // Account Status
  isActive: boolean                // default: true
  lastLoginAt?: Date

  // Base Fields (from baseSchemaOptions)
  _id: ObjectId                    // serialized as "id" in JSON
  createdAt: Date
  updatedAt: Date
}
```

### UserRole Enum

```typescript
enum UserRole {
  RESIDENT = "resident",           // Basic user, can post, join events, book resources
  BOARD = "board",                 // Board member, can moderate, create events
  ADMIN = "admin",                 // Organization admin, full management
  SUPER_ADMIN = "super_admin",     // Platform super admin, highest level
}

// Helper functions
isAdminRole(role) → boolean        // ADMIN or SUPER_ADMIN
isBoardOrAbove(role) → boolean     // BOARD, ADMIN, or SUPER_ADMIN
```

### Indexes

```
email (unique, compound)
organizationId, role (compound)
organizationId, unitNumber (compound)
organizationId, buildingIds (compound)
```

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/users` | JWT | Get paginated users in organization (public profiles only) |
| GET | `/users/helpful-neighbors` | JWT | Get all helpful neighbors in organization |
| GET | `/users/me` | JWT | Get current authenticated user profile |
| GET | `/users/:id` | JWT | Get user by ID (respects profile privacy) |
| PATCH | `/users/me` | JWT | Update current user profile |
| POST | `/users/me/avatar` | JWT | Upload avatar image (5MB, jpg/png/webp; throttled 10/min) |
| DELETE | `/users/me` | JWT | Deactivate current user account |
| POST | `/users/admin` | ADMIN, SUPER_ADMIN | Create admin/super_admin user |
| PATCH | `/users/:id/admin` | ADMIN, SUPER_ADMIN | Update admin user details |
| PATCH | `/users/:id/role` | ADMIN, SUPER_ADMIN | Update any user's role |
| DELETE | `/users/:id` | ADMIN, SUPER_ADMIN | Deactivate user (admin action) |

## Business Rules & Logic

### Role Hierarchy

```
SUPER_ADMIN (highest, unrestricted platform access)
    ↓
ADMIN (organization-level admin, can manage users, buildings, content)
    ↓
BOARD (board member, can moderate, create organization-wide content)
    ↓
RESIDENT (basic user)
```

**Key Rules:**
- SUPER_ADMIN is the only role that can create/assign SUPER_ADMIN to others
- ADMIN can create ADMIN users and manage BOARD/RESIDENT roles
- BOARD cannot create admins, can only manage RESIDENT content
- RESIDENT cannot perform admin/moderation actions
- Higher roles pass lower role checks (e.g., ADMIN passes BOARD checks)

### Profile Privacy

**When `isProfilePrivate = true`:**
- User is hidden from `/users` list (neighbors page)
- User is hidden from helpful neighbors list
- Only the user themselves or admins can view the profile via `/users/:id`
- Non-admin users get 403 Forbidden when accessing a private profile

**Default:** `false` (profile is public)

**Use case:** Residents who don't want to be contacted by neighbors.

### Helpful Neighbors Feature

Residents can opt-in as "helpful neighbors" with skills they're willing to help with.

**Fields:**
- `isHelpfulNeighbor: boolean` — enable/disable the feature
- `helpfulSkills: string[]` — array of skills (e.g., "plumbing", "IT-support", "childcare")

**Frontend allowed skills:**
```
Rørleggerarbeid, Møbelmontering, Barnepass, Plantestell, Elektrikerarbeid,
IT-support, Maling, Tapetsering, PC-reparasjon, Nettverksoppsett, Snekkerarbeid,
Sykkelreparasjon, Søm, Reparasjon av klær, Hjelp med flytting, Hundelufting,
Handling, Kjøring, Språkhjelp, Leksehjelp
```

**Frontend display:**
- Neighbors page shows helpful neighbors first, then alphabetically
- Badge "Hjelpsom" (green) with skills displayed on card
- Skills appear in the neighbors card preview and full profile page

**API:**
- `/users/helpful-neighbors` returns only active users with `isHelpfulNeighbor = true` and `isProfilePrivate != true`

### Avatar Upload

**Endpoint:** `POST /users/me/avatar`

**Validation:**
- File types: jpg, jpeg, png, webp
- Max size: 5 MB
- Rate limited: 10 requests/min (`@ThrottleUpload()`)

**Flow:**
1. Frontend validates type + size
2. Frontend shows `AvatarCropDialog` (crop/rotate before upload)
3. User confirms crop
4. File sent to backend
5. S3 upload to `avatars/{userId}`
6. User document updated with `avatarUrl`
7. Auth store & cache invalidated

**Default fallback:** If no avatar, use `UserAvatar` component with initials + `avatarColor`

### Admin User Management

**Creating Admin User** (`POST /users/admin`)
- Name, email, password (min 8 chars), phone, role (ADMIN | SUPER_ADMIN), buildingIds
- Email must be unique
- Only SUPER_ADMIN can set `role: SUPER_ADMIN`
- Password is hashed via pre-save hook

**Updating Admin User** (`PATCH /users/:id/admin`)
- Can update name, email, phone, role, buildingIds
- Email uniqueness checked if being changed
- Only SUPER_ADMIN can set `role: SUPER_ADMIN`
- `primaryBuildingId` automatically set to first building in buildingIds

**Updating User Role** (`PATCH /users/:id/role`)
- Can set any role (RESIDENT, BOARD, ADMIN, SUPER_ADMIN)
- Only SUPER_ADMIN can assign SUPER_ADMIN
- Applied to any user (not just admins)

**Deactivating User** (`DELETE /users/:id`)
- Soft delete: sets `isActive: false`
- User cannot login
- User data preserved in database
- Can be reactivated via `reactivate()` method (internal use)

### User Filtering & Search

**GET /users query parameters:**
```
page: number              // default 1
limit: number             // default 20
sortBy: string            // default "name"
sortOrder: "asc" | "desc" // default "asc"
search: string            // search by name or email
building: string          // filter by building name
isHelpfulNeighbor: boolean // filter helpful neighbors only
role: UserRole            // filter by single role
onlyRoles: string         // comma-separated roles to include (e.g. "admin,board")
excludeRoles: string      // comma-separated roles to exclude
```

**Default behavior:**
- Excludes inactive users (`isActive: false`)
- Excludes private profiles (`isProfilePrivate: true`)
- Sorted by name, ascending
- Paginated (20 per page)

**Examples:**
```
GET /users?search=john&building=A
GET /users?onlyRoles=admin,board&limit=50
GET /users?isHelpfulNeighbor=true
```

### Notification Preferences

Each user has granular notification settings for email and push channels:

**Email preferences:**
- `newPosts` — notify when new posts are published
- `comments` — notify on comments/replies
- `events` — notify when events are created
- `eventReminders` — remind before events start
- `bookings` — notify on booking status changes
- `helpRequests` — notify when help requests are posted
- `messages` — notify on new direct messages
- `boardAnnouncements` — notify on board-only announcements

**Push preferences:** Same fields as email

**Default:** All enabled (true)

**Updated via:** `PATCH /users/me` with `notificationPreferences` nested object

**Usage:** Other services check these prefs before sending notifications via SendGrid (email) or Twilio (push)

### Account Deactivation

**Self-deactivation** (`DELETE /users/me`)
- Current user can deactivate their own account
- Sets `isActive: false`
- User cannot login afterwards
- No data is deleted

**Admin deactivation** (`DELETE /users/:id`)
- Admins can deactivate any user in their organization
- Same behavior as self-deactivation

## Notifications & Side Effects

When user profile is updated (`PATCH /users/me` or avatar upload):
- **Cache invalidation:** `queryClient.invalidateQueries({ queryKey: queryKeys.users.all })`
- **Auth store update:** `authStore.updateUser(updatedUser)` syncs profile changes locally
- **Toast feedback:** Success/error messages

When admin creates or updates a user:
- **Cache invalidation:** Users list and admin users list invalidated
- **Logging:** Action logged via Logger service

When user deactivates account:
- **No cascade:** Existing posts, comments, messages remain (soft delete only)
- **Login prevented:** Auth service checks `isActive` on token refresh

## Frontend

### Hooks (fe_grunnsteinen/src/hooks/api/useUsers.ts)

```typescript
// Get current user from auth store
useCurrentUser() → User | null

// Fetch single user by ID
useUser(userId: string) → { data: User, isLoading, error }

// Fetch paginated users (neighbors list)
useUsers(params: UserQueryParams) → { data: { data: User[], total, page, limit }, isLoading, error }

// Fetch admin users (filtered by onlyRoles=admin,super_admin)
useAdminUsers(params?: UserQueryParams) → { data: { ... }, isLoading, error }

// Fetch helpful neighbors
useHelpfulNeighbors() → { data: User[], isLoading, error }

// Update current user profile
useUpdateProfile() → useMutation({ mutationFn, onSuccess })
  // onSuccess: updates auth store, invalidates users.all

// Upload avatar (returns updated user)
useUploadAvatar() → useMutation({ mutationFn: (file: File) => ..., onSuccess })
  // onSuccess: updates auth store

// Create admin user
useCreateAdminUser() → useMutation({ mutationFn: (data: CreateAdminUserData) => ... })

// Update admin user
useUpdateAdminUser() → useMutation({ mutationFn: ({ id, data }) => ... })

// Update any user's role
useUpdateUserRole() → useMutation({ mutationFn: ({ id, role }) => ... })

// Deactivate user
useDeactivateUser() → useMutation({ mutationFn: (id: string) => ... })
```

### Pages

#### `/profile` (fe_grunnsteinen/src/app/profile/page.tsx)

Current user's profile management page.

**Features:**
- Edit name, phone, avatar
- Avatar color picker (when editing)
- Add/remove interests from a predefined list (36 available)
- Helpful neighbor toggle with skill picker
- Profile privacy toggle
- Notification settings with per-feature toggles (8 channels)
- Avatar crop dialog (with image editing before upload)

**State:**
- Form editing mode (isEditing boolean)
- Local form state (name, phone, interests, skills, notifications, etc.)
- Image crop dialog state

**Edit flow:**
1. Click "Rediger" button → enter edit mode
2. User can change name, phone, avatar, interests, skills, profile privacy
3. Click "Lagre" → `useUpdateProfile()` mutation
4. On success: exit edit mode, sync auth store, invalidate cache, toast success
5. "Avbryt" → revert to original values, exit edit mode

**Notifications:**
- 8 toggles for email notifications
- Each toggle immediately calls `useUpdateProfile()` on change
- Optimistic update to local state before request
- Rollback on error

#### `/neighbors` (fe_grunnsteinen/src/app/neighbors/page.tsx)

Public neighborhood discovery page.

**Features:**
- Grid of neighbor cards (mobile: 1 column, tablet: 2, desktop: 3)
- Real-time search by name or apartment number
- Building filter dropdown
- Cards show avatar, name, location, role badge, helpful neighbor badge
- Helpful neighbors sorted first, then alphabetically
- Click card to view full profile at `/neighbors/:id`

**Filters:**
- Search query (name or unitNumber, case-insensitive)
- Building filter (dropdown with counts)
- Combines search + building filters

**Card content:**
- Avatar with initials fallback
- Name + "Deg" badge if current user
- Location: "Bygg X, unit Y" with MapPin icon
- Role badges: Admin (red shield), Board (gold crown)
- Helpful neighbor badge (green) with skills preview (truncated)

**Loading/Empty states:**
- Skeleton cards while loading
- Empty state if no neighbors match filters

### Auth Store Sync

When profile is updated:
```typescript
// useUsers.ts useUpdateProfile() hook
onSuccess: (updatedUser) => {
  updateUser(updatedUser);        // Update auth store
  queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
}
```

This ensures the current user profile shown everywhere is always in sync with the backend.

### Type Definitions

All types in `fe_grunnsteinen/src/types/index.ts`:

```typescript
interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  avatarUrl?: string;
  avatarColor?: string;
  dateOfBirth?: Date;
  organizationId: string;
  building?: string;
  unitNumber?: string;
  buildingIds?: string[];
  primaryBuildingId?: string;
  role: 'resident' | 'board' | 'admin' | 'super_admin';
  interests: string[];
  isHelpfulNeighbor: boolean;
  helpfulSkills: string[];
  isProfilePrivate: boolean;
  notificationPreferences: {
    email: NotificationPreferencesEmail;
    push: NotificationPreferencesPush;
  };
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  joinedDate?: Date;
}

type UserQueryParams = {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  building?: string;
  isHelpfulNeighbor?: boolean;
  role?: UserRole;
  onlyRoles?: string;  // comma-separated
  excludeRoles?: string;
};
```

### API Client Integration

All requests use centralized `apiClient`:

```typescript
// Endpoints defined in fe_grunnsteinen/src/lib/api/endpoints.ts
API_ENDPOINTS.USERS.LIST                  // GET /users
API_ENDPOINTS.USERS.HELPFUL_NEIGHBORS     // GET /users/helpful-neighbors
API_ENDPOINTS.USERS.ME                    // GET /users/me
API_ENDPOINTS.USERS.BY_ID(id)             // GET /users/:id
API_ENDPOINTS.USERS.UPDATE_ME             // PATCH /users/me
API_ENDPOINTS.USERS.UPLOAD_AVATAR         // POST /users/me/avatar
API_ENDPOINTS.USERS.DEACTIVATE_ME         // DELETE /users/me
API_ENDPOINTS.USERS.CREATE                // POST /users/admin
API_ENDPOINTS.USERS.CREATE_ADMIN          // POST /users/admin
API_ENDPOINTS.USERS.UPDATE_ADMIN(id)      // PATCH /users/:id/admin
API_ENDPOINTS.USERS.UPDATE_ROLE(id)       // PATCH /users/:id/role
API_ENDPOINTS.USERS.DEACTIVATE(id)        // DELETE /users/:id

// Query key factory (fe_grunnsteinen/src/lib/api/queryKeys.ts)
queryKeys.users.all                       // base key
queryKeys.users.list(params)              // for useUsers
queryKeys.users.detail(userId)            // for useUser
queryKeys.users.admins(params)            // for useAdminUsers
queryKeys.users.helpfulNeighbors          // for useHelpfulNeighbors
```

## Key File Paths

| Role | Path |
|------|------|
| BE Controller | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/users/users.controller.ts` |
| BE Service | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/users/users.service.ts` |
| BE Schema | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/users/schemas/user.schema.ts` |
| BE DTOs | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/users/dto/` |
| FE Hooks | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/hooks/api/useUsers.ts` |
| FE Types | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/types/index.ts` |
| FE Profile Page | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/app/profile/page.tsx` |
| FE Neighbors Page | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/app/neighbors/page.tsx` |
| FE Endpoints | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/lib/api/endpoints.ts` |
| FE Query Keys | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/lib/api/queryKeys.ts` |

## Common Patterns

### Fetch and display a user profile
```typescript
const { data: user, isLoading } = useUser(userId);
if (isLoading) return <Skeleton />;
if (!user) return <NotFoundError />;
// render user.name, user.avatarUrl, etc.
```

### Update profile settings
```typescript
const updateProfile = useUpdateProfile();
const handleSave = async () => {
  try {
    await updateProfile.mutateAsync({
      name, phone, interests, isHelpfulNeighbor, helpfulSkills
    });
    toast.success('Profil oppdatert!');
  } catch (e) {
    toast.error(handleApiError(e));
  }
};
```

### Filter users by role (admin page)
```typescript
const { data } = useAdminUsers({
  limit: 50,
  sortBy: 'name'
});
// Returns only users with role ADMIN or SUPER_ADMIN
```

### Find helpful neighbors
```typescript
const { data: helpfulNeighbors } = useHelpfulNeighbors();
// Filter by skills if needed
const plumberNeighbors = helpfulNeighbors?.filter(n =>
  n.helpfulSkills?.includes('Rørleggerarbeid')
);
```
