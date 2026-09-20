---
paths:
  - "be_grunnsteinen/src/modules/invitations/**"
  - "fe_grunnsteinen/src/hooks/api/useInvitations.ts"
---

# Invitations

## Overview

The Invitations module manages building resident sign-up invitations and integrates with the TenantProfile system for apartment tracking. Admins create and send 7-day-expiry invitation tokens via email to invite new residents to join their building. Invitations link to buildings and optionally to apartments (for pre-assignment). Upon registration with a valid invitation token, users are automatically added to the apartment and their TenantProfile is marked as registered.

---

## Data Model

### Invitation Schema

**Collection:** `invitations`

```typescript
{
  // Email & Contact
  email                   → string, required, lowercase, trimmed, indexed
                            invite recipient's email address

  // Organization & Building Scope
  organizationId          → ObjectId, required, indexed (→ organizations)
  buildingId              → ObjectId, required, indexed (→ buildings)
                            building this user is invited to join

  // Apartment Reference (optional)
  apartmentId?            → ObjectId (→ apartments)
                            if admin specifies an apartment, user joins it on registration
  unitNumber?             → string (apartment unit number, informational)

  // Tenant Info (optional, provided by admin)
  firstName?              → string, optional, trimmed
  lastName?               → string, optional, trimmed
  phone?                  → string, optional, trimmed

  // Token & Expiry
  token                   → string, required, unique, indexed
                            cryptographic random 32-byte hex token
                            sent in email link: /register?invite={token}
  expiresAt               → Date, required, indexed
                            set to now + 7 days on creation
                            checked during validation; if expired, status = EXPIRED

  // Status
  status                  → InvitationStatus enum, indexed, default: PENDING
                            PENDING: not yet accepted
                            ACCEPTED: user registered with this token
                            EXPIRED: 7 days passed without acceptance

  // Audit
  createdBy               → ObjectId, required (→ users)
                            admin who created the invitation

  // Base
  createdAt               → Date (auto-set)
  updatedAt               → Date (auto-updated)
}
```

### InvitationStatus Enum

```typescript
enum InvitationStatus {
  PENDING = 'pending'       // Invitation sent, awaiting registration
  ACCEPTED = 'accepted'     // User registered with this token
  EXPIRED = 'expired'       // 7 days passed without acceptance
}
```

### Indexes

```
token (unique)            # Prevent duplicate tokens
email + buildingId + status (compound) # Prevent duplicate pending invites
organizationId + buildingId + createdAt DESC (compound) # List invites by building
expiresAt + status (compound) # Background job: find expired pending invites
```

---

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/invitations` | JWT + ADMIN/BOARD | Create invitation, send email |
| GET | `/invitations` | JWT + ADMIN/BOARD | List pending invitations for a building |
| GET | `/invitations/validate/:token` | Public | Validate invite token (pre-registration check) |

**Internal (not exposed to frontend):**
| Method | Endpoint | Internal | Description |
|--------|----------|----------|-------------|
| — | `invitationsService.markAccepted(token)` | Auth service | Mark invitation as accepted during registration |

---

## Business Rules & Logic

### Create Invitation

**Endpoint:** `POST /invitations`

**Authorization:** ADMIN or BOARD role required

**Request body:**
```json
{
  "email": "jane@example.com",
  "buildingId": "507f1f77bcf86cd799439011",
  "apartmentId": "507f1f77bcf86cd799439012",
  "unitNumber": "301",
  "firstName": "Jane",
  "lastName": "Doe",
  "phone": "+4798765432"
}
```

**Validation:**
- `email`: required, valid email format, lowercase + trimmed
- `buildingId`: required, valid MongoDB ObjectId, must exist in org
- `apartmentId`: optional, valid MongoDB ObjectId if provided, must exist in building
- `unitNumber`: optional, string
- `firstName`, `lastName`, `phone`: optional, strings

**Pre-checks (throwing errors):**
1. Building exists and belongs to user's organization (404 if not)
2. Email not already registered in organization (409 ConflictException)
3. No pending, non-expired invitation for same email + building (409 ConflictException)
4. If apartmentId provided: apartment exists and belongs to building (404 if not)

**Token Generation:**
- 32 random bytes → hex string (64 characters)
- Cryptographically secure via Node's `crypto.randomBytes()`
- Guaranteed unique (checked at DB level via unique index)
- Sent plain in email link; never stored plain in DB

**Expiration:**
- Set to `now + 7 days` (604,800 seconds)
- Not automatically deleted; status marked EXPIRED on validation attempt
- TTL cleanup could be added as background job (future enhancement)

**Email Sent (async, non-blocking):**
- Recipient: invitation.email
- Subject: "You're invited to join {buildingName}"
- Body: Link to registration page with token
- Template: `emailService.sendInviteEmail(email, orgName, buildingName, inviteLink)`
- Failure logged as warning; doesn't prevent invitation creation

**Response:**
```json
{
  "id": "507f1f77bcf86cd799439013",
  "email": "jane@example.com",
  "buildingId": "507f1f77bcf86cd799439011",
  "organizationId": "507f1f77bcf86cd799439010",
  "apartmentId": "507f1f77bcf86cd799439012",
  "unitNumber": "301",
  "firstName": "Jane",
  "lastName": "Doe",
  "phone": "+4798765432",
  "token": "a1b2c3d4...f8g9h0i1j2k3l4m5n6o7p8q9r0s1t2u3v4w5x6y7z8",
  "expiresAt": "2024-03-18T10:30:00Z",
  "status": "pending",
  "createdBy": "507f1f77bcf86cd799439014",
  "createdAt": "2024-03-11T10:30:00Z",
  "updatedAt": "2024-03-11T10:30:00Z"
}
```

### List Invitations by Building

**Endpoint:** `GET /invitations?buildingId={buildingId}`

**Authorization:** ADMIN or BOARD role required

**Query parameters:**
- `buildingId`: required, building to list invitations for

**Behavior:**
1. If no buildingId provided: return empty array (prevent listing all invitations)
2. Filter: organization scope, building ID, pending status only, not expired
3. Sort: by createdAt descending (newest first)
4. Return array of invitation documents

**Response:**
```json
[
  {
    "id": "507f1f77bcf86cd799439013",
    "email": "jane@example.com",
    "buildingId": "507f1f77bcf86cd799439011",
    "organizationId": "507f1f77bcf86cd799439010",
    "apartmentId": "507f1f77bcf86cd799439012",
    "unitNumber": "301",
    "firstName": "Jane",
    "lastName": "Doe",
    "phone": "+4798765432",
    "expiresAt": "2024-03-18T10:30:00Z",
    "status": "pending",
    "createdBy": "507f1f77bcf86cd799439014",
    "createdAt": "2024-03-11T10:30:00Z"
  }
]
```

**Use case:** Admin UI displays pending invitations in building management tab

### Validate Invitation Token (Pre-Registration)

**Endpoint:** `GET /invitations/validate/:token`

**Authorization:** Public (no JWT required)

**Parameters:**
- `token`: 64-character hex token from email link

**Behavior:**
1. Look up invitation by token
2. If not found: throw BadRequestException("Invalid or expired invitation")
3. If status ≠ PENDING: throw BadRequestException("This invitation has already been used")
4. If `expiresAt < now`:
   - Update status to EXPIRED (marks stale invitations)
   - Throw BadRequestException("This invitation has expired")
5. Fetch organization and building details
6. Return validation result with pre-filled registration form data

**Response:**
```json
{
  "invitationId": "507f1f77bcf86cd799439013",
  "organizationId": "507f1f77bcf86cd799439010",
  "organizationName": "Blokkens Borettslag",
  "buildingId": "507f1f77bcf86cd799439011",
  "buildingName": "Leilighet A",
  "email": "jane@example.com",
  "unitNumber": "301",
  "apartmentId": "507f1f77bcf86cd799439012",
  "firstName": "Jane",
  "lastName": "Doe",
  "phone": "+4798765432"
}
```

**Use case (frontend):**
- Validate token when user opens `/register?invite={token}`
- Pre-fill form with email, firstName, lastName, phone, unitNumber
- Show building/org context
- If invalid/expired: show error message, allow self-service registration instead

### Mark Accepted (Internal)

**Method:** `invitationsService.markAccepted(token: string)`

**Called by:** `auth.service.ts` during user registration with valid invitation token

**Behavior:**
1. Update invitation status from PENDING → ACCEPTED
2. Log if no invitation found (shouldn't happen, but safeguard against concurrent edge case)
3. No error thrown; treats as success even if invitationId mismatches

**Called from:**
```typescript
// In auth.service.ts register() method
if (invitationToken) {
  // ... validate and process invitation ...
  // After user created + added to apartment
  await this.invitationsService.markAccepted(invitationToken);
}
```

---

## Integration with TenantProfile

The Invitations module works in conjunction with TenantProfile for tracking apartment occupancy.

### Workflow: TenantProfile → Invitation → User Registration

**Step 1: Admin creates TenantProfile**
```
POST /tenant-profiles
Request: { firstName, lastName, email?, phone?, apartmentId }
Result: TenantProfile created with status='unregistered'
```

**Step 2: Admin sends invitation from TenantProfile**
```
POST /tenant-profiles/:id/invite
Backend:
  - Validates TenantProfile has email
  - Creates Invitation with fields from TenantProfile
  - Updates TenantProfile.status = 'invited'
  - Stores invitationId reference
  - Sends email with token
```

**Step 3: Tenant registers using token**
```
POST /auth/register
Request: { email, password, name, inviteToken }
Backend:
  - Validates invitation token
  - Creates User
  - Adds User to apartment.tenantIds
  - Calls invitationsService.markAccepted(token)
  - Calls tenantProfilesService.markRegistered(invitationId, userId)
  - Updates TenantProfile.status = 'registered', TenantProfile.userId = userId
```

**Key invariant:** `invitations.markAccepted()` and `tenantProfiles.markRegistered()` happen in same registration flow, keeping status in sync

### Alternative Workflow: Direct Invitation (no TenantProfile)

Admin can also invite users directly without creating a TenantProfile first:

```
POST /invitations
Request: { email, buildingId, apartmentId, firstName?, lastName?, phone? }
Result: Invitation created directly
        No TenantProfile created
        Email sent to user

When user registers with token:
  - User created
  - Added to apartment.tenantIds
  - No TenantProfile to update (it was never created)
```

This allows both workflows:
1. **TenantProfile workflow:** Admin pre-enters tenant info, then invites
2. **Direct invitation workflow:** Admin invites, tenant fills in their own details during registration

---

## Email & Notifications

### Invitation Email

Sent by `emailService.sendInviteEmail()`

**Recipient:** invitation.email

**Template variables:**
- `organizationName`: from Organization document
- `buildingName`: from Building document
- `inviteLink`: `{FRONTEND_URL}/register?invite={token}`

**Content:**
- Subject: "You're invited to join {buildingName}"
- Body: Greeting with building/org context + link to registration page
- Link text: "Join now" or similar CTA
- Footer: Token expiry info ("This link expires in 7 days")

**Failure handling:**
- Caught in try-catch block
- Logged as error warning: "Failed to send invite email to {email}"
- Doesn't prevent invitation creation; user can retrieve link later

### No In-App Notifications

Invitations are email-only delivery. No in-app notification created (not in NotificationType enum).

---

## Frontend

### Hooks

**Not exposed as hooks to frontend.** Invitations are consumed via:
1. Pre-registration validation (public endpoint during signup)
2. Admin creation in building management UI

### Admin UI

**Building management → Invitations tab** (assumed to exist)

**Features:**
- List pending invitations for building
- Show: email, unitNumber, firstName/lastName, expiresAt, createdBy
- Create invitation button → CreateInvitationDialog
- Delete invitation (optional, to reject pending invitations)
- Resend email button (optional, to resend token if recipient claims no email)

**CreateInvitationDialog form:**
- Email (required, validated format)
- Apartment selector (optional)
- Unit number (auto-filled from apartment if selected)
- First name, last name, phone (optional)
- Send button → `apiClient.post(API_ENDPOINTS.INVITATIONS)`
- Success: show success toast, refresh invitations list

### Registration Flow

**`/register` page:**

1. User clicks invite link → `/register?invite={token}`
2. On mount: call `GET /invitations/validate/:token`
3. If valid: show validation result
   - Pre-fill form fields (email, firstName, lastName, phone, unitNumber)
   - Display building/org context
   - Show password requirements
   - CTA: "Create account" or "Register"
4. If invalid/expired: show error
   - Option to self-register with org code instead (fallback)
5. User submits registration form
   - `POST /auth/register` with `inviteToken: token` in request body
   - Backend validates token + creates user + marks invitation accepted

**Frontend form fields:**
```typescript
interface RegisterData {
  email: string;                  // pre-filled from invitation
  password: string;               // user enters
  name: string;                   // user enters
  phone?: string;                 // pre-filled from invitation
  organizationCode?: string;      // NOT used if inviteToken provided
  inviteToken?: string;           // auto-filled from URL params
  unitNumber?: string;            // pre-filled from invitation
}
```

### Types

Located in `fe_grunnsteinen/src/types/index.ts`

```typescript
type InvitationStatus = 'pending' | 'accepted' | 'expired';

interface Invitation {
  id: string;
  email: string;
  buildingId: string;
  organizationId: string;
  apartmentId?: string;
  unitNumber?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  token: string;  // should NOT be exposed to frontend
  expiresAt: Date;
  status: InvitationStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ValidateInvitationResult {
  invitationId: string;
  organizationId: string;
  organizationName: string;
  buildingId: string;
  buildingName: string;
  email: string;
  unitNumber?: string;
  apartmentId?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}
```

### API Endpoints

Located in `fe_grunnsteinen/src/lib/api/endpoints.ts`

```typescript
API_ENDPOINTS.INVITATIONS = {
  CREATE: '/invitations',
  LIST: '/invitations',           // with ?buildingId=
  VALIDATE: (token: string) => `/invitations/validate/${token}`,
}
```

---

## DTO Validation Rules

### CreateInvitationDto

| Field | Type | Required | Rules |
|-------|------|----------|-------|
| `email` | string | Yes | Valid email format, lowercase |
| `buildingId` | string | Yes | Valid MongoDB ObjectId |
| `apartmentId` | string | No | Valid MongoDB ObjectId if provided |
| `unitNumber` | string | No | String (informational only) |
| `firstName` | string | No | String |
| `lastName` | string | No | String |
| `phone` | string | No | String (any format) |

**Transformations:**
- `email`: lowercase + trimmed
- `unitNumber`, `firstName`, `lastName`, `phone`: trimmed

### Response DTO

Same fields as stored schema (includes token for admin UI display).

---

## Key File Paths

| Role | Path |
|------|------|
| BE Schema | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/invitations/schemas/invitation.schema.ts` |
| BE Service | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/invitations/invitations.service.ts` |
| BE Controller | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/invitations/invitations.controller.ts` |
| BE Module | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/invitations/invitations.module.ts` |
| BE DTO | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/invitations/dto/create-invitation.dto.ts` |
| Auth integration | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/auth/auth.service.ts` (register method calls invitations.validate + markAccepted) |
| TenantProfile integration | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/tenant-profiles/tenant-profiles.service.ts` (invite endpoint) |

---

## Common Patterns

### Admin creates and sends invitation

```typescript
// Backend
const createInvitation = async (formData: CreateInvitationDto) => {
  return apiClient.post(API_ENDPOINTS.INVITATIONS.CREATE, formData);
};

// Frontend
const { mutate, isPending } = useMutation({
  mutationFn: createInvitation,
  onSuccess: () => {
    toast.success('Invitasjon sendt!');
    // Refresh invitations list
    queryClient.invalidateQueries({ queryKey: queryKeys.invitations.list });
    // Close dialog
    onOpenChange?.(false);
  },
  onError: (error) => {
    if (error.statusCode === 409) {
      toast.error('En invitasjon for denne e-postadressen og bygget finnes allerede');
    } else {
      toast.error(handleApiError(error));
    }
  }
});

const handleSubmit = () => {
  mutate(formData);
};
```

### User registers with invitation token

```typescript
// Frontend: /register?invite=TOKEN
useEffect(() => {
  const token = searchParams.get('invite');
  if (token) {
    // Validate token
    apiClient
      .get<ValidateInvitationResult>(API_ENDPOINTS.INVITATIONS.VALIDATE(token))
      .then(result => {
        // Pre-fill form
        setFormData(prev => ({
          ...prev,
          email: result.email,
          firstName: result.firstName,
          lastName: result.lastName,
          phone: result.phone,
          unitNumber: result.unitNumber,
          inviteToken: token
        }));
        setValidationResult(result);
      })
      .catch(error => {
        toast.error('Invitasjonen er invalid eller utløpt');
        setShowOrgCodeField(true); // Allow self-service registration fallback
      });
  }
}, [token]);

// On form submit
const handleRegister = async () => {
  try {
    const response = await authStore.register({
      ...formData,
      inviteToken: token,
      organizationCode: undefined  // Don't use if inviteToken provided
    });
    toast.success('Konto opprettet!');
    router.push('/');
  } catch (error) {
    toast.error(handleApiError(error));
  }
};
```

---

## Error Handling

**Duplicate email in organization:**
- Status: 409 Conflict
- Message: "A user with this email is already in the organization"
- Frontend: Show error, suggest different email

**Duplicate pending invitation:**
- Status: 409 Conflict
- Message: "A pending invitation for this email and building already exists"
- Frontend: Show error, suggest user check email or ask admin to resend

**Building not found:**
- Status: 404 Not Found
- Message: "Building with ID ... not found"
- Frontend: Generic error, shouldn't happen in normal UI flow

**Invalid/expired token (during validation):**
- Status: 400 Bad Request
- Message: "Invalid or expired invitation" or "This invitation has expired"
- Frontend: Show error, offer fallback org code registration

**Email send failure:**
- Logged but doesn't fail invitation creation
- Frontend: Invitation created successfully; email sent separately (may be delayed or require resend)

---

## Expiration & Cleanup

**7-day expiration:**
- Set at invitation creation: `expiresAt = now + 7 days`
- Checked during validation; if past expiry, status set to EXPIRED
- No automatic background cleanup yet; expired invitations remain in DB indefinitely

**Future enhancement (not yet implemented):**
- Background job: periodically find pending invitations where `expiresAt < now` and set `status = EXPIRED`
- Or: TTL index to auto-delete after 7 days (but would lose audit trail)

---

## Security Considerations

**Token generation:**
- Cryptographically secure random bytes via `crypto.randomBytes(32)`
- Token is 64-character hex string (256 bits of entropy)
- Unique constraint at DB level prevents collisions

**Token transmission:**
- Sent plain in email link (necessary for email-based invitation)
- Could be intercepted in email but requires email access
- Expiry limits window of vulnerability
- No persistent login session created by token alone; user must set password during registration

**Email validation:**
- Invitation email must match registration email (checked in auth.service)
- Prevents someone else from registering with another person's invitation token

**One-time use:**
- Token can only be used for registration once
- Status changed to ACCEPTED after first use
- Subsequent attempts with same token fail with "already been used"

**No token leakage in responses:**
- Token NOT returned to frontend in list invitations response (removed from DTO)
- Only the validation endpoint returns invitation data (for pre-registration)
- Admin sees token only in initial creation response or via email resend (future feature)
