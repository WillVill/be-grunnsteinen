---
paths:
  - "be_grunnsteinen/src/modules/posts/**"
  - "fe_grunnsteinen/src/hooks/api/usePosts.ts"
  - "fe_grunnsteinen/src/app/posts/**"
---

# Posts & Comments

## Overview

The Posts module manages community communication within organizations (housing associations). Residents and board members can create posts, categorize them, like, comment, and share updates with their building or organization. Board members can pin important posts. Comments enable threaded discussions. Post and comment engagement is tracked via likes and comment counts.

---

## Data Model

### Post Schema

**Collection:** `posts`

```typescript
{
  // Scope
  organizationId    → ObjectId, required, indexed (→ organizations)
  buildingId        → ObjectId, optional, indexed (→ buildings)
  groupId           → ObjectId, optional, indexed (→ groups)
  isOrganizationWide → boolean, default: false (visible org-wide or scoped to building)

  // Author & Content
  authorId          → ObjectId, required, indexed (→ users)
  title?            → string, optional, trimmed (max 200 chars)
  content           → string, required, trimmed (max 5000 chars, text-indexed)
  category          → PostCategory enum (required, indexed)

  // Post Meta
  isPinned          → boolean, default: false, indexed (board-only feature)
  isFromBoard       → boolean, default: false (auto-set based on author role)

  // Engagement
  likes             → ObjectId[], default: [] (array of user IDs)
  likesCount        → number, default: 0 (denormalized count)
  commentsCount     → number, default: 0 (denormalized count)

  // Timestamps
  createdAt         → Date (auto-set)
  updatedAt         → Date (auto-updated)
}
```

### PostCategory Enum

```typescript
enum PostCategory {
  GENERAL = 'general'            // General neighborhood news/discussion
  MAINTENANCE = 'maintenance'    // Maintenance issues, repairs
  SOCIAL = 'social'              // Social events, gatherings
  QUESTION = 'question'          // Questions to the community
  ANNOUNCEMENT = 'announcement'  // Board announcements
}
```

### Comment Schema

**Collection:** `comments`

```typescript
{
  // Reference
  postId       → ObjectId, required, indexed (→ posts)
  authorId     → ObjectId, required, indexed (→ users)

  // Content
  content      → string, required, trimmed (max 1000 chars)

  // Timestamps
  createdAt    → Date (auto-set)
  updatedAt    → Date (auto-updated)
}
```

### Indexes

**Posts:**
- `organizationId` (compound with createdAt desc)
- `organizationId, isPinned DESC, createdAt DESC` (for pinned-first sorting)
- `organizationId, category, createdAt DESC` (for category filtering)
- `authorId, createdAt DESC` (for user's posts)
- `organizationId, buildingId, createdAt DESC` (for building posts)
- `organizationId, groupId, createdAt DESC` (for group posts)
- `buildingId, isOrganizationWide` (for building + org-wide posts)
- **Text index:** `{ title: 'text', content: 'text' }` (for full-text search)

**Comments:**
- `postId, createdAt ASC` (for post's comment thread)
- `authorId, createdAt DESC` (for user's comments)

---

## API Endpoints

### Post Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/posts` | JWT (any) | Create new post |
| GET | `/posts` | JWT (any) | Get paginated posts with filters |
| GET | `/posts/:id` | JWT (any) | Get post by ID with all comments |
| PATCH | `/posts/:id` | JWT | Update post (author or board) |
| DELETE | `/posts/:id` | JWT | Delete post (author or board) |
| POST | `/posts/:id/pin` | JWT + BOARD/ADMIN | Toggle pin status |
| POST | `/posts/:id/like` | JWT (any) | Toggle like on post |

### Comment Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/posts/:id/comments` | JWT (any) | Add comment to post |
| GET | `/posts/:id/comments` | JWT (any) | Get paginated comments |
| DELETE | `/posts/:postId/comments/:commentId` | JWT | Delete comment (author or board) |

---

## Business Rules & Logic

### Post Creation

**Endpoint:** `POST /posts`

**Request body:**
```json
{
  "title": "Community BBQ this Saturday",
  "content": "Join us for a community BBQ at 2 PM in the courtyard!",
  "category": "social",
  "buildingId": "507f1f77bcf86cd799439011",
  "groupId": "507f1f77bcf86cd799439011"  // optional
}
```

**Backend logic:**
1. Fetch current user from token
2. Auto-set `isFromBoard = true` if user role is BOARD or ADMIN
3. Store post with `organizationId` from user context
4. If post belongs to a group: fetch group members (excluding author) → send bulk POST_CREATED notifications
5. Notifications include post title/content preview, author name, link to post
6. Return populated post with author details

**Validation:**
- Title: max 200 chars (optional)
- Content: required, 1–5000 chars
- Category: must be one of GENERAL, MAINTENANCE, SOCIAL, QUESTION, ANNOUNCEMENT
- Building ID: required, must be valid ObjectId
- Group ID: optional, must be valid ObjectId if provided

**Post categorization:**
- Used for filtering in UI (tabs: Generelt, Vedlikehold, Sosialt, Spørsmål)
- ANNOUNCEMENT category reserved for board members (enforced client-side; backend accepts all roles)

### Post Filtering & Pagination

**Endpoint:** `GET /posts`

**Query parameters:**
```
page: number              // default: 1
limit: number             // default: 20
sortBy: string            // default: "createdAt" (createdAt, title, likesCount)
sortOrder: "asc" | "desc" // default: "desc"
category?: string         // filter by category (general, maintenance, social, etc.)
authorId?: string         // filter posts by specific author
isPinned?: boolean        // filter pinned posts only
fromBoard?: boolean       // filter board-only posts
groupId?: string          // filter posts in a specific group
excludeGroupPosts?: boolean // exclude group posts, show only org-wide
buildingId?: string       // filter by building (combines building + org-wide posts)
```

**Scoping rules:**
- Always scoped to `organizationId` from user token
- If `buildingId` specified: show posts from that building OR org-wide posts (via `$or`)
- If `excludeGroupPosts = true`: exclude posts with `groupId` set (show only org-wide)
- Can combine filters (e.g., `category=social&buildingId=X`)

**Sorting logic:**
- Default: pinned posts first (`isPinned: -1`), then by `createdAt` descending
- If filtering by `isPinned = true`: only sort by that, don't add secondary sort
- Custom `sortBy` (e.g., `likesCount`) still applies secondary pinned sort if not already filtered

**Response:**
```json
{
  "data": [
    {
      "id": "507f1f77bcf86cd799439011",
      "title": "Community BBQ",
      "content": "...",
      "category": "social",
      "authorId": { "id": "...", "name": "John Doe", "avatarUrl": "..." },
      "organizationId": "...",
      "buildingId": "...",
      "groupId": null,
      "isPinned": false,
      "isFromBoard": false,
      "likes": ["user1", "user2"],  // array of user IDs
      "likesCount": 2,
      "commentsCount": 3,
      "isLiked": true,              // computed: true if current user likes post
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:30:00Z"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

### Get Post by ID

**Endpoint:** `GET /posts/:id`

Returns full post with all comments loaded in-memory:

```json
{
  "id": "507f1f77bcf86cd799439011",
  "title": "...",
  "content": "...",
  "comments": [
    {
      "id": "...",
      "postId": "...",
      "authorId": { "id": "...", "name": "...", "avatarUrl": "..." },
      "content": "Great idea!",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "isLiked": true,  // computed for current user
  // ... rest of post fields
}
```

### Update Post

**Endpoint:** `PATCH /posts/:id`

**Authorization:** Author of post OR board member

**Request body:**
```json
{
  "title": "Updated title",
  "content": "Updated content",
  "category": "question"
}
```

All fields optional. Only specified fields are updated.

**Validation:** Same as creation (title max 200, content 1–5000, valid category)

### Delete Post

**Endpoint:** `DELETE /posts/:id`

**Authorization:** Author OR board member

**Behavior:**
1. Find post
2. Verify author or board role
3. Delete ALL associated comments via `deleteMany({ postId })`
4. Delete post
5. Return 204 No Content

### Pin/Unpin Post

**Endpoint:** `POST /posts/:id/pin`

**Authorization:** BOARD or ADMIN role only

**Behavior:**
- Toggle `isPinned` boolean
- Pinned posts sorted first in lists
- Board use case: highlight important announcements

### Like System

**Endpoint:** `POST /posts/:id/like`

**Behavior (toggle):**
1. Fetch post
2. Check if current user ID in `post.likes[]`
3. If present: remove from array, decrement `likesCount`
4. If not present: add to array, set `likesCount = post.likes.length`
5. Save post
6. Return updated post with `isLiked: boolean` computed for current user

**Validation:**
- Prevent `likesCount` from going negative (via `Math.max(0, count - 1)`)
- Only one like per user (idempotent toggle)

**Frontend: Optimistic updates**
- Like state toggled immediately in UI
- On error, refetch to restore actual state
- Prevents jarring like count changes during network requests

### Comment System

**Add comment:**
- Endpoint: `POST /posts/:id/comments`
- Request: `{ "content": "..." }` (1–1000 chars)
- Backend: creates comment, increments post's `commentsCount`, sends notification to post author
- Response: populated comment with author details

**Delete comment:**
- Endpoint: `DELETE /posts/:postId/comments/:commentId`
- Authorization: Comment author OR board member
- Backend: decrements post's `commentsCount` (safe: `Math.max(0, count - 1)`)
- Response: 204 No Content

**Prevent negative counts:**
- On delete, verify `commentsCount > 0` before decrement
- If already 0, set to 0 (no negative values)

---

## Notifications & Side Effects

### New Post in Group

When a post is created with `groupId` set:
1. Fetch group members
2. Exclude post author
3. Create bulk notifications to all other members
4. Type: `NotificationType.POST_CREATED`
5. Message template: `"{author.name} posted: {title or content preview}..."`
6. Link: `/posts/{postId}`
7. Non-blocking: logged as warning if fails, does not prevent post creation

### Comment Notification

When a comment is added to a post:
1. If comment author ≠ post author: send email notification
2. Type: `NotificationType.POST_COMMENT`
3. Title: "New comment on your post"
4. Message: `"{commentAuthor.name} commented on your post"`
5. Link: `/posts/{postId}`
6. Email sent: `sendEmail = true`
7. Non-blocking: logged as error if fails, does not prevent comment creation

---

## Frontend

### Hooks

Located in `fe_grunnsteinen/src/hooks/api/usePosts.ts`

#### List Posts

```typescript
usePosts(params: PostQueryParams) → {
  data: { data: Post[], total: number, page: number, limit: number },
  isLoading: boolean,
  error: Error | null
}
```

- Fetches paginated posts with applied filters
- Supports pagination, category, author, building, group filters
- Filters query params through `filterPostsQueryParams()` to ensure only valid keys are sent

#### Get Single Post

```typescript
usePost(postId: string) → {
  data: Post & { comments: Comment[] },
  isLoading: boolean,
  error: Error | null
}
```

- Fetches full post + all comments
- Enabled only if `postId` is provided

#### Create Post

```typescript
useCreatePost() → useMutation({
  mutationFn: (data: CreatePostData) => POST /posts,
  onSuccess: () => invalidateQueries(queryKeys.posts.all)
})
```

- Request body: `{ title?, content, category, buildingId, groupId? }`
- On success: invalidates all posts queries (list + detail)

#### Update Post

```typescript
useUpdatePost() → useMutation({
  mutationFn: ({ postId, data }) => PATCH /posts/:id,
  onSuccess: () => invalidateQueries(detail + all)
})
```

- Request body: partial post fields (title, content, category)
- Invalidates both detail query (for current post) and all queries (for lists)

#### Delete Post

```typescript
useDeletePost() → useMutation({
  mutationFn: (postId) => DELETE /posts/:id,
  onSuccess: () => invalidateQueries(queryKeys.posts.all)
})
```

- Returns 204 (no content)
- Invalidates all posts queries

#### Toggle Like

```typescript
useToggleLike() → useMutation({
  mutationFn: (postId) => POST /posts/:id/like,
  onSuccess: (updatedPost, postId) => setQueryData(detail(postId), updatedPost)
})
```

- Toggles like on a post
- **Optimistic update:** Sets query data directly instead of invalidating
- Prevents refetch; client-side state update is immediate

#### Toggle Pin

```typescript
useTogglePin() → useMutation({
  mutationFn: (postId) => POST /posts/:id/pin,
  onSuccess: () => invalidateQueries(queryKeys.posts.all)
})
```

- Board/Admin only
- Invalidates all posts (because list order changes with pin/unpin)

#### Add Comment

```typescript
useAddComment() → useMutation({
  mutationFn: ({ postId, content }) => POST /posts/:id/comments,
  onSuccess: (_, { postId }) => invalidateQueries(detail(postId))
})
```

- Request body: `{ content: "..." }`
- Invalidates detail query (post + comments)

#### Delete Comment

```typescript
useDeleteComment() → useMutation({
  mutationFn: ({ postId, commentId }) => DELETE /posts/:postId/comments/:commentId,
  onSuccess: (_, { postId }) => invalidateQueries(detail(postId))
})
```

- Invalidates detail query

### Frontend Pages

#### `/posts` (Posts List Page)

Main community posts page. Features:

**Filters & Controls:**
- Category tabs: Alle, Fra styret, Generelt, Vedlikehold, Sosialt, Spørsmål
- Search bar (searches title + content client-side from loaded posts)
- Building filter (via `useBuildingFilter()` hook)
- Auto-excludes group posts (`excludeGroupPosts: true`)

**Post Cards (Facebook-style):**
- Pinned indicator bar (colored gradient bar at top)
- Author avatar, name, role badge (Shield icon for board/admin)
- Timestamp (relative, e.g., "2 hours ago")
- Category badge (colored: slate, orange, green, blue)
- "Festet" badge for pinned posts
- Title (bold, if present)
- Content preview (3 lines max, truncated)
- Engagement stats: likes count, comments count
- Action buttons: Like, Comment, Delete (if author/board)

**Sorting:**
- Pinned posts always first
- Then by creation date (newest first)

**Empty state:**
- If search results empty: "Ingen oppslag funnet"
- If no posts at all: EmptyPosts component

**Mobile layout:**
- Mobile: create button as floating action button (FAB) at bottom-right
- Desktop: create button in header

#### `/posts/[id]` (Post Detail Page)

Single post view with full comment thread (assumed to exist, not shown in provided files).

**Typical structure:**
- Full post content (title, body, category, author info)
- All comments in chronological order (oldest first)
- Add comment form
- Edit/delete buttons for post author or board

### Query Keys

Located in `fe_grunnsteinen/src/lib/api/queryKeys.ts`

```typescript
queryKeys.posts.all           // base key for all posts queries
queryKeys.posts.list(params)  // specific list query with filters
queryKeys.posts.detail(id)    // single post detail query
```

### Types

Located in `fe_grunnsteinen/src/types/index.ts`

```typescript
interface Post {
  id: string;
  organizationId: string;
  authorId: string | { id: string; name: string; avatarUrl?: string };
  buildingId?: string;
  groupId?: string;
  isOrganizationWide: boolean;
  title?: string;
  content: string;
  category: 'general' | 'maintenance' | 'social' | 'question' | 'announcement';
  isPinned: boolean;
  isFromBoard: boolean;
  likes: string[];                    // user IDs
  likesCount: number;
  commentsCount: number;
  isLiked?: boolean;                 // computed by API for current user
  comments?: Comment[];               // populated in detail view
  createdAt: Date;
  updatedAt: Date;
}

interface Comment {
  id: string;
  postId: string;
  authorId: string | { id: string; name: string; avatarUrl?: string };
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

type PostQueryParams = {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  category?: PostCategory;
  authorId?: string;
  isPinned?: boolean;
  fromBoard?: boolean;
  groupId?: string;
  excludeGroupPosts?: boolean;
  buildingId?: string;
}
```

### API Endpoints

Located in `fe_grunnsteinen/src/lib/api/endpoints.ts`

```typescript
API_ENDPOINTS.POSTS.LIST              // GET /posts
API_ENDPOINTS.POSTS.CREATE            // POST /posts
API_ENDPOINTS.POSTS.BY_ID(id)         // GET /posts/:id, PATCH, DELETE
API_ENDPOINTS.POSTS.LIKE(id)          // POST /posts/:id/like
API_ENDPOINTS.POSTS.PIN(id)           // POST /posts/:id/pin
API_ENDPOINTS.POSTS.COMMENTS(postId)  // POST /posts/:id/comments
API_ENDPOINTS.POSTS.DELETE_COMMENT(postId, commentId)  // DELETE /posts/:postId/comments/:commentId
```

---

## Key File Paths

| Role | Path |
|------|------|
| BE Controller | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/posts/posts.controller.ts` |
| BE Service | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/posts/posts.service.ts` |
| BE Post Schema | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/posts/schemas/post.schema.ts` |
| BE Comment Schema | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/posts/schemas/comment.schema.ts` |
| BE DTO: Create | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/posts/dto/create-post.dto.ts` |
| BE DTO: Update | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/posts/dto/update-post.dto.ts` |
| BE DTO: Query | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/posts/dto/post-query.dto.ts` |
| BE DTO: Comment | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/posts/dto/create-comment.dto.ts` |
| BE DTO: Response | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/posts/dto/post-response.dto.ts` |
| BE DTO: Comment Response | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/posts/dto/comment-response.dto.ts` |
| FE Hooks | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/hooks/api/usePosts.ts` |
| FE Posts Page | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/app/posts/page.tsx` |
| FE Post Detail Page | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/app/posts/[id]/page.tsx` |
| FE Types | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/types/index.ts` |
| FE Endpoints | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/lib/api/endpoints.ts` |
| FE Query Keys | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/lib/api/queryKeys.ts` |

---

## Common Patterns

### Fetch and display posts with filters

```typescript
const { data: postsData, isLoading } = usePosts({
  category: 'social',
  buildingId: 'xyz',
  limit: 20,
  page: 1
});

if (isLoading) return <PostSkeleton />;
if (!postsData?.data?.length) return <EmptyPosts />;

postsData.data.forEach(post => {
  // Render post card
});
```

### Like a post (with optimistic update)

```typescript
const toggleLike = useToggleLike();

const handleLike = async (postId: string) => {
  try {
    await toggleLike.mutateAsync(postId);
    // UI updates immediately via setQueryData
  } catch (error) {
    toast.error('Kunne ikke like oppslaget');
  }
};
```

### Add comment to post

```typescript
const addComment = useAddComment();

const handleAddComment = async (postId: string, content: string) => {
  if (!content.trim()) {
    toast.error('Kommentaren kan ikke være tom');
    return;
  }
  try {
    await addComment.mutateAsync({ postId, content });
    toast.success('Kommentar lagt til!');
    // Detail query invalidated, comments refetched
  } catch (error) {
    toast.error('Kunne ikke legge til kommentar');
  }
};
```

### Delete post (with confirmation)

```typescript
const deletePost = useDeletePost();

const handleDelete = async (postId: string) => {
  try {
    await deletePost.mutateAsync(postId);
    toast.success('Oppslaget er slettet');
    // Posts list refetched
  } catch (error) {
    toast.error('Kunne ikke slette oppslaget');
  }
};
```

### Filter posts by category and building

```typescript
const queryParams = useMemo(() => ({
  category: selectedCategory,
  buildingId: selectedBuilding,
  limit: 50,
  excludeGroupPosts: true
}), [selectedCategory, selectedBuilding]);

const { data } = usePosts(queryParams);
```

