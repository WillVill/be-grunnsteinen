---
paths:
  - "be_grunnsteinen/src/modules/auth/**"
  - "fe_grunnsteinen/src/store/authStore.ts"
  - "fe_grunnsteinen/src/lib/api/client.ts"
  - "fe_grunnsteinen/src/lib/api/tokenManager.ts"
  - "fe_grunnsteinen/src/app/login/**"
  - "fe_grunnsteinen/src/app/register/**"
  - "fe_grunnsteinen/src/app/forgot-password/**"
  - "fe_grunnsteinen/src/app/reset-password/**"
  - "fe_grunnsteinen/src/components/auth/**"
---

# Authentication & Authorization

## Overview

Authentication uses a dual JWT token system (access + refresh) with Passport.js strategies for validation. Users authenticate via email/password, and tokens are stored client-side in localStorage with proactive refresh 5 minutes before expiry. Authorization is managed via role-based access control (SUPER_ADMIN > ADMIN > BOARD > RESIDENT).

## Data Model

### User Schema (relevant auth fields)

```
email                   — unique, lowercase, required
password                — bcrypted, select:false (excluded by default)
passwordResetToken      — SHA256-hashed, select:false
passwordResetExpires    — expiry timestamp for reset token, select:false
isActive                — boolean (account can be deactivated)
lastLoginAt             — timestamp updated on each login
role                    — RESIDENT | BOARD | ADMIN | SUPER_ADMIN
organizationId          — required reference
buildingIds             — array of building references
primaryBuildingId       — current building context
```

### TokenPayload Interface

```
sub                     — user ID (subject)
email                   — user email
role                    — user role
organizationId          — organization scope
buildingIds             — accessible buildings
primaryBuildingId       — optional, current building
```

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/register` | Public | Register new user (org code or invite token required) |
| POST | `/auth/login` | Public | Login with email/password |
| POST | `/auth/refresh` | Public | Refresh access token using refresh token |
| POST | `/auth/forgot-password` | Public | Request password reset email (always returns success) |
| POST | `/auth/reset-password` | Public | Reset password with token from email |
| POST | `/auth/change-password` | JWT | Change password for authenticated user |
| POST | `/auth/logout` | JWT | Logout (optional server-side invalidation) |

## Business Rules & Logic

### Registration Flow

**Three entry paths:**

1. **Organization Code Path** (standard self-service)
   - User provides active organization code
   - Validates organization exists and is active
   - No building auto-assigned (user is organization-wide)

2. **Invitation Token Path** (from TenantProfile)
   - Invitation token provided in request
   - Validates token and extracts building/organization
   - Validates email matches invitation
   - Auto-assigns to apartment via `tenantIds`
   - Calls `tenantProfilesService.markRegistered()` to update TenantProfile status

3. **Both fields present?** Invitation takes priority

**Registration Flow:**

```
User provides email + password + name + (orgCode OR inviteToken)
  ↓
Validate organization (exists, active)
  ↓
Check email not already registered (unique constraint)
  ↓
Create user with hashed password
  ↓
If invitation:
  - Mark invitation accepted
  - Update TenantProfile.status → 'registered', TenantProfile.userId → user._id
  - Add user to apartment.tenantIds
  ↓
Generate access + refresh tokens
  ↓
Send welcome email async (non-blocking)
  ↓
Return { user, accessToken, refreshToken }
```

**Validation Rules:**

- Email: valid format, lowercase, unique
- Password: min 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char (@$!%*?&)
- Name: min 2 chars
- Organization code: required if no inviteToken
- Unit number: required field
- Phone: optional

### Login Flow

```
User provides email + password
  ↓
Find user (including password via select('+password'))
  ↓
Check user exists and isActive
  ↓
Compare provided password with bcrypted stored password
  ↓
Update lastLoginAt timestamp
  ↓
Generate tokens
  ↓
Return { user, accessToken, refreshToken }
```

**Error handling:**
- No user found → "Invalid credentials"
- User inactive → "Account is deactivated"
- Password mismatch → "Invalid credentials"

### JWT Dual-Token System

**Access Token:**
- Short-lived (default: 7 days, configurable via `JWT_EXPIRATION`)
- Used for API requests in Authorization header: `Bearer {token}`
- Contains full payload (sub, email, role, organizationId, buildingIds)

**Refresh Token:**
- Long-lived (default: 30 days, configurable via `JWT_REFRESH_EXPIRATION`)
- Used only at `/auth/refresh` endpoint
- Exchanged for new access + refresh token pair
- Same signing secret as access token

**Token Generation:**

```typescript
const payload: TokenPayload = {
  sub: user._id,
  email: user.email,
  role: user.role,
  organizationId: user.organizationId,
  buildingIds: user.buildingIds.map(id => id.toString()),
  primaryBuildingId: user.primaryBuildingId?.toString(),
};

accessToken = jwtService.sign(payload, {
  secret: JWT_SECRET,
  expiresIn: '7d'
});

refreshToken = jwtService.sign(payload, {
  secret: JWT_SECRET,
  expiresIn: '30d'
});
```

### Token Refresh Logic

**Backend:**
- Validate refresh token signature and expiry
- Fetch user from DB (verify still exists and active)
- Generate new token pair
- Return both tokens

**Frontend: Proactive 5-Minute Window**
- `shouldRefreshToken()` checks if token expires within 5 minutes
- Before any API request, call `getValidAccessToken()`:
  - If token expired → refresh
  - If token expires within 5 min → refresh
  - Otherwise use existing token
- On 401 response → attempt refresh + retry once
- On refresh failure → logout + redirect to `/login`

### Password Reset Flow

**1. Forgot Password (Request)**

```
User provides email
  ↓
Find user (if not found, don't reveal this to prevent enumeration)
  ↓
Generate crypto.randomBytes(32) → hex string
  ↓
Hash token: SHA256(token)
  ↓
Store: user.passwordResetToken = hashedToken, user.passwordResetExpires = now + 1 hour
  ↓
Send reset email with plain token (user needs plain to submit)
  ↓
Always return success message (even if email doesn't exist)
```

**2. Reset Password (Confirm)**

```
User provides token (from email) + newPassword
  ↓
Hash token: SHA256(token)
  ↓
Find user where:
  - passwordResetToken = hashedToken
  - passwordResetExpires > now
  ↓
If not found: "Invalid or expired reset token" (400)
  ↓
Update user.password (triggers bcrypt middleware)
  ↓
Clear resetToken and resetExpires
  ↓
Send confirmation email async
  ↓
Return success
```

**Security:**
- Token hashing prevents token database leak
- 1-hour expiry prevents prolonged vulnerability window
- Email enumeration prevented by always returning "success"
- Confirmation email alerts user to unauthorized reset attempts

### Password Change

**Authenticated users only:**

```
User provides currentPassword + newPassword
  ↓
Fetch user with password selected
  ↓
Validate currentPassword matches
  ↓
Update user.password = newPassword (triggers bcrypt)
  ↓
Return success
```

- Requires JWT authentication
- No change to tokens (user remains logged in)

## Notifications & Side Effects

### Welcome Email (Async, Non-Blocking)

Sent on successful registration:
- Recipient: new user email
- Triggered: after user created + tokens generated
- Includes: user name, organization name
- Failure does not fail registration (caught and logged)

### Password Reset Email

Sent on forgot-password request:
- Recipient: email from request (if user exists)
- Content: reset link with plain token (not hashed)
- Expiry: 1 hour

### Password Change Confirmation Email

Sent after password reset via token:
- Recipient: user email
- Content: confirmation that password was changed + security warning
- Non-blocking (caught and logged if fails)

## Frontend

### Auth Store (Zustand)

**Location:** `fe_grunnsteinen/src/store/authStore.ts`

**State Shape:**

```typescript
interface AuthState {
  // State
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;

  // Actions
  login: (email, password) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<boolean>;
  forgotPassword: (email) => Promise<void>;
  resetPassword: (token, password) => Promise<void>;
  changePassword: (currentPassword, newPassword) => Promise<void>;
  updateUser: (data: Partial<User>) => void;
  clearError: () => void;
  initializeAuth: () => Promise<void>;
}
```

**Persistence:**

- Zustand `persist` middleware stores only `accessToken` + `refreshToken` in localStorage (key: `auth-storage`)
- `onRehydrateStorage` syncs tokens with `tokenStorage` utility on page load
- Calls `initializeAuth()` after hydration to validate and fetch user

**Key Actions:**

- `login()` / `register()` → make API request, store tokens, toast success, redirect (register only)
- `logout()` → call `/auth/logout` (catch silently), clear tokens, clear React Query cache, clear building store, redirect to `/login`
- `refreshAuth()` → exchange refresh token for new pair, return success boolean (false triggers auto-logout)
- `forgotPassword()` / `resetPassword()` / `changePassword()` → API call + toast success/error
- `initializeAuth()` → fetch `GET /auth/me` to validate tokens and get fresh user data on app load
- `updateUser()` → local state update for profile changes (e.g., after avatar upload)

**Selectors:**

```typescript
selectUser(state)              // Get current user object
selectIsAuthenticated(state)   // Boolean
selectIsLoading(state)         // Boolean
selectIsInitialized(state)     // Boolean (hydration complete)
selectAuthError(state)         // Error string or null
```

### Token Manager

**Location:** `fe_grunnsteinen/src/lib/api/tokenManager.ts`

**Functions:**

- `getTokenExpiry(token: string): Date | null` — decode JWT and extract exp timestamp
- `isTokenExpired(token: string): boolean` — check if token is already expired
- `shouldRefreshToken(token: string): boolean` — check if token expires within 5 minutes

**Implementation:**
- Decodes JWT payload using `atob()` (no library)
- Handles decode errors gracefully (returns null/true)
- Threshold: 5 minutes (300,000 ms)

### API Client

**Location:** `fe_grunnsteinen/src/lib/api/client.ts`

**Token Storage:**

```typescript
const tokenStorage = {
  getAccessToken(): string | null,
  getRefreshToken(): string | null,
  setTokens(access, refresh?): void,
  clearTokens(): void,
}
```

**Interceptor Flow:**

1. **Request interceptor:**
   - Call `getValidAccessToken()`:
     - If token expired or expires within 5 min → refresh
     - Otherwise return existing token
   - Attach as `Authorization: Bearer {token}`

2. **Response interceptor:**
   - 401 → attempt `refreshAccessToken()` → retry request once
   - 403 → redirect to `/unauthorized` + toast "Du har ikke tilgang"
   - 500+ → toast "En serverfeil oppstod"
   - Other errors → parse error message from response

**Refresh Concurrency:**

- Global `isRefreshing` flag prevents multiple simultaneous refresh requests
- Concurrent requests subscribe via callbacks and wait for first refresh to complete
- Subscribers notified via `onTokenRefreshed()` callback

**Error Handling:**

- Network error → toast "Ingen internettforbindelse"
- Invalid JSON → generic "Request failed"
- 401 after refresh failure → logout + redirect to `/login`
- 403 → redirect to `/unauthorized`

**Available Methods:**

```typescript
get<T>(endpoint, params?, config?)
post<T>(endpoint, data?, config?)
put<T>(endpoint, data?, config?)
patch<T>(endpoint, data?, config?)
delete<T>(endpoint, config?)
uploadFile<T>(endpoint, file, additionalData?, config?)
```

**Config Options:**

```typescript
interface RequestConfig {
  params?: Record<string, string | number | boolean>;
  skipAuth?: boolean;  // Skip JWT attachment (for public endpoints)
  headers?: Record<string, string>;
  // ... standard fetch options
}
```

### Protected Routes

**Component:** `fe_grunnsteinen/src/components/auth/ProtectedRoute.tsx`

**Usage:**

```tsx
<ProtectedRoute requiredRoles={['board', 'admin']}>
  <MainLayout>
    {/* content */}
  </MainLayout>
</ProtectedRoute>
```

**Behavior:**

- Waits for auth initialization (`authStore.isInitialized`)
- Checks authentication status
- Validates user role (if `requiredRoles` specified)
- Shows loading skeleton during initialization
- Shows access denied error if unauthorized
- Redirects to `/login` if not authenticated

### Auth Flow Summary

```
User visits protected page
  ↓
ProtectedRoute waits for authStore.isInitialized
  ↓
useAuthStore.initializeAuth() called (if not already initialized):
  - Get tokens from localStorage via tokenStorage
  - Fetch GET /auth/me to validate + get user data
  - Store user in authStore
  ↓
Check isAuthenticated + role
  ↓
If not authenticated → redirect to /login
If wrong role → show access denied
If valid → render page
  ↓
API calls auto-attach token via getValidAccessToken()
  ↓
If token expires within 5 min → refresh before request
  ↓
If request gets 401 → refresh + retry
```

## Key File Paths

| Layer | File | Purpose |
|-------|------|---------|
| **Backend: Core** | `be_grunnsteinen/src/modules/auth/auth.service.ts` | Service with register, login, token generation, password reset |
| **Backend: Core** | `be_grunnsteinen/src/modules/auth/auth.controller.ts` | 7 endpoints (register, login, refresh, forgot-pwd, reset-pwd, change-pwd, logout) |
| **Backend: DTOs** | `be_grunnsteinen/src/modules/auth/dto/register.dto.ts` | Email, password, name, phone, orgCode, unitNumber, building, inviteToken |
| **Backend: DTOs** | `be_grunnsteinen/src/modules/auth/dto/login.dto.ts` | Email, password |
| **Backend: DTOs** | `be_grunnsteinen/src/modules/auth/dto/refresh-token.dto.ts` | Refresh token |
| **Backend: DTOs** | `be_grunnsteinen/src/modules/auth/dto/forgot-password.dto.ts` | Email |
| **Backend: DTOs** | `be_grunnsteinen/src/modules/auth/dto/reset-password.dto.ts` | Token, new password |
| **Backend: DTOs** | `be_grunnsteinen/src/modules/auth/dto/change-password.dto.ts` | Current password, new password |
| **Backend: Strategies** | `be_grunnsteinen/src/modules/auth/strategies/jwt.strategy.ts` | Passport JWT strategy (bearer token extraction, user validation) |
| **Backend: Strategies** | `be_grunnsteinen/src/modules/auth/strategies/jwt-refresh.strategy.ts` | Passport refresh strategy (body field extraction) |
| **Backend: Strategies** | `be_grunnsteinen/src/modules/auth/strategies/local.strategy.ts` | Passport local strategy (email/password validation) |
| **Backend: Module** | `be_grunnsteinen/src/modules/auth/auth.module.ts` | Registers controller, service, strategies, JwtModule |
| **Frontend: Store** | `fe_grunnsteinen/src/store/authStore.ts` | Zustand store with login, register, logout, refresh, password flows |
| **Frontend: Utilities** | `fe_grunnsteinen/src/lib/api/tokenManager.ts` | Token expiry checking, 5-min threshold detection |
| **Frontend: Client** | `fe_grunnsteinen/src/lib/api/client.ts` | Fetch-based HTTP client with token refresh + error handling |
| **Frontend: Endpoints** | `fe_grunnsteinen/src/lib/api/endpoints.ts` | API_ENDPOINTS.AUTH constants |
| **Frontend: Component** | `fe_grunnsteinen/src/components/auth/ProtectedRoute.tsx` | Route protection + role validation |
| **Frontend: Types** | `fe_grunnsteinen/src/types/index.ts` | User type, AuthResponse, TokenPayload interfaces |

## Environment Variables

**Backend (`.env`):**
```
JWT_SECRET            — signing key for tokens
JWT_EXPIRATION        — access token lifetime (default: 7d)
JWT_REFRESH_EXPIRATION — refresh token lifetime (default: 30d)
```

**Frontend (`.env.local`):**
```
NEXT_PUBLIC_API_URL   — backend base URL (e.g., http://localhost:3001)
```

## Security Considerations

- **Passwords:** bcrypted via Mongoose middleware (handled automatically)
- **Reset tokens:** SHA256 hashed in DB (plain sent via email)
- **JWT secret:** must be strong (32+ chars)
- **Refresh token:** stored in localStorage (XSS risk if compromised)
- **Token refresh:** proactive 5-min window prevents expired tokens during page use
- **Email enumeration:** forgot-password always returns success
- **Account takeover:** confirmed by email link with time-limited token
- **Rate limiting:** 5 req/min on auth endpoints via `@ThrottleAuth()`
