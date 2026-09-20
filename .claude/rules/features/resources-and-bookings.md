---
paths:
  - "be_grunnsteinen/src/modules/resources/**"
  - "be_grunnsteinen/src/modules/bookings/**"
  - "fe_grunnsteinen/src/hooks/api/useResources.ts"
  - "fe_grunnsteinen/src/hooks/api/useBookings.ts"
  - "fe_grunnsteinen/src/app/booking/**"
---

# Resources & Bookings

## Overview

The Resources & Bookings modules manage shared asset reservation within housing associations. Resources represent bookable assets (guest apartments, parking spaces, common areas, equipment). Bookings represent reservations with pricing, availability checking, approval workflows, and email confirmations. Together they enable residents to reserve and use shared community resources transparently and efficiently.

## Data Model

### Resource Schema

**Collection:** `resources`

```
_id                 → ObjectId (serialized as `id` in JSON)
organizationId      → ObjectId, required, indexed (→ organizations)
buildingId          → ObjectId, optional, indexed (→ buildings)
isOrganizationWide  → boolean, default: false
name                → string, required, trimmed
type                → ResourceType enum, required, indexed
description?        → string, optional, trimmed
imageUrls[]         → string[], default: [] (S3 URLs)

// Pricing
pricePerDay         → number, default: 0, min: 0
pricePerHour?       → number, optional, min: 0
currency            → string, default: 'NOK'

// Booking rules
rules?              → string, optional (free-text booking guidelines)
minBookingHours?    → number, optional, min: 0
maxBookingDays?     → number, optional, min: 0
requiresApproval    → boolean, default: false

// Availability
availableDays[]     → number[], default: [] (0=Sunday, 6=Saturday; empty=all days)
availableTimeStart  → string, default: '00:00' (HH:MM format)
availableTimeEnd    → string, default: '23:59' (HH:MM format)

isActive            → boolean, default: true, indexed
createdAt           → Date (auto-set)
updatedAt           → Date (auto-updated)
```

### ResourceType Enum

```
GUEST_APARTMENT = 'guest-apartment'   // Guest apartments for visitors
COMMON_AREA = 'common-area'           // Shared spaces (lounge, garden, kitchen)
PARKING = 'parking'                   // Parking spaces
EQUIPMENT = 'equipment'               // Tools, bikes, sports equipment
```

### Resource Indexes

```
organizationId, type (compound)
organizationId, isActive (compound)
organizationId, type, isActive (compound)
organizationId, buildingId (compound)
buildingId, isOrganizationWide (compound)
name, description (text search)
```

---

### Booking Schema

**Collection:** `bookings`

```
_id                 → ObjectId (serialized as `id`)
organizationId      → ObjectId, required, indexed (→ organizations)
resourceId          → ObjectId, required, indexed (→ resources)
buildingId          → ObjectId, optional, indexed (→ buildings)
userId              → ObjectId, required, indexed (→ users)

// Dates
startDate           → Date, required, indexed
endDate             → Date, required, indexed

// Status & Lifecycle
status              → BookingStatus enum, default: PENDING, indexed
totalPrice          → number, required, min: 0
currency            → string, default: 'NOK'

// Notes
notes?              → string, optional (user-provided notes)
adminNotes?         → string, optional (admin-only internal notes)

// Cancellation
cancelledAt?        → Date
cancelledBy?        → ObjectId (→ users)
cancellationReason? → string

createdAt           → Date (auto-set)
updatedAt           → Date (auto-updated)
```

### BookingStatus Enum

```
PENDING   = 'pending'       // Awaiting admin approval
CONFIRMED = 'confirmed'     // Approved/immediately confirmed
CANCELLED = 'cancelled'     // Cancelled by user or admin
COMPLETED = 'completed'     // Booking period has ended
```

### Booking Indexes

```
resourceId, startDate, endDate, status (compound - for availability checking)
organizationId, buildingId, startDate (compound)
```

---

## API Endpoints

### Resource Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/resources` | BOARD, ADMIN | Create new resource |
| GET | `/resources` | JWT (any) | Get paginated resources with filters |
| GET | `/resources/:id` | JWT (any) | Get resource details |
| GET | `/resources/:id/availability` | JWT (any) | Get availability time slots for date range |
| PATCH | `/resources/:id` | BOARD, ADMIN | Update resource |
| POST | `/resources/:id/images` | BOARD, ADMIN | Add images to resource |
| DELETE | `/resources/:id/images` | BOARD, ADMIN | Remove image from resource |
| DELETE | `/resources/:id` | BOARD, ADMIN | Deactivate resource (soft delete) |

### Booking Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/bookings` | JWT (any) | Create new booking |
| GET | `/bookings` | JWT | Get paginated bookings (board sees all, residents see own) |
| GET | `/bookings/my` | JWT | Get current user's bookings |
| GET | `/bookings/:id` | JWT | Get booking details (with access check) |
| PATCH | `/bookings/:id` | JWT | Update booking notes (user or board) |
| POST | `/bookings/:id/approve` | BOARD, ADMIN | Approve pending booking |
| POST | `/bookings/:id/reject` | BOARD, ADMIN | Reject pending booking with optional reason |
| POST | `/bookings/:id/cancel` | JWT | Cancel confirmed or pending booking |

---

## Business Rules & Logic

### Resource Management

#### Resource Creation

**Endpoint:** `POST /resources`

**Authorization:** BOARD or ADMIN only

**Validation:**
- `buildingId` required, must be valid MongoDB ID
- `name` required, string
- `type` required, must be valid ResourceType enum
- `pricePerDay` required, >= 0
- `pricePerHour` optional, >= 0
- `minBookingHours`, `maxBookingDays` optional, >= 0
- `rules` optional, free-text
- `availableDays` optional, array of 0-6 (validated range)
- `availableTimeStart`, `availableTimeEnd` optional, HH:MM format

**Behavior:**
- `organizationId` auto-populated from authenticated user
- `isActive` defaults to `true`
- `currency` defaults to 'NOK'
- `availableDays` empty array means available all days
- `pricePerDay` and `pricePerHour` coexist (pricing algorithm chooses based on booking duration)

#### Resource Updates

**Endpoint:** `PATCH /resources/:id`

**Authorization:** BOARD or ADMIN only

All fields optional. Partial updates supported (only specified fields modified).

#### Resource Deactivation

**Endpoint:** `DELETE /resources/:id`

**Authorization:** BOARD or ADMIN only

**Behavior:**
- Sets `isActive: false` (soft delete)
- No bookings are deleted
- Deactivated resources excluded from default queries
- Prevents new bookings from being created

#### Resource Images

**Add Images:** `POST /resources/:id/images`
- Request body: `{ imageUrls: string[] }` (array of S3 URLs)
- Prevents duplicate URLs (compares against existing `imageUrls`)
- Returns updated resource

**Remove Image:** `DELETE /resources/:id/images`
- Request body: `{ imageUrl: string }` (single URL to remove)
- Silently succeeds if URL not found
- Returns updated resource

#### Resource Availability Checking

**Endpoint:** `GET /resources/:id/availability?start=ISO_DATE&end=ISO_DATE`

**Behavior:**
1. Validates start/end dates provided and end > start
2. Validates resource exists and is active
3. Returns array of time slots for date range:
   - Iterates each day in range
   - Checks `availableDays` (if empty, all days available)
   - For available days, creates slot based on `availableTimeStart` and `availableTimeEnd`
   - Sets `available: true` for each slot (TODO: check against actual bookings)
4. Returns time slots in chronological order

**Response:**
```json
[
  {
    "start": "2024-06-15T08:00:00Z",
    "end": "2024-06-15T22:00:00Z",
    "available": true
  }
]
```

### Booking Lifecycle

#### Booking Creation

**Endpoint:** `POST /bookings`

**Authorization:** Any authenticated user (residents can book resources)

**Validation:**
- `resourceId` required, must exist and be active
- `startDate` required, must be valid Date, must be in future (via IsFutureDateConstraint)
- `endDate` required, must be valid Date, must be after startDate (via IsAfterConstraint)
- `notes` optional, free-text

**Flow:**
1. Fetch resource → verify exists, belongs to organization, is active
2. Validate availability → check for overlapping CONFIRMED bookings
3. Calculate total price:
   - If `pricePerHour` exists AND booking < 24 hours: use hourly pricing (ceil hours × pricePerHour)
   - Otherwise: use daily pricing (ceil days × pricePerDay)
4. Determine initial status:
   - If `resource.requiresApproval = true`: status = PENDING
   - Else: status = CONFIRMED
5. Create booking with:
   - `buildingId` from resource
   - `currency` from resource
   - `totalPrice` calculated
6. Send confirmation email (if status = CONFIRMED)
7. Create notification:
   - CONFIRMED: "Booking confirmed" notification
   - PENDING: "Booking pending approval" notification

**Pricing Example:**
- Guest apartment: pricePerDay = 500 NOK, pricePerHour = 70 NOK
- 2-hour booking: 2 × 70 = 140 NOK
- 25-hour booking: 2 days × 500 = 1000 NOK (not 26 hours × 70)

#### Booking Access Control

**GET /bookings (list)**
- Board/Admin: see all bookings in organization
- Residents: see only their own bookings via forced `userId` filter

**GET /bookings/:id (detail)**
- Owner or Board/Admin can view
- Non-owner residents get 403 Forbidden

**PATCH /bookings/:id (update)**
- Users can update `notes` field only
- Board can update both `notes` and `adminNotes`
- Access verification: owner or board

**POST /bookings/:id/approve**
- Board/Admin only
- Booking must be PENDING (400 if not)
- Changes status to CONFIRMED
- Sends approval email and notification

**POST /bookings/:id/reject**
- Board/Admin only
- Booking must be PENDING (400 if not)
- Changes status to CANCELLED with `cancellationReason`
- Sets `cancelledBy` and `cancelledAt`
- Sends rejection email and notification
- Optional reason in body: `{ reason?: string }`

#### Booking Cancellation

**Endpoint:** `POST /bookings/:id/cancel`

**Authorization:** Owner or Board/Admin

**Validation:**
- Booking cannot be CANCELLED already (400)
- Booking cannot be COMPLETED (400)

**Behavior:**
- Sets status to CANCELLED
- Sets `cancelledAt` = now
- Sets `cancelledBy` = current user
- Sets `cancellationReason` = provided reason (optional)
- Sends cancellation email to booking owner
- Creates notification for booking owner

#### Availability Checking

**Logic (checkAvailability method):**
1. Query for CONFIRMED bookings that overlap with requested date range:
   ```
   {
     resourceId: targetResource,
     status: CONFIRMED,
     $or: [
       { startDate < requestEnd, endDate > requestStart }
     ]
   }
   ```
2. If any overlapping booking found → NOT available (return false)
3. Else → available (return true)
4. Supports `excludeBookingId` to check availability for update scenarios (allows same booking to re-overlap itself)

**Note:** Only CONFIRMED bookings block availability. PENDING bookings do not reserve the slot (admin must approve).

#### Price Calculation

**Method: calculatePrice(resource, startDate, endDate)**

```
diffMs = endDate.getTime() - startDate.getTime()
diffHours = diffMs / (1000 * 60 * 60)
diffDays = ceil(diffMs / (1000 * 60 * 60 * 24))

if (pricePerHour AND diffHours < 24):
  return ceil(diffHours) * pricePerHour
else:
  return diffDays * pricePerDay
```

**Examples:**
- 2 hours, hourly rate: ceil(2) × rate = 2 × rate
- 1 hour 30 min, hourly rate: ceil(1.5) × rate = 2 × rate
- 24 hours, both rates: daily rate applies
- 1.5 days, no hourly rate: ceil(1.5) × daily = 2 × daily

#### Booking Expiration

**Background Job: completeExpiredBookings()**

Runs periodically (not yet scheduled):
- Finds all bookings with status in [CONFIRMED, PENDING] and endDate < now
- Updates status to COMPLETED
- Logs count of completed bookings

---

## Notifications & Side Effects

### Booking Confirmation Email

Sent when booking is created with CONFIRMED status or when PENDING booking is approved.

**Recipients:** Booking user's email

**Content:**
- User name
- Resource name
- Start/end times
- Booking ID for reference

**Triggered by:**
- `emailService.sendBookingConfirmation(emailUser, bookingData)`

**Non-blocking:** Logged as error if fails, does not prevent booking creation

### Booking Rejection Email

Sent when PENDING booking is rejected by admin.

**Recipients:** Booking user's email

**Content:**
- User name
- Resource name
- Start/end times
- Rejection reason (if provided)

**Triggered by:**
- `emailService.sendBookingCancellation(emailUser, bookingData)`

### Booking Cancellation Email

Sent when confirmed booking is cancelled.

**Recipients:** Booking user's email

**Content:**
- User name
- Resource name
- Start/end times
- Cancellation reason (if provided)

### Notifications (In-App)

**BOOKING_CONFIRMED notification created:**
- Type: `BOOKING_CONFIRMED`
- Title: "Booking confirmed" or "Booking approved"
- Message: Describes booking resource and status
- Link: `/bookings/{bookingId}`
- Sent: On creation (CONFIRMED status) or approval (PENDING → CONFIRMED)

**BOOKING_CANCELLED notification created:**
- Type: `BOOKING_CANCELLED`
- Title: "Booking rejected" or "Booking cancelled"
- Message: Describes cancellation with optional reason
- Link: `/bookings/{bookingId}`
- Sent: On rejection or cancellation

---

## Frontend

### Hooks (fe_grunnsteinen/src/hooks/api/useResources.ts)

#### Resources Queries

**useResources(params: ResourceQueryParams)**
- Query hook for paginated resources list
- Returns: `{ data: { data: Resource[], total, page, limit }, isLoading, error }`
- Params: page, limit, sortBy, sortOrder, type, isActive, buildingId
- Query key: `queryKeys.resources.list(params)`

**useResource(resourceId: string)**
- Query hook for single resource details
- Returns: `{ data: Resource, isLoading, error }`
- Query key: `queryKeys.resources.detail(resourceId)`
- Disabled if no resourceId

**useResourceAvailability(resourceId: string, startDate: Date, endDate: Date)**
- Query hook for time slot availability
- Returns: `{ data: TimeSlot[], isLoading, error }`
- Query key: `queryKeys.resources.availability(resourceId, dates)`

#### Resources Mutations

**useCreateResource()**
- Mutation hook to create resource
- Input: CreateResourceDto data
- Returns: mutate, mutateAsync, isLoading, error
- On success: invalidates `queryKeys.resources.all`

**useUpdateResource()**
- Mutation hook to update resource
- Input: `{ resourceId: string, data: UpdateResourceDto }`
- Returns: mutate, mutateAsync, isLoading, error
- On success: invalidates detail + all

**useDeactivateResource()**
- Mutation hook to deactivate resource
- Input: resourceId
- Returns: mutate, mutateAsync, isLoading, error
- On success: invalidates detail + all

**useAddResourceImages()**
- Mutation hook to add images
- Input: `{ resourceId: string, imageUrls: string[] }`
- Returns: mutate, mutateAsync, isLoading, error
- On success: invalidates detail

**useRemoveResourceImage()**
- Mutation hook to remove image
- Input: `{ resourceId: string, imageUrl: string }`
- Returns: mutate, mutateAsync, isLoading, error
- On success: invalidates detail

---

### Hooks (fe_grunnsteinen/src/hooks/api/useBookings.ts)

#### Bookings Queries

**useBookings(params: BookingQueryParams)**
- Query hook for paginated bookings (with role-based filtering)
- Returns: `{ data: { data: Booking[], total, page, limit }, isLoading, error }`
- Params: page, limit, sortBy, sortOrder, resourceId, status, startDateFrom, startDateTo
- Query key: `queryKeys.bookings.list(params)`

**useMyBookings(params?: BookingQueryParams)**
- Query hook for current user's bookings only
- Returns: `{ data: { data: Booking[], total, page, limit }, isLoading, error }`
- Query key: `queryKeys.bookings.myList(params)`

**useBooking(bookingId: string)**
- Query hook for single booking details
- Returns: `{ data: Booking, isLoading, error }`
- Query key: `queryKeys.bookings.detail(bookingId)`
- Disabled if no bookingId

#### Bookings Mutations

**useCreateBooking()**
- Mutation hook to create booking
- Input: CreateBookingDto (resourceId, startDate, endDate, notes)
- Returns: mutate, mutateAsync, isLoading, error
- On success: invalidates `queryKeys.bookings.all` and availability

**useUpdateBooking()**
- Mutation hook to update booking (notes/adminNotes)
- Input: `{ bookingId: string, data: UpdateBookingDto }`
- Returns: mutate, mutateAsync, isLoading, error
- On success: invalidates detail + list

**useApproveBooking()**
- Mutation hook to approve PENDING booking
- Input: bookingId
- Returns: mutate, mutateAsync, isLoading, error
- On success: invalidates detail + list
- Board/Admin only

**useRejectBooking()**
- Mutation hook to reject PENDING booking
- Input: `{ bookingId: string, reason?: string }`
- Returns: mutate, mutateAsync, isLoading, error
- On success: invalidates detail + list
- Board/Admin only

**useCancelBooking()**
- Mutation hook to cancel booking
- Input: `{ bookingId: string, reason?: string }`
- Returns: mutate, mutateAsync, isLoading, error
- On success: invalidates detail + list
- Owner or Board/Admin

---

### Booking Flow Pages

#### `/resources` (Resources Listing)

List all available resources for browsing and booking.

**Features:**
- Paginated resource cards/grid
- Filter by type (guest-apartment, common-area, parking, equipment)
- Filter by building
- Search by name
- Show: image, name, price (daily + hourly if available), rules summary
- Click resource → detail page

#### `/resources/[id]` (Resource Detail)

Single resource with availability calendar and booking form.

**Features:**
- Large image gallery
- Resource details: name, type, description, pricing, rules
- Availability calendar: date picker with availability check
- Booking form:
  - Start date/time picker
  - End date/time picker
  - Price preview (calculated dynamically)
  - Notes textarea
  - "Book now" button
- Show `requiresApproval` flag: "This booking requires approval"
- Related resources (same type, same building)

#### `/bookings` (My Bookings)

Current user's booking history.

**Features:**
- Tabs: All, Upcoming, Past
- Booking cards showing:
  - Resource name + image
  - Start/end dates
  - Status badge (PENDING, CONFIRMED, CANCELLED, COMPLETED)
  - Total price
  - Action buttons (cancel if cancellable, view details)
- Empty state if no bookings
- Sort by start date (newest first)

#### `/admin/bookings` (Admin Bookings Management)

Admin view of all organization bookings.

**Features:**
- Paginated table/list of all bookings
- Filter by status (PENDING, CONFIRMED, CANCELLED, COMPLETED)
- Filter by resource
- Filter by user
- Filter by date range
- Booking cards with:
  - Resource + user info
  - Dates, status, total price
  - Action buttons:
    - If PENDING: Approve / Reject buttons
    - If any status: View details, Cancel
  - Admin notes field

---

### Type Definitions

All types in `fe_grunnsteinen/src/types/index.ts`:

```typescript
interface Resource {
  id: string;
  organizationId: string;
  buildingId?: string;
  isOrganizationWide: boolean;
  name: string;
  type: 'guest-apartment' | 'common-area' | 'parking' | 'equipment';
  description?: string;
  imageUrls: string[];
  pricePerDay: number;
  pricePerHour?: number;
  currency: string;
  rules?: string;
  minBookingHours?: number;
  maxBookingDays?: number;
  requiresApproval: boolean;
  isActive: boolean;
  availableDays: number[];
  availableTimeStart: string;  // HH:MM
  availableTimeEnd: string;    // HH:MM
  createdAt?: Date;
  updatedAt?: Date;
}

interface TimeSlot {
  start: Date;
  end: Date;
  available: boolean;
}

interface Booking {
  id: string;
  organizationId: string;
  resourceId: string | { id: string; name: string; type: string };
  buildingId?: string;
  userId: string | { id: string; name: string; email: string; avatarUrl?: string };
  startDate: Date;
  endDate: Date;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  totalPrice: number;
  currency: string;
  notes?: string;
  adminNotes?: string;
  cancelledAt?: Date;
  cancelledBy?: { id: string; name: string };
  cancellationReason?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

type ResourceQueryParams = {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  type?: string;
  isActive?: boolean;
  buildingId?: string;
}

type BookingQueryParams = {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  resourceId?: string;
  status?: string;
  startDateFrom?: Date;
  startDateTo?: Date;
  userId?: string;  // board only
}

interface CreateResourceInput {
  buildingId: string;
  name: string;
  type: string;
  description?: string;
  pricePerDay: number;
  pricePerHour?: number;
  rules?: string;
  minBookingHours?: number;
  maxBookingDays?: number;
  requiresApproval?: boolean;
}

interface UpdateResourceInput extends Partial<CreateResourceInput> {
  isActive?: boolean;
  currency?: string;
  availableDays?: number[];
  availableTimeStart?: string;
  availableTimeEnd?: string;
}

interface CreateBookingInput {
  resourceId: string;
  startDate: Date;
  endDate: Date;
  notes?: string;
}

interface UpdateBookingInput {
  notes?: string;
  adminNotes?: string;  // board only
}
```

### Query Keys

Located in `fe_grunnsteinen/src/lib/api/queryKeys.ts`:

```typescript
resources: {
  all: [...]
  list: (params) => [...]
  detail: (id) => [...]
  availability: (id, dates) => [...]
}

bookings: {
  all: [...]
  list: (params) => [...]
  myList: (params) => [...]
  detail: (id) => [...]
}
```

### API Endpoints

Located in `fe_grunnsteinen/src/lib/api/endpoints.ts`:

```typescript
API_ENDPOINTS.RESOURCES = {
  LIST: '/resources',
  CREATE: '/resources',
  BY_ID: (id) => `/resources/${id}`,
  AVAILABILITY: (id) => `/resources/${id}/availability`,
  UPDATE: (id) => `/resources/${id}`,
  ADD_IMAGES: (id) => `/resources/${id}/images`,
  REMOVE_IMAGE: (id) => `/resources/${id}/images`,
  DEACTIVATE: (id) => `/resources/${id}`,
}

API_ENDPOINTS.BOOKINGS = {
  LIST: '/bookings',
  CREATE: '/bookings',
  MY: '/bookings/my',
  BY_ID: (id) => `/bookings/${id}`,
  UPDATE: (id) => `/bookings/${id}`,
  APPROVE: (id) => `/bookings/${id}/approve`,
  REJECT: (id) => `/bookings/${id}/reject`,
  CANCEL: (id) => `/bookings/${id}/cancel`,
}
```

---

## DTO Validation Rules

### Resources

**CreateResourceDto**

| Field | Type | Required | Rules |
|-------|------|----------|-------|
| `buildingId` | string | Yes | Valid MongoDB ID |
| `name` | string | Yes | String |
| `type` | enum | Yes | GUEST_APARTMENT, COMMON_AREA, PARKING, EQUIPMENT |
| `description` | string | No | String |
| `pricePerDay` | number | Yes | >= 0 |
| `pricePerHour` | number | No | >= 0 |
| `rules` | string | No | String |
| `minBookingHours` | number | No | >= 0 |
| `maxBookingDays` | number | No | >= 0 |
| `requiresApproval` | boolean | No | Default false |

**UpdateResourceDto:** All fields optional, same validation rules

**ResourceQueryDto:** Extends pagination + optional type, isActive, buildingId

### Bookings

**CreateBookingDto**

| Field | Type | Required | Rules |
|-------|------|----------|-------|
| `resourceId` | string | Yes | Valid MongoDB ID |
| `startDate` | Date | Yes | Valid Date, must be future |
| `endDate` | Date | Yes | Valid Date, after startDate |
| `notes` | string | No | String |

**UpdateBookingDto**

| Field | Type | Rules |
|-------|------|-------|
| `notes` | string | Optional, user-visible |
| `adminNotes` | string | Optional, board only |

**BookingQueryDto:** Extends pagination + optional resourceId, status, startDateFrom, startDateTo, userId

---

## Key File Paths

### Backend

| Role | Path |
|------|------|
| **Resources Controller** | `be_grunnsteinen/src/modules/resources/resources.controller.ts` |
| **Resources Service** | `be_grunnsteinen/src/modules/resources/resources.service.ts` |
| **Resources Schema** | `be_grunnsteinen/src/modules/resources/schemas/resource.schema.ts` |
| **Resources Module** | `be_grunnsteinen/src/modules/resources/resources.module.ts` |
| **Resources DTOs** | `be_grunnsteinen/src/modules/resources/dto/` |
| DTO: Create | `be_grunnsteinen/src/modules/resources/dto/create-resource.dto.ts` |
| DTO: Update | `be_grunnsteinen/src/modules/resources/dto/update-resource.dto.ts` |
| DTO: Query | `be_grunnsteinen/src/modules/resources/dto/resource-query.dto.ts` |
| **Bookings Controller** | `be_grunnsteinen/src/modules/bookings/bookings.controller.ts` |
| **Bookings Service** | `be_grunnsteinen/src/modules/bookings/bookings.service.ts` |
| **Bookings Schema** | `be_grunnsteinen/src/modules/bookings/schemas/booking.schema.ts` |
| **Bookings Module** | `be_grunnsteinen/src/modules/bookings/bookings.module.ts` |
| **Bookings DTOs** | `be_grunnsteinen/src/modules/bookings/dto/` |
| DTO: Create | `be_grunnsteinen/src/modules/bookings/dto/create-booking.dto.ts` |
| DTO: Update | `be_grunnsteinen/src/modules/bookings/dto/update-booking.dto.ts` |
| DTO: Cancel | `be_grunnsteinen/src/modules/bookings/dto/cancel-booking.dto.ts` |
| DTO: Query | `be_grunnsteinen/src/modules/bookings/dto/booking-query.dto.ts` |

### Frontend

| Role | Path |
|------|------|
| **Resources Hooks** | `fe_grunnsteinen/src/hooks/api/useResources.ts` |
| **Bookings Hooks** | `fe_grunnsteinen/src/hooks/api/useBookings.ts` |
| **Types** | `fe_grunnsteinen/src/types/index.ts` (Resource, Booking, TimeSlot sections) |
| **API Endpoints** | `fe_grunnsteinen/src/lib/api/endpoints.ts` (API_ENDPOINTS.RESOURCES, API_ENDPOINTS.BOOKINGS) |
| **Query Keys** | `fe_grunnsteinen/src/lib/api/queryKeys.ts` (queryKeys.resources, queryKeys.bookings) |

---

## Common Patterns

### Fetch and display resources

```typescript
const { data, isLoading } = useResources({
  type: 'guest-apartment',
  buildingId: buildingId,
  limit: 12
});

if (isLoading) return <Skeleton />;
if (!data?.data.length) return <EmptyResources />;

return data.data.map(resource => (
  <ResourceCard key={resource.id} resource={resource} />
));
```

### Check availability and create booking

```typescript
const { data: slots } = useResourceAvailability(
  resourceId,
  selectedStartDate,
  selectedEndDate
);

const createBooking = useCreateBooking();

const handleBook = async () => {
  if (!slots || slots.some(s => !s.available)) {
    toast.error('Selected dates not available');
    return;
  }

  try {
    const booking = await createBooking.mutateAsync({
      resourceId,
      startDate: selectedStartDate,
      endDate: selectedEndDate,
      notes: userNotes
    });
    toast.success('Booking created!');
    router.push(`/bookings/${booking.id}`);
  } catch (error) {
    toast.error(handleApiError(error));
  }
};
```

### Manage bookings as admin

```typescript
const approveBooking = useApproveBooking();
const rejectBooking = useRejectBooking();

const handleApprove = async (bookingId: string) => {
  try {
    await approveBooking.mutateAsync(bookingId);
    toast.success('Booking approved');
  } catch (error) {
    toast.error(handleApiError(error));
  }
};

const handleReject = async (bookingId: string, reason: string) => {
  try {
    await rejectBooking.mutateAsync({ bookingId, reason });
    toast.success('Booking rejected');
  } catch (error) {
    toast.error(handleApiError(error));
  }
};
```

### Cancel own booking

```typescript
const cancelBooking = useCancelBooking();

const handleCancel = async (bookingId: string) => {
  if (!confirm('Are you sure?')) return;

  try {
    await cancelBooking.mutateAsync({
      bookingId,
      reason: 'User cancelled'
    });
    toast.success('Booking cancelled');
  } catch (error) {
    toast.error(handleApiError(error));
  }
};
```
