---
paths:
  - "be_grunnsteinen/src/modules/groups/**"
  - "fe_grunnsteinen/src/hooks/api/useGroups.ts"
  - "fe_grunnsteinen/src/app/groups/**"
---

# Groups

## Overview

The Groups module manages community interest groups and activity clusters within buildings and organizations. Residents can create and join groups based on shared interests, organize members, and restrict membership to private groups. Creators have full control with the restriction that they cannot leave until the group is deleted. Groups support both building-scoped and organization-wide visibility.

---

## Data Model

### Group Schema

**Collection:** `groups`

```typescript
{
  // Scope
  organizationId    → ObjectId (required, indexed) → organizations
  buildingId        → ObjectId (optional, indexed) → buildings
  isOrganizationWide → boolean, default: false

  // Group Info
  name              → string (required, 2-50 chars)
  description?      → string (optional, max 500 chars)
  imageUrl?         → string (optional, S3 URL from upload)

  // Creator & Members
  creatorId         → ObjectId (required) → users (group creator)
  members           → ObjectId[] (default: [creatorId], ref users)
  memberCount       → number (denormalized count, updated on join/leave)

  // Settings
  isPrivate         → boolean (default: false, indexed)
  isActive          → boolean (default: true, indexed)

  // Timestamps
  createdAt         → Date (auto-set)
  updatedAt         → Date (auto-updated)
}
```

### Compound Indexes

```
organizationId + isActive
organizationId + isPrivate + isActive
organizationId + buildingId + isActive
buildingId + isOrganizationWide
name, description (text search index)
```

---

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/groups` | JWT | Create new group (creator auto-added as member) |
| GET | `/groups` | JWT | List paginated groups with filters |
| GET | `/groups/:id` | JWT | Get group details with creator and members |
| PATCH | `/groups/:id` | JWT + creator/board | Update group info |
| DELETE | `/groups/:id` | JWT + creator/board | Soft-delete group (deactivate) |
| POST | `/groups/:id/image` | JWT + creator/board | Upload group image (max 5MB; throttled 10/min) |
| POST | `/groups/:id/members` | JWT + creator/board | Add member to group (sends notification) |
| GET | `/groups/:id/members` | JWT | Get group members list |
| POST | `/groups/:id/join` | JWT | Join a public group |
| POST | `/groups/:id/leave` | JWT | Leave group (creator cannot leave) |

---

## Business Rules & Logic

### Group Creation

**Endpoint:** `POST /groups`

**Request body:**
```json
{
  "buildingId": "507f1f77bcf86cd799439011",
  "name": "Knitting Club",
  "description": "Weekly knitting meets on Thursdays",
  "isPrivate": false
}
```

**Backend logic:**
1. Creator (authenticated user) is automatically added as first member
2. `memberCount` set to 1
3. `isActive` defaults to true
4. `organizationId` auto-populated from auth context
5. Text index on name + description for search
6. Return populated group with creator + members details

**Validation:**
- `buildingId`: required, valid MongoDB ObjectId
- `name`: required, 2–50 chars
- `description`: optional, max 500 chars
- `isPrivate`: optional, default false

### Group Visibility & Membership

**Public groups** (`isPrivate: false`)
- Visible to all building/organization members
- Users can join via `/join` endpoint
- No permission required to join

**Private groups** (`isPrivate: true`)
- Hidden from discovery (not shown in default `/groups` list unless user is member)
- Users cannot self-join; require admin/creator to add them via `/members` endpoint
- Shows in `/groups` list only if user is already a member

**Building-scoped groups:**
- `buildingId` set, `isOrganizationWide: false`
- Visible only to residents of that building

**Organization-wide groups:**
- `isOrganizationWide: true`
- Visible across entire organization (all buildings)

### Querying Groups

**Endpoint:** `GET /groups`

**Query parameters:**
```
page: number              // default: 1
limit: number             // default: 20
sortBy: string            // default: "name" (name, createdAt, memberCount)
sortOrder: "asc" | "desc" // default: "asc"
search: string            // full-text search on name + description
isMember?: boolean        // filter: true = only groups user is member of
isPrivate?: boolean       // filter: true = private only, false = public only
buildingId?: string       // filter: groups in specific building or org-wide
```

**Scoping rules:**
- Always filtered by `organizationId` from user token
- If `isMember: true` → show only groups where user is in `members` array
- If `isMember: false` (not specified) AND `isPrivate: false` → show public groups + user's private groups
  - Default: `$or: [{ isPrivate: false }, { members: userId }]`
- If `buildingId` specified:
  - Show groups from that building OR org-wide groups
  - Via `$or: [{ buildingId }, { isOrganizationWide: true }]`
- Text search: if `search` provided, uses MongoDB text index with relevance scoring

**Response:**
```json
{
  "data": [
    {
      "id": "507f1f77bcf86cd799439011",
      "organizationId": "...",
      "buildingId": "...",
      "isOrganizationWide": false,
      "name": "Knitting Club",
      "description": "Weekly knitting...",
      "imageUrl": "https://...",
      "creatorId": { "id": "...", "name": "Jane", "avatarUrl": "...", "role": "board" },
      "members": [{ "id": "...", "name": "Jane", "avatarUrl": "..." }, ...],
      "memberCount": 8,
      "isPrivate": false,
      "isActive": true,
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:30:00Z"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

### Get Single Group

**Endpoint:** `GET /groups/:id`

Returns group with populated creator (name, avatar, role) and members (name, avatar, email).

**Authorization:** No special check (implicit: user can view if group is public or they are member)

### Update Group

**Endpoint:** `PATCH /groups/:id`

**Authorization:** Creator of group OR board/admin member

**Request body:**
```json
{
  "name": "Advanced Knitting",
  "description": "For experienced knitters",
  "isPrivate": true
}
```

All fields optional. Only specified fields are updated.

**Validation:** Same as creation (name 2-50, description max 500)

**Side effects:**
- Updates `updatedAt` timestamp
- Logs action via Logger

### Upload Group Image

**Endpoint:** `POST /groups/:id/image`

**Authorization:** Creator OR board/admin

**Validation:**
- File types: jpg, jpeg, png, webp
- Max size: 5 MB
- Rate limited: 10 requests/min (`@ThrottleUpload()`)

**Flow:**
1. File validated by ParseFilePipe
2. Uploaded to S3 at `groups/{groupId}/images`
3. Group document updated with `imageUrl`
4. Return updated group

### Delete Group

**Endpoint:** `DELETE /groups/:id`

**Authorization:** Creator OR board/admin

**Behavior:**
- Soft delete: sets `isActive: false` (not removed from DB)
- Prevents new joins immediately
- Existing members remain in `members` array (data preserved)
- Returns 204 No Content

**Side effects:**
- Logged at info level: "Group deleted (deactivated): {groupId}"

### Add Member to Group

**Endpoint:** `POST /groups/:id/members`

**Authorization:** Creator OR board/admin

**Request body:**
```json
{
  "userId": "507f1f77bcf86cd799439011"
}
```

**Behavior:**
1. Verify user not already member (400 if duplicate)
2. Fetch user to verify exists (404 if not found)
3. Add user to `members` array
4. Increment `memberCount`
5. Send GROUP_INVITATION notification to added user
6. Return updated group

**Notification:**
- Type: `GROUP_INVITATION`
- Title: "Added to group"
- Message: `"{inviterName} added you to the group \"{groupName}\""`
- Link: `/groups/{groupId}`
- Includes user details in notification

**Validation:**
- `userId`: required, valid MongoDB ObjectId

### Join Group

**Endpoint:** `POST /groups/:id/join`

**Authorization:** JWT (any authenticated user)

**Behavior:**
1. Check group is active (400 if inactive)
2. Check user not already member (400 if duplicate)
3. Check group is not private (400 if private: "Cannot join a private group. Request an invitation.")
4. Add user to `members` array
5. Increment `memberCount`
6. Return updated group

**Side effects:**
- Logged at info level: "User {userId} joined group {groupId}"

### Leave Group

**Endpoint:** `POST /groups/:id/leave`

**Authorization:** JWT (any authenticated user who is member)

**Behavior:**
1. Check user is member (400 if not)
2. Check user is NOT creator (400 if creator: "Creator cannot leave the group. Delete the group instead.")
3. Remove user from `members` array
4. Decrement `memberCount`
5. Return updated group

**Side effects:**
- Logged at info level: "User {userId} left group {groupId}"

### Get Members List

**Endpoint:** `GET /groups/:id/members`

**Authorization:** JWT

**Response:**
```json
[
  {
    "id": "507f1f77bcf86cd799439011",
    "name": "Jane Doe",
    "email": "jane@example.com",
    "avatarUrl": "https://...",
    "avatarColor": "#FF5733"
  }
]
```

Returns array of User documents (name, email, avatar, color fields).

---

## Creator Restrictions

**Key invariant:** Creator cannot leave the group unless they delete it.

**Rationale:**
- Prevents orphaned groups (ensures at least creator always owns it)
- Protects group continuity and decision-making

**Workaround for creator to exit:**
- Creator must delete the group via `DELETE /groups/:id`
- This deactivates the group and prevents further joins
- Existing members remain (soft delete)

---

## Text Search

**Implementation:**
- MongoDB text index on `name` and `description`
- Query via `$text: { $search: searchTerm }`
- Relevance scoring when search is used
- Sorting: if search provided, primary sort by `{ score: { $meta: 'textScore' } }`

**Example:**
```
GET /groups?search=knitting
```

Returns groups with highest text match score first.

---

## Notifications & Side Effects

### Group Invitation (addMember)

Sent when admin/creator adds user to group.

**Type:** `GROUP_INVITATION`
**Recipient:** Added user
**Message:** `"{adderName} added you to the group \"{groupName}\""`
**Link:** `/groups/{groupId}`
**Email sent:** true (via `sendEmail` flag)

Failure does not block operation; logged as warning.

---

## Frontend

### Hooks

Located in `fe_grunnsteinen/src/hooks/api/useGroups.ts`

#### Query Hooks

**useGroups(params: GroupQueryParams)**
- Fetch paginated groups with filters
- Returns: `{ data: PaginatedResponse<Group>, isLoading, error }`
- Query key: `queryKeys.groups.list(params)`

**useGroup(groupId: string)**
- Fetch single group by ID
- Returns: `{ data: Group, isLoading, error }`
- Query key: `queryKeys.groups.detail(groupId)`
- Disabled if no groupId

**useGroupMembers(groupId: string)**
- Fetch members array for group
- Returns: `{ data: User[], isLoading, error }`
- Query key: `queryKeys.groups.members(groupId)`
- Disabled if no groupId

#### Mutation Hooks

**useCreateGroup()**
- Input: `{ name, description?, isPrivate?, buildingId }`
- On success: invalidates `queryKeys.groups.all`

**useUpdateGroup()**
- Input: `{ groupId, data: { name?, description?, isPrivate? } }`
- On success: invalidates detail + all queries

**useDeleteGroup()**
- Input: `groupId`
- On success: invalidates `queryKeys.groups.all`

**useJoinGroup()**
- Input: `groupId`
- On success: optimistically updates detail query + invalidates list

**useLeaveGroup()**
- Input: `groupId`
- On success: optimistically updates detail query + invalidates list

**useUploadGroupImage()**
- Input: `{ groupId, file }`
- On success: updates detail query with new imageUrl
- Rate limited: 10 req/min

**useAddMember()**
- Input: `{ groupId, userId }`
- On success: invalidates detail + members queries

### Pages

#### `/groups` (Groups List Page)

Community groups discovery page.

**Features:**
- **Two tabs:**
  - "Alle grupper" — all visible groups (public + groups user is member of)
  - "Mine grupper" — only groups user is member of
  - Each tab shows count badge
- **Create button** (top-right) → CreateGroupDialog
- **Group cards grid** (mobile: 1 col, tablet: 2, desktop: 3)
  - Image (with fallback: Users icon on gradient background)
  - Group name (bold, truncated to 1 line)
  - Description (gray, line-clamp-2)
  - Member count with Users icon
  - Status badges (top-left overlay):
    - "Privat" badge (Lock icon) if private
    - "Medlem" badge (CheckCircle2, green) if user is member
  - Hover: border highlight, shadow increase, link to `/groups/{id}`
- **Empty states:**
  - No groups: "Ingen grupper" with message
  - Tab empty: context-specific message ("Du er ikke medlem av noen grupper ennå")
- **Loading:** Skeleton cards while fetching

**Sorting:**
- Primary: by name (ascending)
- Alphabetical display within each tab

### Types

Located in `fe_grunnsteinen/src/types/index.ts`

```typescript
interface Group {
  id: string;
  organizationId: string;
  buildingId?: string;
  isOrganizationWide: boolean;
  name: string;
  description?: string;
  imageUrl?: string;
  creatorId: string | { id: string; name: string; avatarUrl?: string; role: UserRole };
  members: string[] | Array<{ id?: string; _id?: string; name: string; avatarUrl?: string }>;
  memberCount: number;
  isPrivate: boolean;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

type GroupQueryParams = {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  isMember?: boolean;
  isPrivate?: boolean;
  buildingId?: string;
  memberOf?: string;  // alternative filter for "my groups"
}
```

### API Endpoints

Located in `fe_grunnsteinen/src/lib/api/endpoints.ts`

```typescript
API_ENDPOINTS.GROUPS = {
  LIST: '/groups',
  CREATE: '/groups',
  BY_ID: (id) => `/groups/${id}`,
  MEMBERS: (id) => `/groups/${id}/members`,
  JOIN: (id) => `/groups/${id}/join`,
  LEAVE: (id) => `/groups/${id}/leave`,
  UPLOAD_IMAGE: (id) => `/groups/${id}/image`,
  // add member not explicitly listed but used as POST to MEMBERS endpoint
}
```

### Query Keys

Located in `fe_grunnsteinen/src/lib/api/queryKeys.ts`

```typescript
groups: {
  all: [...]
  list: (params) => [...]
  detail: (groupId) => [...]
  members: (groupId) => [...]
}
```

---

## DTO Validation Rules

### CreateGroupDto

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `buildingId` | string | Yes | Valid MongoDB ObjectId |
| `name` | string | Yes | 2–50 chars |
| `description` | string | No | Max 500 chars |
| `isPrivate` | boolean | No | Default: false |

### UpdateGroupDto

| Field | Type | Constraints |
|-------|------|-------------|
| `name` | string | Optional, 2–50 chars if provided |
| `description` | string | Optional, max 500 chars if provided |
| `isPrivate` | boolean | Optional |

### GroupQueryDto (extends PaginationQueryDto)

| Field | Type | Constraints |
|-------|------|-------------|
| `search` | string | Optional, full-text search |
| `isMember` | boolean | Optional, with transform (string 'true'/'false' → boolean) |
| `isPrivate` | boolean | Optional, with transform |
| `page`, `limit`, `sortBy`, `sortOrder` | inherited | — |

### AddMemberDto

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `userId` | string | Yes | Valid MongoDB ObjectId |

---

## Common Patterns

### Fetch groups with membership filter

```typescript
const { data: groupsData, isLoading } = useGroups({
  page: 1,
  limit: 50,
  isMember: activeTab === 'my' ? true : undefined,
  buildingId: selectedBuilding?.id,
});

if (isLoading) return <Skeleton />;
const groups = groupsData?.data || [];
```

### Create group

```typescript
const createGroup = useCreateGroup();

const handleCreate = async (formData: CreateGroupData) => {
  try {
    await createGroup.mutateAsync(formData);
    toast.success('Gruppe opprettet!');
    onClose();
  } catch (error) {
    toast.error(handleApiError(error));
  }
};
```

### Join/Leave group

```typescript
const joinGroup = useJoinGroup();
const leaveGroup = useLeaveGroup();

const handleJoin = async (groupId: string) => {
  try {
    await joinGroup.mutateAsync(groupId);
    toast.success('Du er nå medlem!');
  } catch (error) {
    toast.error(handleApiError(error));
  }
};

const handleLeave = async (groupId: string) => {
  try {
    await leaveGroup.mutateAsync(groupId);
    toast.success('Du forlot gruppen');
  } catch (error) {
    if (error.message?.includes('Creator cannot leave')) {
      toast.error('Du må slette gruppen for å forlate den');
    } else {
      toast.error(handleApiError(error));
    }
  }
};
```

### Upload group image

```typescript
const uploadImage = useUploadGroupImage();

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
    await uploadImage.mutateAsync({ groupId, file });
    toast.success('Bilde opplastet!');
  } catch (error) {
    toast.error(handleApiError(error));
  }
};
```

### Add member to group

```typescript
const addMember = useAddMember();

const handleAddMember = async (userId: string) => {
  try {
    await addMember.mutateAsync({ groupId, userId });
    toast.success('Medlem lagt til!');
  } catch (error) {
    if (error.message?.includes('already a member')) {
      toast.error('Bruker er allerede medlem');
    } else {
      toast.error(handleApiError(error));
    }
  }
};
```

---

## Key File Paths

| Role | Path |
|------|------|
| BE Controller | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/groups/groups.controller.ts` |
| BE Service | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/groups/groups.service.ts` |
| BE Schema | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/groups/schemas/group.schema.ts` |
| BE Module | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/groups/groups.module.ts` |
| BE DTOs | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/groups/dto/` |
| DTO: Create | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/groups/dto/create-group.dto.ts` |
| DTO: Update | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/groups/dto/update-group.dto.ts` |
| DTO: Query | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/groups/dto/group-query.dto.ts` |
| DTO: AddMember | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/groups/dto/add-member.dto.ts` |
| FE Hooks | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/hooks/api/useGroups.ts` |
| FE Page: List | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/app/groups/page.tsx` |
| FE Types | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/types/index.ts` |
| FE API Endpoints | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/lib/api/endpoints.ts` |
| FE Query Keys | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/lib/api/queryKeys.ts` |
