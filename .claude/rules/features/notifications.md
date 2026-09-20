---
paths:
  - "be_grunnsteinen/src/modules/notifications/**"
  - "fe_grunnsteinen/src/hooks/api/useNotifications.ts"
  - "fe_grunnsteinen/src/app/notifications/**"
---

# Notifications

## Overview

The Notifications module manages in-app notification delivery and tracking for all community activities. Users receive notifications for posts, comments, events, bookings, messages, help requests, and board announcements. The system supports granular notification preferences (email & push channels per feature), automatic TTL-based cleanup (90-day expiration), and unread count tracking. Notifications enable users to stay informed without email overload by respecting their preferences.

---

## Data Model

### Notification Schema

**Collection:** `notifications`

```typescript
{
  // Reference
  userId              → ObjectId, required, indexed (→ users)
                        who receives the notification

  // Content
  type                → NotificationType enum, required, indexed
  title               → string, required, trimmed (notification subject)
  message             → string, required, trimmed (notification body)
  linkTo?             → string, optional (URL path to navigate to, e.g. '/posts/123')

  // Context
  relatedId?          → ObjectId (ID of related resource: post, event, message, etc.)
  relatedType?        → string (type of related resource: 'post', 'event', 'booking', etc.)

  // Status
  isRead              → boolean, default: false, indexed
  readAt?             → Date (timestamp when user marked as read)

  // Base
  createdAt           → Date (auto-set, indexed)
  updatedAt           → Date (auto-updated)
}
```

### NotificationType Enum

```typescript
enum NotificationType {
  POST = 'post'                          // New post published
  COMMENT = 'comment'                    // New comment on user's post
  EVENT = 'event'                        // New event created
  BOOKING = 'booking'                    // Booking status changed (confirmed/rejected)
  MESSAGE = 'message'                    // New direct message received
  HELP_REQUEST = 'help-request'          // Help request posted
  SYSTEM = 'system'                      // System-level announcements
}
```

### Indexes

```
userId (indexed)
userId + isRead (compound)
userId + createdAt DESC (compound, for listing)
userId + isRead + createdAt DESC (compound, for efficient filtering)
createdAt (TTL index with 90-day expiration, auto-deletes documents)
```

**TTL Index:**
```
db.notifications.createIndex(
  { createdAt: 1 },
  { expireAfterSeconds: 7776000 }  // 90 days in seconds
)
```

MongoDB automatically deletes documents 90 days after creation, preventing unbounded storage growth.

---

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/notifications` | JWT | Get paginated notifications for current user |
| GET | `/notifications/unread-count` | JWT | Get total unread notification count |
| POST | `/notifications/:id/read` | JWT | Mark single notification as read |
| POST | `/notifications/read-all` | JWT | Mark all notifications as read (204 No Content) |
| DELETE | `/notifications/:id` | JWT | Delete single notification (204 No Content) |
| DELETE | `/notifications` | JWT | Delete all notifications for user (204 No Content) |

---

## Business Rules & Logic

### Notification Creation

**Core method: `notificationsService.create()`**

```typescript
async create(
  userId: string,
  type: NotificationType,
  title: string,
  message: string,
  linkTo?: string,
  relatedId?: string,
  relatedType?: string,
): Promise<NotificationDocument>
```

**Parameters:**
- `userId`: User who receives the notification (must exist)
- `type`: One of the NotificationType enum values
- `title`: Short subject (e.g., "New post from John")
- `message`: Body text (max length varies by feature, typically 500-1000 chars)
- `linkTo`: Optional URL path (e.g., `/posts/{postId}`, `/messages/{conversationId}`)
- `relatedId`: ObjectId of the related resource (optional, for tracking context)
- `relatedType`: String identifier of resource type (optional, for filtering/analysis)

**Behavior:**
1. Create notification document with `isRead: false`
2. Return saved notification with populated userId details
3. Non-blocking: if creation fails, log warning but don't fail the operation that triggered it

**Example trigger (from posts.service.ts):**
```typescript
await this.notificationsService.create(
  commentAuthorId.toString(),
  NotificationType.COMMENT,
  'New comment on your post',
  `${commentAuthor.name} commented: "${content.substring(0, 100)}..."`,
  `/posts/${postId}`,
  postId.toString(),
  'comment'
);
```

### Bulk Notification Creation

**Core method: `notificationsService.createBulk()`**

```typescript
async createBulk(
  userIds: string[],
  type: NotificationType,
  title: string,
  message: string,
  linkTo?: string,
  relatedId?: string,
  relatedType?: string,
): Promise<void>
```

**Use cases:**
- Broadcasting to all members when a post is created in a group
- Notifying building members when an event is created
- Board announcements to organization-wide audiences

**Behavior:**
1. Map userIds to notification documents (remove duplicates via Set)
2. Insert all at once via `insertMany()`
3. Log total count created
4. Non-blocking: continue even if some inserts fail

**Example trigger (from posts.service.ts, when group post is created):**
```typescript
const groupMembers = group.members.filter(
  m => m.toString() !== authorId.toString()
);

await this.notificationsService.createBulk(
  groupMembers.map(m => m.toString()),
  NotificationType.POST,
  'New post in group',
  `${author.name} posted in "${groupName}"`,
  `/posts/${postId}`,
  postId.toString(),
  'post'
);
```

### List Notifications with Pagination

**Endpoint:** `GET /notifications`

**Query parameters:**
```
page: number              // default: 1
limit: number             // default: 20
sortBy: string            // default: "createdAt"
sortOrder: "asc" | "desc" // default: "desc" (newest first)
```

**Response:**
```json
{
  "data": [
    {
      "id": "507f1f77bcf86cd799439011",
      "userId": "507f1f77bcf86cd799439012",
      "type": "comment",
      "title": "New comment on your post",
      "message": "Jane Doe replied to your post",
      "linkTo": "/posts/507f1f77bcf86cd799439013",
      "relatedId": "507f1f77bcf86cd799439013",
      "relatedType": "comment",
      "isRead": false,
      "readAt": null,
      "createdAt": "2024-03-10T14:30:00Z",
      "updatedAt": "2024-03-10T14:30:00Z"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

**Sorting:**
- Default: `createdAt: -1` (newest first)
- Can override via `sortBy` + `sortOrder`
- Common sorts: `createdAt`, `isRead` (unread first), `type` (by category)

### Get Unread Count

**Endpoint:** `GET /notifications/unread-count`

**Response:**
```json
{
  "count": 5
}
```

**Implementation:**
- Query: `{ userId, isRead: false }` and count
- Used for badge on notification icon in header
- Polled every 30 seconds by frontend (via `useUnreadNotificationCount()`)

### Mark Single Notification as Read

**Endpoint:** `POST /notifications/:id/read`

**Behavior:**
1. Find notification by ID and user (prevent users from reading others' notifications)
2. Set `isRead: true` and `readAt: now()`
3. Return updated notification
4. On error: throw NotFoundException if not found

**Response:** Updated notification document

### Mark All Notifications as Read

**Endpoint:** `POST /notifications/read-all`

**Behavior:**
1. Update all unread notifications for user: `{ isRead: false }` → `{ isRead: true, readAt: now() }`
2. Uses `updateMany()` for efficiency
3. Return 204 No Content (no response body)

**Use case:** "Mark all as read" button on notifications center

### Delete Single Notification

**Endpoint:** `DELETE /notifications/:id`

**Behavior:**
1. Find and delete by ID and user (prevent cross-user deletion)
2. Throw NotFoundException if not found
3. Return 204 No Content

**Validation:**
- Verify notification belongs to authenticated user before deletion

### Delete All Notifications

**Endpoint:** `DELETE /notifications`

**Behavior:**
1. Delete all notifications for authenticated user
2. Return 204 No Content
3. Log count of deleted documents

**Use case:** "Clear all" button for notifications cleanup

---

## Notification Preferences (User Schema)

Stored on each User document:

```typescript
notificationPreferences: {
  email: {
    posts: boolean;           // New posts in user's building
    comments: boolean;        // Comments on user's posts
    events: boolean;          // New events in user's building
    bookings: boolean;        // Booking status changes
    messages: boolean;        // New direct messages
    helpRequests: boolean;    // Help requests posted
    boardAnnouncements: boolean;  // Board-only announcements
  },
  push: {
    // Same fields as email (in-app push notifications)
    posts: boolean;
    comments: boolean;
    events: boolean;
    bookings: boolean;
    messages: boolean;
    helpRequests: boolean;
    boardAnnouncements: boolean;
  }
}
```

**Default:** All enabled (true) on account creation

**User control:** Toggled via `/profile` page (NotificationPreferencesForm)

**Email service integration:** Before sending email for a notification:
```typescript
const user = await this.userModel.findById(userId);
const shouldSendEmail = user.notificationPreferences.email[notificationType];
if (shouldSendEmail) {
  await this.emailService.send(...);
}
```

---

## Notification Triggers Across Modules

### Posts Module

**When post is created:**
- If in a group: bulk notifications to group members (exclude author)
- Type: `POST`
- Title: "New post"
- Message: `"{authorName} posted in {groupName}"`

**When comment is added:**
- Single notification to post author (if commenter ≠ author)
- Type: `COMMENT`
- Title: "New comment on your post"
- Message: `"{commenterName} commented"`

### Events Module

**When event is created:**
- Bulk notifications to building/organization members (exclude organizer)
- Scope: building → organization-wide based on event settings
- Type: `EVENT`
- Title: "New event"
- Message: `"{title}" at {location} on {date}`

**When event date changes (only if dates changed):**
- Bulk notifications to all participants
- Type: `EVENT`
- Title: "Event date changed"
- Message: `"The event {title} has been updated"`

**When event is cancelled/deleted:**
- Bulk notifications to all participants
- Type: `EVENT` (or could be separate enum)
- Title: "Event cancelled"
- Message: `"The event {title} has been cancelled"`

### Bookings Module

**When booking confirmed (immediately or after approval):**
- Single notification to booking user
- Type: `BOOKING`
- Title: "Booking confirmed"
- Message: `"Your booking for {resourceName} is confirmed"`
- LinkTo: `/bookings/{bookingId}`

**When booking rejected (if was pending):**
- Single notification to booking user
- Type: `BOOKING`
- Title: "Booking rejected"
- Message: `"Your booking for {resourceName} was rejected: {reason}"`

### Messages Module

**When message is sent:**
- Single notification to recipient
- Type: `MESSAGE`
- Title: "New message"
- Message: `"From {senderName}: {preview (200 chars max)}..."`
- LinkTo: `/messages/{conversationId}`
- SendEmail: true (via user prefs)

### Help Requests Module

**When help request is posted:**
- Bulk notifications to building/organization based on scope
- Type: `HELP_REQUEST`
- Title: "Help request posted"
- Message: `"{requesterName} needs help with {category}"`
- LinkTo: `/help-requests/{helpRequestId}`

### Groups Module

**When user is added to group (admin/creator adds):**
- Single notification to added user
- Type: `GROUP_INVITATION` (or custom enum)
- Title: "Added to group"
- Message: `"{adderName} added you to {groupName}"`
- LinkTo: `/groups/{groupId}`

---

## Email & SMS Integration

**Email Service:**
- Called by `emailService.sendXXX()` methods from various modules
- Checks user's `notificationPreferences.email[featureType]` before sending
- Non-blocking: errors logged, don't fail the operation

**No SMS notifications (currently):**
- Building broadcast messages use SMS via separate `SendBuildingMessageDto`
- Per-feature notifications are email/in-app only

---

## Frontend

### Hooks

Located in `fe_grunnsteinen/src/hooks/api/useNotifications.ts`

**useNotifications(params?: PaginationParams)**
- Query hook for paginated notifications list
- Returns: `{ data: PaginatedResponse<Notification>, isLoading, error }`
- Query key: `queryKeys.notifications.list(params)`
- Default pagination: page=1, limit=20

**useUnreadNotificationCount()**
- Query hook for unread count
- Returns: `{ data: { count: number }, isLoading, error }`
- Query key: `queryKeys.notifications.unreadCount`
- **Refetch interval:** 30 seconds (polls for real-time badge updates)

**useMarkNotificationRead()**
- Mutation hook to mark single notification as read
- Input: `notificationId: string`
- On success: invalidates list + unreadCount queries
- Returns: mutate, mutateAsync, isLoading, error

**useMarkAllNotificationsRead()**
- Mutation hook to mark all as read
- Input: none
- On success: invalidates list + unreadCount queries
- Returns: mutate, mutateAsync, isLoading, error

**useDeleteNotification()**
- Mutation hook to delete single notification
- Input: `notificationId: string`
- On success: invalidates list + unreadCount queries
- Returns: mutate, mutateAsync, isLoading, error

**useDeleteAllNotifications()**
- Mutation hook to delete all notifications
- Input: none
- On success: invalidates list + unreadCount queries
- Returns: mutate, mutateAsync, isLoading, error

**useNotificationClick() (helper)**
- Input: `notification: Notification`, `router: NextRouter`
- Behavior: marks as read (if unread) + navigates to `notification.linkTo`
- Returns: mutate, mutateAsync + handleClick function

### UI Components

**Notifications Center** (assumed to exist)
- Display list of notifications from `useNotifications()`
- Badge showing unread count from `useUnreadNotificationCount()`
- "Mark all as read" button → `useMarkAllNotificationsRead()`
- Per-notification actions: click to read + navigate, delete
- Empty state if no notifications
- Loading skeleton while fetching

**Notification Card**
- Show title, message, type badge (colored by type)
- Unread indicator (blue dot or bold text)
- Timestamp (relative time, e.g., "2 hours ago")
- Preview of message (truncated if long)
- Delete button (small x icon)
- Click to read + navigate via `useNotificationClick()`

**Header Badge**
- Display unread count in notification icon
- Red badge if count > 0
- Update every 30 seconds via polling

### Types

Located in `fe_grunnsteinen/src/types/index.ts`

```typescript
type NotificationType =
  | 'post'
  | 'comment'
  | 'event'
  | 'booking'
  | 'message'
  | 'help-request'
  | 'system';

interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  linkTo?: string;
  relatedId?: string;
  relatedType?: string;
  isRead: boolean;
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface UnreadCountResponse {
  count: number;
}
```

### Query Keys

Located in `fe_grunnsteinen/src/lib/api/queryKeys.ts`

```typescript
notifications: {
  all: ['notifications'],
  list: (params?: PaginationParams) => [...notifications.all, 'list', params],
  unreadCount: [...notifications.all, 'unread-count'],
}
```

### API Endpoints

Located in `fe_grunnsteinen/src/lib/api/endpoints.ts`

```typescript
API_ENDPOINTS.NOTIFICATIONS = {
  LIST: '/notifications',
  UNREAD_COUNT: '/notifications/unread-count',
  MARK_READ: (id: string) => `/notifications/${id}/read`,
  MARK_ALL_READ: '/notifications/read-all',
  DELETE: (id: string) => `/notifications/${id}`,
  DELETE_ALL: '/notifications',
}
```

---

## Common Patterns

### Display notification badge in header

```typescript
const { data: unreadData } = useUnreadNotificationCount();

return (
  <button className="relative">
    <BellIcon />
    {unreadData?.count > 0 && (
      <Badge className="absolute top-0 right-0" variant="destructive">
        {unreadData.count}
      </Badge>
    )}
  </button>
);
```

### Fetch and display notifications list

```typescript
const { data, isLoading } = useNotifications({
  page: 1,
  limit: 20
});

if (isLoading) return <Skeleton />;
if (!data?.data?.length) return <EmptyNotifications />;

return data.data.map(notification => (
  <NotificationCard key={notification.id} notification={notification} />
));
```

### Mark notification as read and navigate

```typescript
const { handleClick } = useNotificationClick();
const router = useRouter();

const handleNotificationClick = async (notification: Notification) => {
  await handleClick(notification, router);
};
```

### Clear all notifications

```typescript
const deleteAll = useDeleteAllNotifications();

const handleClearAll = async () => {
  if (!confirm('Slett alle varsler?')) return;
  try {
    await deleteAll.mutateAsync();
    toast.success('Alle varsler slettet');
  } catch (error) {
    toast.error(handleApiError(error));
  }
};
```

---

## DTO Validation Rules

### Notification Response DTO

| Field | Type | Required |
|-------|------|----------|
| `id` | string | Yes |
| `userId` | string | Yes |
| `type` | NotificationType enum | Yes |
| `title` | string | Yes |
| `message` | string | Yes |
| `linkTo` | string | No |
| `relatedId` | string | No |
| `relatedType` | string | No |
| `isRead` | boolean | Yes |
| `readAt` | Date | No |
| `createdAt` | Date | Yes |
| `updatedAt` | Date | Yes |

No input DTOs exposed to frontend (notifications are created server-side only).

---

## Key File Paths

| Role | Path |
|------|------|
| BE Schema | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/notifications/schemas/notification.schema.ts` |
| BE Service | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/notifications/notifications.service.ts` |
| BE Controller | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/notifications/notifications.controller.ts` |
| BE Module | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/notifications/notifications.module.ts` |
| FE Hooks | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/hooks/api/useNotifications.ts` |
| FE Types | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/types/index.ts` (Notification section) |
| FE API Endpoints | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/lib/api/endpoints.ts` (NOTIFICATIONS) |
| FE Query Keys | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/lib/api/queryKeys.ts` (notifications) |

---

## Performance Considerations

**TTL Cleanup:**
- Automatic MongoDB TTL index deletes notifications after 90 days
- No manual cleanup needed; database doesn't grow unbounded
- Users can manually delete all notifications via `DELETE /notifications` if preferred

**Polling vs WebSockets:**
- Unread count polled every 30 seconds (lightweight check)
- Not real-time push, but acceptable for most use cases
- Could upgrade to WebSockets if instant notifications needed (future enhancement)

**Bulk Operations:**
- `createBulk()` uses `insertMany()` for efficiency (single DB operation for up to thousands of users)
- Pagination on list endpoint prevents loading all notifications at once

**Indexing:**
- Compound indexes on `(userId, createdAt)` and `(userId, isRead, createdAt)` for fast filtering
- Ensures `GET /notifications` queries are O(log n) regardless of total notification count

---

## Error Handling

**Notification creation failures (non-blocking):**
- Logged as warning
- Don't prevent the operation that triggered the notification
- Users can still use the feature (e.g., create a post) even if notification fails

**Read/Delete failures (user-facing):**
- Throw specific exceptions: `NotFoundException` (404), `ForbiddenException` (403)
- Frontend catches and shows toast error via `handleApiError()`
- User can retry the action

**Email delivery failures:**
- Logged as warning, caught in try-catch
- Don't fail the overall operation
- User sees the notification in-app regardless of email send failure
