---
paths:
  - "be_grunnsteinen/src/modules/messages/**"
  - "fe_grunnsteinen/src/hooks/api/useMessages.ts"
  - "fe_grunnsteinen/src/app/messages/**"
---

# Direct Messaging

## Overview

The Messaging module manages one-to-one direct conversations between residents in an organization. Users can send messages, view conversation history with pagination, track unread counts, and mark messages as read. The system enforces 1-to-1 conversation topology and prevents duplicate conversations by sorting participant IDs before lookup.

---

## Data Model

### Conversation Schema

**Collection:** `conversations`

```
_id                 → ObjectId (serialized as `id` in JSON)
organizationId      → ObjectId, required, indexed (→ organizations)
participants        → ObjectId[] (exactly 2 user IDs, sorted alphabetically)
                      validated to be exactly 2; indexed
lastMessageAt?      → Date, optional, indexed (time of most recent message)
lastMessagePreview? → string, max 200 chars (content truncated if > 200)
unreadCount         → Map<string (userId), number> (unread count per user)
                      key = receiving user ID, value = count of unread messages
createdAt           → Date (auto-set)
updatedAt           → Date (auto-updated)
```

**Indexes:**

- `organizationId + lastMessageAt DESC` — for listing conversations sorted by most recent
- `participants + lastMessageAt DESC` — for finding conversations by participants
- `organizationId + participants` (unique, sparse, partialFilterExpression: `{ participants: { $size: 2 } }`)
  - Prevents duplicate 1-to-1 conversations between same two users
  - Ensures `participants` array has exactly 2 entries

### Message Schema

**Collection:** `messages`

```
_id                 → ObjectId (serialized as `id` in JSON)
conversationId      → ObjectId, required, indexed (→ conversations)
senderId            → ObjectId, required, indexed (→ users)
content             → string, required, trimmed (1–2000 chars)
isRead              → boolean, default: false
readAt?             → Date, optional (timestamp when read)
createdAt           → Date (auto-set)
updatedAt           → Date (auto-updated)
```

**Indexes:**

- `conversationId + createdAt DESC` — for fetching messages in a conversation
- `senderId + createdAt DESC` — for fetching messages sent by a user
- `conversationId + isRead + createdAt DESC` — for finding unread messages

---

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/messages` | JWT | Send a message (creates conversation if needed) |
| GET | `/messages/conversations` | JWT | Get paginated conversations for current user |
| GET | `/messages/conversations/:id` | JWT | Get conversation details with recent messages (10 last) |
| GET | `/messages/conversations/:id/messages` | JWT | Get paginated messages in conversation (auto-marks read) |
| POST | `/messages/conversations/:id/read` | JWT | Mark all conversation messages as read |
| GET | `/messages/unread-count` | JWT | Get total unread message count across all conversations |

---

## Business Rules & Logic

### 1-to-1 Conversation Enforcement

**Participant Sorting:**
- When getting or creating a conversation, participant IDs are sorted alphabetically via `localeCompare()`
- Ensures consistent ordering regardless of which user initiates
- Prevents duplicate conversations between A→B and B→A
- Example: [userId1, userId2] (where userId1 < userId2 lexically)

**Database Constraint:**
- Unique compound index: `(organizationId, participants)` with `partialFilterExpression: { participants: { $size: 2 } }`
- Prevents duplicate 1-to-1 conversations
- Validated at schema level: `participants.length === 2`

### Get or Create Conversation

**Endpoint:** `POST /messages` (via `CreateMessageDto.recipientId`)

**Flow:**

1. Validate sender ≠ recipient (throw 400 BadRequestException if same)
2. Fetch recipient user (verify exists; throw 404 NotFoundException if not)
3. Verify recipient in same organization (throw 403 ForbiddenException if different org)
4. Sort participant IDs: `[userId, recipientId].sort((a, b) => a.localeCompare(b))`
5. Query: `findOne({ organizationId, participants: { $all: participantIds, $size: 2 } })`
6. If not found: create new conversation with default unreadCount Map (empty)
7. Return conversation (new or existing)

**Idempotent:** Calling twice with same userId/recipientId returns same conversation.

### Message Sending

**Endpoint:** `POST /messages`

**Request:**
```json
{
  "recipientId": "507f1f77bcf86cd799439011",  // OR conversationId
  "conversationId": null,                        // OR recipientId
  "content": "Hello! How are you?"
}
```

**Validation:**
- Either `recipientId` XOR `conversationId` must be provided (not both, not neither)
- `content`: 1–2000 chars, required
- Both IDs must be valid MongoDB ObjectIds

**If `conversationId` provided:**
1. Fetch conversation
2. Verify sender is participant (throw 403 ForbiddenException if not)
3. Verify conversation in sender's organization

**If `recipientId` provided:**
1. Call `getOrCreateConversation(senderId, recipientId, organizationId)`

**Create message:**
1. Create message document with `conversationId`, `senderId`, `content`, `isRead: false`
2. Get recipient (other participant in conversation)
3. Update conversation:
   - Set `lastMessageAt = now`
   - Set `lastMessagePreview = content.substring(0, 200) + "..."` (if > 200 chars)
   - Increment recipient's unread count: `unreadCount.set(recipientId, currentUnread + 1)`
4. Send notification to recipient (async, non-blocking):
   - Type: `MESSAGE_RECEIVED`
   - Title: `"New message from {senderName}"`
   - Message: preview (200-char truncated content)
   - Link: `/messages/{conversationId}`
   - SendEmail: true (if user has notification prefs enabled)

**Return:** Populated message with sender details

### Get Conversations (List)

**Endpoint:** `GET /messages/conversations`

**Query Parameters (inherited from `PaginationQueryDto`):**
- `page`: default 1
- `limit`: default 20
- `sortBy`: default `lastMessageAt`
- `sortOrder`: default `desc` (most recent first)

**Logic:**
1. Filter: `{ organizationId: userOrgId, participants: userId }`
2. Populate: `participants` array with user fields (name, avatarUrl, avatarColor, email)
3. Sort: `{ [sortBy]: sortOrder === 'desc' ? -1 : 1 }`
4. Paginate: skip, limit
5. Return: PaginatedResponse with conversations (excluding unreadCount Map in response, but available to compute client-side)

### Get Conversation by ID with Recent Messages

**Endpoint:** `GET /messages/conversations/:id`

**Logic:**
1. Fetch conversation by ID
2. Verify user is participant (throw 403 if not)
3. Fetch 10 most recent messages (default limit)
4. Populate both participants with user details
5. Reverse messages array to show oldest first
6. Return: conversation object + `recentMessages[]` (10 messages, oldest → newest)

**Use case:** Open conversation detail page, show last 10 messages while allowing paginated scroll for older messages

### Get Paginated Messages in Conversation

**Endpoint:** `GET /messages/conversations/:id/messages`

**Query Parameters:**
- `page`: default 1
- `limit`: default 50
- `sortBy`: default `createdAt`
- `sortOrder`: default `desc` (newest first in DB, client reverses for display)
- `conversationId`: passed from route param (auto-populated)

**Logic:**
1. Verify conversation exists
2. Verify user is participant (throw 403 if not)
3. Fetch paginated messages from conversation
4. Populate senderId with user details (name, avatarUrl, avatarColor, role)
5. **Auto-mark messages as read** for current user:
   - Find unread messages in this conversation sent by other participant
   - Update `isRead = true`, `readAt = now` for those messages
   - Decrement conversation's `unreadCount[userId]` by count of marked messages
   - Save conversation
6. Return: PaginatedResponse with messages

**Side effect:** Simply opening a conversation marks messages as read (UX: no explicit "mark as read" action needed)

### Mark Conversation as Read

**Endpoint:** `POST /messages/conversations/:id/read`

**Logic:**
1. Verify conversation exists and user is participant
2. Update all unread messages in conversation (sent by other participant) to `isRead = true`, `readAt = now`
3. Set `unreadCount[userId] = 0` for this user in conversation
4. Save conversation
5. Return 204 No Content

**Use case:** Explicit "mark all as read" button (though `getMessages` also auto-marks)

### Get Unread Count

**Endpoint:** `GET /messages/unread-count`

**Logic:**
1. Fetch all conversations containing current user
2. Sum up `unreadCount.get(userId)` for each conversation
3. Return: `{ count: totalUnread }`

**Use case:** Display badge on messages icon in header (e.g., "3 unread")

### Delete Conversation

**Endpoint:** Not exposed in current API (internal only)

**Logic:**
1. Verify user is participant
2. Delete conversation document
3. Delete all messages in conversation
4. Since conversations require exactly 2 participants, entire conversation is removed (no soft delete)

---

## Notifications & Side Effects

### MESSAGE_RECEIVED

Sent when a message is sent to a user.

**Trigger:** `sendMessage()` after message + conversation created/updated

**Recipients:** Recipient user (other participant)

**Fields:**
- Type: `NotificationType.MESSAGE_RECEIVED`
- Title: `"New message from {senderName}"`
- Message: `preview` (200-char truncated content)
- Link: `/messages/{conversationId}`
- SendEmail: true (checked against user's notification preferences)

**Error handling:** Non-blocking; logged as error if fails, does not prevent message creation

---

## Frontend

### Hooks (fe_grunnsteinen/src/hooks/api/useMessages.ts)

**useConversations()**
- Query hook for user's conversation list
- Returns: `{ data: Conversation[] | undefined, isLoading, error }`
- Query key: `queryKeys.messages.conversations`
- Auto-invalidates after `useSendMessage()`, `useMarkConversationRead()`

**useConversation(conversationId: string)**
- Query hook for single conversation with recent messages (10)
- Returns: `{ data: Conversation & { recentMessages: Message[] } | undefined, isLoading, error }`
- Query key: `queryKeys.messages.conversation(conversationId)`
- Enabled only if `conversationId` is truthy

**useMessages(conversationId: string, params?: PaginationParams)**
- Query hook for paginated messages in conversation
- Returns: `{ data: PaginatedResponse<Message>, isLoading, error }`
- Query key: `[...queryKeys.messages.conversation(conversationId), 'messages', params]`
- Enabled only if `conversationId` is truthy
- Refetch interval: none (manual control)
- Auto-marks messages as read on fetch

**useUnreadMessageCount()**
- Query hook for total unread count
- Returns: `{ data: { count: number } | undefined, isLoading, error }`
- Query key: `queryKeys.messages.unreadCount`
- Refetch interval: 30 seconds (polls for real-time badge updates)

**useSendMessage()**
- Mutation hook to send message
- Input: `{ recipientId?: string, conversationId?: string, content: string }`
- Returns: created Message object
- On success: invalidates `conversations`, `unreadCount`, and conversation detail query (if applicable)
- Error: includes validation failures (recipient not found, already messaging self, etc.)

**useMarkConversationRead()**
- Mutation hook to mark conversation as read
- Input: `conversationId: string`
- Returns: void (204 No Content)
- On success: invalidates conversations list + specific conversation + unread count

**useStartConversation()**
- Convenience hook wrapper around `useSendMessage()`
- Input: `{ recipientId: string, content: string }`
- Returns: Message with `conversationId` populated
- Use case: Start new conversation from user profile card

### Frontend Pages

#### `/messages` (Messages List Page)

Main messaging hub (assumed to exist, structure inferred from hooks).

**Expected features:**
- Conversation list (paginated, sorted by most recent first)
- Search by recipient name (client-side or server-side)
- Unread badge on each conversation card
- Click to open conversation detail
- "New message" button to start conversation
- Loading/empty states

**Conversation Card:**
- Recipient avatar, name
- Last message preview (truncated)
- Last message time (relative, e.g., "2 hours ago")
- Unread count badge (only if > 0)
- Delete/archive button (optional)

#### `/messages/[id]` (Conversation Detail Page)

Single conversation view with message thread (assumed to exist).

**Expected features:**
- Conversation header with recipient info
- Paginated message thread (infinite scroll or pagination)
- Message input form at bottom
- Auto-scroll to newest message
- Show timestamps on messages
- Distinguish sent vs received (left/right layout)
- Mark as read button or auto-mark behavior
- Delete conversation action

**Message Bubble:**
- Sender avatar, name
- Message content
- Timestamp
- Read status indicator (optional, e.g., checkmark)

### Types (fe_grunnsteinen/src/types/index.ts)

```typescript
interface Conversation {
  id: string;
  organizationId: string;
  participants: (string | User)[];  // can be user IDs or populated User objects
  lastMessageAt?: Date;
  lastMessagePreview?: string;
  unreadCount?: Record<string, number>;  // Map<userId, count> serialized as object
  createdAt?: Date;
  updatedAt?: Date;
  // For detail view:
  recentMessages?: Message[];
}

interface Message {
  id: string;
  conversationId: string;
  senderId: string | User;  // can be user ID or populated User object
  content: string;
  isRead: boolean;
  readAt?: Date;
  createdAt: Date;
  updatedAt?: Date;
}

interface SendMessageData {
  recipientId?: string;
  conversationId?: string;
  content: string;
}
```

### Query Keys (fe_grunnsteinen/src/lib/api/queryKeys.ts)

```typescript
messages: {
  conversations: [...]
  conversation: (conversationId: string) => [...]
  unreadCount: [...]
}
```

### API Endpoints (fe_grunnsteinen/src/lib/api/endpoints.ts)

```typescript
API_ENDPOINTS.MESSAGES = {
  SEND: '/messages',
  CONVERSATIONS: '/messages/conversations',
  CONVERSATION_BY_ID: (id: string) => `/messages/conversations/${id}`,
  CONVERSATION_MESSAGES: (id: string) => `/messages/conversations/${id}/messages`,
  MARK_READ: (id: string) => `/messages/conversations/${id}/read`,
  UNREAD_COUNT: '/messages/unread-count',
}
```

---

## DTO Validation Rules

### CreateMessageDto

| Field | Type | Required | Rules |
|-------|------|----------|-------|
| `recipientId` | string | Conditional | Valid MongoDB ObjectId if `conversationId` not provided |
| `conversationId` | string | Conditional | Valid MongoDB ObjectId if `recipientId` not provided |
| `content` | string | Yes | 1–2000 chars, non-empty |

**Validation logic:**
- Exactly one of `recipientId` or `conversationId` must be provided (XOR)
- Custom validator using `@ValidateIf()` + `@IsNotEmpty()`

### ConversationQueryDto (extends PaginationQueryDto)

| Field | Type | Default | Rules |
|-------|------|---------|-------|
| `page` | number | 1 | inherited |
| `limit` | number | 20 | inherited |
| `sortBy` | string | `lastMessageAt` | inherited |
| `sortOrder` | 'asc' \| 'desc' | 'desc' | inherited |

No additional filters (conversations already scoped to user).

### MessageQueryDto (extends PaginationQueryDto)

| Field | Type | Default | Rules |
|-------|------|---------|-------|
| `page` | number | 1 | inherited |
| `limit` | number | 50 | inherited |
| `sortBy` | string | `createdAt` | inherited |
| `sortOrder` | 'asc' \| 'desc' | 'desc' | inherited |
| `conversationId` | string | optional | Valid MongoDB ObjectId if provided (usually from path) |

---

## Key Participant Deduplication Strategy

**Problem:** Without deduplication, users could create separate conversations A→B and B→A.

**Solution: Sorted participant array**

```typescript
const participantIds = [userId, recipientId]
  .map((id) => new Types.ObjectId(id))
  .sort((a, b) => a.toString().localeCompare(b.toString()));
```

**Result:**
- User A sends to User B → participants: [A._id, B._id] (if A < B lexically)
- User B sends to User A → participants: [A._id, B._id] (same array)
- Query with unique index prevents duplicates

**Database constraint:**
```
Unique index: { organizationId: 1, participants: 1 }
Partial filter: { participants: { $size: 2 } }
```

---

## Unread Count Tracking

**Per-user Map in Conversation:**
```
conversation.unreadCount = Map<userId, count>
  userId = receiving user (other participant)
  count = number of unread messages they have in this conversation
```

**Increment:** When sender sends message
```typescript
const currentUnread = conversation.unreadCount.get(recipientId) || 0;
conversation.unreadCount.set(recipientId, currentUnread + 1);
```

**Decrement:** When recipient fetches messages or marks as read
```typescript
const currentUnread = conversation.unreadCount.get(userId) || 0;
const newUnread = Math.max(0, currentUnread - unreadMessages.length);
conversation.unreadCount.set(userId, newUnread);
```

**Total unread:** Sum across all conversations
```typescript
let totalUnread = 0;
for (const conversation of conversations) {
  const unread = conversation.unreadCount.get(userId) || 0;
  totalUnread += unread;
}
```

---

## Common Patterns

### Fetch and display conversation list

```typescript
const { data: conversations, isLoading } = useConversations();

if (isLoading) return <Skeleton />;
if (!conversations?.length) return <EmptyMessages />;

conversations.map(conv => (
  <ConversationCard
    key={conv.id}
    conversation={conv}
    unreadCount={conv.unreadCount?.get(userId) || 0}
  />
))
```

### Open conversation and fetch messages

```typescript
const { data: conversation } = useConversation(conversationId);
const { data: messagesData } = useMessages(conversationId, { page: 1, limit: 50 });

if (!conversation) return <NotFoundError />;
if (!messagesData?.data) return <LoadingSkeleton />;

// Messages auto-marked as read when fetched
return <MessageThread messages={messagesData.data} />;
```

### Send message in conversation

```typescript
const sendMessage = useSendMessage();

const handleSend = async (content: string) => {
  if (!content.trim()) {
    toast.error('Meldingen kan ikke være tom');
    return;
  }
  try {
    await sendMessage.mutateAsync({
      conversationId: conversationId,
      content
    });
    // Clear input field
    setContent('');
    // Message list auto-refetched, scroll to bottom
  } catch (error) {
    toast.error(handleApiError(error));
  }
};
```

### Start new conversation

```typescript
const startConversation = useStartConversation();

const handleStartConversation = async (recipientId: string, content: string) => {
  try {
    const message = await startConversation.mutateAsync({
      recipientId,
      content
    });
    // Navigate to conversation
    router.push(`/messages/${message.conversationId}`);
    toast.success('Melding sendt!');
  } catch (error) {
    toast.error(handleApiError(error));
  }
};
```

### Display unread count badge

```typescript
const { data: unreadData } = useUnreadMessageCount();

return (
  <Badge variant="destructive">
    {unreadData?.count || 0}
  </Badge>
);
```

---

## Key File Paths

| Role | Path |
|------|------|
| BE Controller | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/messages/messages.controller.ts` |
| BE Service | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/messages/messages.service.ts` |
| BE Conversation Schema | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/messages/schemas/conversation.schema.ts` |
| BE Message Schema | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/messages/schemas/message.schema.ts` |
| BE DTO: CreateMessage | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/messages/dto/create-message.dto.ts` |
| BE DTO: ConversationQuery | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/messages/dto/conversation-query.dto.ts` |
| BE DTO: MessageQuery | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/messages/dto/message-query.dto.ts` |
| FE Hooks | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/hooks/api/useMessages.ts` |
| FE Messages Page | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/app/messages/page.tsx` |
| FE Conversation Detail Page | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/app/messages/[id]/page.tsx` |
| FE Types | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/types/index.ts` (Conversation, Message sections) |
| FE API Endpoints | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/lib/api/endpoints.ts` (MESSAGES) |
| FE Query Keys | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/lib/api/queryKeys.ts` (messages) |
