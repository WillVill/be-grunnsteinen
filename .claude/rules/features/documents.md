---
paths:
  - "be_grunnsteinen/src/modules/documents/**"
  - "fe_grunnsteinen/src/hooks/api/useDocuments.ts"
  - "fe_grunnsteinen/src/app/documents/**"
---

# Documents

## Overview

The Documents module manages document storage and distribution for housing associations. Residents and board members can upload important documents (building rules, meeting minutes, contracts, manuals, floor plans), categorize them, and make them accessible to community members. Documents are stored on S3 with presigned download URLs (1-hour expiry) for secure, trackable access. The system supports scoping at organization-wide, building-specific, and apartment-specific levels with optional public/private visibility controls.

---

## Data Model

### Document Schema

**Collection:** `documents`

```
_id                 → ObjectId (serialized as `id` in JSON)
organizationId      → ObjectId (required, indexed) → organizations
buildingId          → ObjectId (optional, indexed) → buildings
apartmentId         → ObjectId (optional, indexed) → apartments
isOrganizationWide  → boolean, default: false (visible org-wide vs scoped)

title               → string (required, trimmed, 2-100 chars)
description?        → string (optional, trimmed)
category            → DocumentCategory enum (required, indexed)

fileUrl             → string (required, S3 URL)
fileKey             → string (required, S3 key for deletion)
fileName            → string (required, original filename)
fileSize?           → number (optional, bytes)
mimeType?           → string (optional, file MIME type)

uploadedById        → ObjectId (required, indexed) → users
isPublic            → boolean (default: true, indexed)

createdAt           → Date (auto-set)
updatedAt           → Date (auto-updated)
```

### DocumentCategory Enum

```
RULES           → Building rules and regulations
MINUTES         → Board meeting minutes and protocols
FDV             → FDV documents (Property accounting/inspection)
MANUALS         → Equipment/system manuals and guides
CONTRACTS       → Building contracts and agreements
FLOOR_PLAN      → Building floor plans and layouts
OTHER           → Miscellaneous documents
```

### Indexes

```
organizationId (compound with createdAt desc)
organizationId, category (compound)
organizationId, isPublic (compound)
organizationId, category, isPublic (compound)
uploadedById, createdAt DESC (compound)
organizationId, buildingId, category (compound)
buildingId, isOrganizationWide (compound)
apartmentId, category (compound)
title, description (text search index)
```

---

## API Endpoints

| Method | Endpoint | Auth | Request | Response | Notes |
|--------|----------|------|---------|----------|-------|
| POST | `/documents` | JWT + BOARD/ADMIN | multipart/form-data (file + metadata) | Document | Upload document (50MB max, throttled 10/min) |
| GET | `/documents` | JWT | DocumentQueryDto (query) | PaginatedResponse<Document> | List paginated documents with filters |
| GET | `/documents/:id` | JWT | — | Document | Get document details |
| GET | `/documents/:id/download` | JWT | — | `{ url: string }` | Get presigned download URL (1-hour expiry) |
| PATCH | `/documents/:id` | JWT + BOARD/ADMIN | UpdateDocumentDto | Document | Update metadata (title, description, category, isPublic) |
| DELETE | `/documents/:id` | JWT + BOARD/ADMIN | — | 204 No Content | Delete document and S3 file |

---

## Business Rules & Logic

### Document Upload

**Endpoint:** `POST /documents`

**File Validation:**
- Max size: 50 MB
- File stored in `Express.Multer.File` via `FileInterceptor('file')`
- Rate limited: 10 requests/min via `@ThrottleUpload()`

**Metadata Validation (UploadDocumentDto):**
- `title`: required, 2-100 chars
- `description`: optional, string
- `category`: required, must be valid DocumentCategory enum (rules, minutes, fdv, manuals, contracts, floor-plan, other)
- `buildingId`: required, valid MongoDB ObjectId
- `apartmentId`: optional, valid MongoDB ObjectId
- `isPublic`: optional, boolean, default: true

**Backend Flow:**
1. Validate file size and form data
2. Generate S3 key: `documents/{timestamp-uuid}/{originalFilename}`
3. Upload file buffer to S3 with original MIME type
4. Create Document record with:
   - `fileUrl`: S3 HTTP URL
   - `fileKey`: S3 object key (for deletion)
   - `fileName`: original filename
   - `fileSize`: file.size (bytes)
   - `mimeType`: file.mimetype
   - `uploadedById`: current user ID
   - `organizationId`: from auth context
   - `buildingId`: from DTO
   - `isPublic`: from DTO or default true
5. Return populated document with uploader details (name, avatar, role)
6. Log upload: "Document uploaded: {title} ({id}) by user {userId}"

### Document Listing & Filtering

**Endpoint:** `GET /documents`

**Query Parameters (DocumentQueryDto extends PaginationQueryDto):**
- `page`: default 1
- `limit`: default 20
- `sortBy`: default 'createdAt'
- `sortOrder`: 'asc' | 'desc', default 'desc'
- `category`: optional, filter by DocumentCategory
- `search`: optional, full-text search on title + description
- `apartmentId`: optional, filter by apartment

**Scoping Rules:**
1. Always filtered by `organizationId` from user token
2. If `apartmentId` provided: show documents for that apartment only
3. Else if `buildingId` provided: show documents from that building OR org-wide documents via `$or: [{ buildingId }, { isOrganizationWide: true }]`
4. Otherwise: show all org-scoped documents
5. Category filter applied if specified
6. Text search via MongoDB text index if `search` provided

**Sorting:**
- Default: `createdAt` descending (newest first)
- If search provided: sort by text score first, then by createdAt
- Custom `sortBy` parameter overrides default

**Response Format:**
```json
{
  "data": [
    {
      "id": "507f1f77bcf86cd799439011",
      "organizationId": "...",
      "buildingId": "...",
      "apartmentId": null,
      "isOrganizationWide": false,
      "title": "Building Rules and Regulations",
      "description": "Updated building rules effective January 2024",
      "category": "rules",
      "fileUrl": "https://s3.amazonaws.com/bucket/documents/...",
      "fileKey": "documents/2024.../rules.pdf",
      "fileName": "rules.pdf",
      "fileSize": 2500000,
      "mimeType": "application/pdf",
      "uploadedById": { "id": "...", "name": "John Admin", "avatarUrl": "...", "role": "admin" },
      "isPublic": true,
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:30:00Z"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

### Get Document by ID

**Endpoint:** `GET /documents/:id`

**Behavior:**
1. Fetch document by ID
2. Verify document belongs to user's organization (scope check)
3. Populate `uploadedById` with user details (name, avatar, email, role)
4. Return full document

**Authorization:**
- Public documents: all authenticated users in organization can view
- Private documents: only board/admin can view (implicit check on `isPublic` flag in service)

### Get Presigned Download URL

**Endpoint:** `GET /documents/:id/download`

**Behavior:**
1. Fetch document by ID
2. Verify access:
   - If `isPublic: true`: allow access
   - If `isPublic: false`: verify user is board/admin, else throw 403
3. Generate presigned URL via S3Service:
   - Expiry: 3600 seconds (1 hour)
   - Method: GET
   - Bucket: AWS_S3_BUCKET
4. Return: `{ url: "https://s3.amazonaws.com/bucket/key?..." }`
5. Log: "Download URL generated for document: {documentId}"

**Frontend Usage:**
- Call endpoint to get presigned URL
- Open URL in new tab via `window.open(url, '_blank')`
- URL expires after 1 hour; new request needed for re-download
- Presigned URL is single-use safe (no AWS credentials exposed)

### Update Document Metadata

**Endpoint:** `PATCH /documents/:id`

**Authorization:** BOARD or ADMIN role only

**Update Fields (UpdateDocumentDto - all optional):**
- `title`: 2-100 chars
- `description`: string
- `category`: DocumentCategory enum
- `isPublic`: boolean

**Behavior:**
1. Fetch document by ID
2. Verify user role is BOARD or ADMIN (via `isBoardOrAbove()` helper)
3. If not authorized: throw 403 ForbiddenException
4. Update document with provided fields only
5. Return updated document with uploader details
6. Log: "Document updated: {documentId}"

### Delete Document

**Endpoint:** `DELETE /documents/:id`

**Authorization:** BOARD or ADMIN role only

**Behavior:**
1. Fetch document by ID
2. Verify user role is BOARD or ADMIN
3. If not authorized: throw 403 ForbiddenException
4. Delete S3 file:
   - Try: `s3Service.deleteFile(document.fileKey)`
   - Catch: log error as warning (non-blocking)
   - Continue even if S3 deletion fails
5. Delete document record from MongoDB via `deleteOne({ _id: documentId })`
6. Return 204 No Content
7. Log: "Document deleted: {documentId} by user {userId}"

**Side Effects:**
- S3 file deletion failures are logged but do not prevent DB deletion
- Document is hard-deleted (not soft-deleted)
- No cascade to apartments or other collections

---

## Scoping & Authorization

### Organization Scoping

- All queries filtered by `organizationId` from authenticated user
- Users cannot access documents from other organizations
- `isOrganizationWide` flag determines if document visible across all buildings

### Building-Level Access

- Documents with specific `buildingId` visible only to residents of that building
- Organization-wide documents (no `buildingId` or `isOrganizationWide: true`) visible to all
- Listing with `buildingId` filter returns building docs + org-wide docs

### Apartment-Level Access

- Documents linked to `apartmentId` visible only to residents of that apartment
- Optional secondary scoping (rarely used; mainly for unit-specific docs)

### Role-Based Authorization

- **RESIDENT**: Can view public documents, list documents, download
- **BOARD/ADMIN**: Can upload, update, delete documents; can access private documents
- **SUPER_ADMIN**: Same as ADMIN + cross-organization access (implicit via global role)

---

## Notifications & Side Effects

**Document Upload:**
- Logged at info level: `"Document uploaded: {title} ({id}) by user {userId}"`
- No email/push notifications triggered
- No in-app notifications created

**Document Update:**
- Logged at info level: `"Document updated: {documentId}"`
- Cache invalidation on frontend

**Document Deletion:**
- Logged at info level: `"Document deleted: {documentId} by user {userId}"`
- S3 file deletion failures logged as warnings (non-blocking)
- No notifications to other users

---

## Frontend

### Hooks (fe_grunnsteinen/src/hooks/api/useDocuments.ts)

#### Query Hooks

**useDocuments(params: DocumentQueryParams)**
- Fetch paginated documents with filters
- Returns: `{ data: PaginatedResponse<Document>, isLoading, error }`
- Query key: `queryKeys.documents.list(params)`
- Params: page, limit, sortBy, sortOrder, category, search, apartmentId, buildingId

**useDocument(documentId: string)**
- Fetch single document by ID
- Returns: `{ data: Document, isLoading, error }`
- Query key: `queryKeys.documents.detail(documentId)`
- Disabled if no documentId

**useDocumentDownloadUrl(documentId: string)**
- Fetch presigned download URL (1-hour expiry)
- Returns: `{ data: { url: string }, isLoading, error }`
- Query key: `[...queryKeys.documents.detail(documentId), 'download']`
- `staleTime: 0` (always fetch fresh URL)
- Disabled if no documentId

#### Mutation Hooks

**useUploadDocument()**
- Upload new document with file + metadata
- Input: `{ file: File, data: UploadDocumentData }`
- UploadDocumentData: `{ title, description?, category, buildingId, apartmentId?, isPublic? }`
- Returns: mutate, mutateAsync, isLoading, error
- On success: invalidates `queryKeys.documents.all`
- Uses `FormData` for multipart upload

**useUpdateDocument()**
- Update document metadata
- Input: `{ documentId: string, data: Partial<UploadDocumentData> }`
- Returns: mutate, mutateAsync, isLoading, error
- On success: invalidates detail + all queries

**useDeleteDocument()**
- Delete document and S3 file
- Input: documentId
- Returns: mutate, mutateAsync, isLoading, error
- On success: invalidates all queries

**useDownloadDocument()**
- Convenience mutation for download flow
- Input: documentId
- Fetches presigned URL and opens in new tab
- Returns: mutate, mutateAsync, isLoading, error
- Non-blocking (errors logged, not thrown)

### Frontend Pages

#### `/documents` (Documents List Page)

Main documents hub with category filtering, search, and upload capability.

**Features:**
- **Header:**
  - Title: "Dokumenter"
  - Subtitle: "Viktige dokumenter for borettslaget"
  - Gradient icon (FileText)
  - Upload button (for board/admin only)

- **Category Tabs:**
  - "Alle" (All) — all documents
  - "Husordensregler" (Rules) — RULES category
  - "Møtereferater" (Minutes) — MINUTES category
  - "FDV" — FDV category
  - "Manualer" (Manuals) — MANUALS category
  - "Annet" (Other) — OTHER category
  - Each tab shows count badge

- **Document Cards:**
  - Icon (color-coded by category):
    - Rules: blue FileCheck
    - Minutes: green FileSpreadsheet
    - FDV: orange FileCog
    - Manuals: purple FileText
    - Other: gray FileQuestion
  - Title (bold, truncated)
  - Metadata: Upload date (formatted: "d. MMMM yyyy"), separator, uploader name + avatar
  - Action: "Last ned" (Download) button

- **Loading State:**
  - Skeleton cards while fetching

- **Empty State:**
  - EmptyDocuments component when no documents match filters

**Building Filter:**
- Via `useBuildingFilter()` hook (scopes to selected building)
- Shows docs from building + org-wide docs

**Upload Dialog (UploadDocumentDialog):**
- Form fields: title, description, category, buildingId, apartmentId, isPublic
- File picker
- Submit button
- On success: refresh list, toast "Dokumentet ble lastet opp"

### Types (fe_grunnsteinen/src/types/index.ts)

```typescript
type DocumentCategory =
  | 'rules'
  | 'minutes'
  | 'fdv'
  | 'manuals'
  | 'contracts'
  | 'floor-plan'
  | 'other';

interface Document {
  id: string;
  organizationId: string;
  buildingId?: string;
  apartmentId?: string;
  isOrganizationWide: boolean;
  title: string;
  description?: string;
  category: DocumentCategory;
  fileUrl: string;
  fileKey: string;
  fileName: string;
  fileSize?: number;
  mimeType?: string;
  uploadedById: string | { id: string; name: string; avatarUrl?: string; role: UserRole };
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface UploadDocumentData {
  title: string;
  description?: string;
  category: DocumentCategory;
  buildingId: string;
  apartmentId?: string;
  isPublic?: boolean;
}

type DocumentQueryParams = {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  category?: DocumentCategory;
  search?: string;
  apartmentId?: string;
  buildingId?: string;
}
```

### Query Keys (fe_grunnsteinen/src/lib/api/queryKeys.ts)

```typescript
documents: {
  all: [...]
  list: (params: DocumentQueryParams) => [...]
  detail: (documentId: string) => [...]
}
```

### API Endpoints (fe_grunnsteinen/src/lib/api/endpoints.ts)

```typescript
API_ENDPOINTS.DOCUMENTS = {
  UPLOAD: '/documents',
  LIST: '/documents',
  BY_ID: (id) => `/documents/${id}`,
  DOWNLOAD: (id) => `/documents/${id}/download`,
  UPDATE: (id) => `/documents/${id}`,
  DELETE: (id) => `/documents/${id}`,
}
```

---

## DTO Validation Rules

### UploadDocumentDto

| Field | Type | Required | Rules |
|-------|------|----------|-------|
| `title` | string | Yes | 2–100 chars |
| `description` | string | No | string |
| `category` | DocumentCategory | Yes | enum: rules, minutes, fdv, manuals, contracts, floor-plan, other |
| `buildingId` | string | Yes | Valid MongoDB ObjectId |
| `apartmentId` | string | No | Valid MongoDB ObjectId if provided |
| `isPublic` | boolean | No | Default: true |

### UpdateDocumentDto

| Field | Type | Rules |
|-------|------|-------|
| `title` | string | Optional, 2–100 chars if provided |
| `description` | string | Optional |
| `category` | DocumentCategory | Optional, enum if provided |
| `isPublic` | boolean | Optional |

### DocumentQueryDto (extends PaginationQueryDto)

| Field | Type | Default | Rules |
|-------|------|---------|-------|
| `page` | number | 1 | inherited |
| `limit` | number | 20 | inherited |
| `sortBy` | string | createdAt | inherited |
| `sortOrder` | 'asc' \| 'desc' | 'desc' | inherited |
| `category` | DocumentCategory | optional | enum if provided |
| `search` | string | optional | full-text search on title + description |
| `apartmentId` | string | optional | Valid MongoDB ObjectId |
| `buildingId` | string | optional | Valid MongoDB ObjectId (inherited from base scoping) |

---

## Common Patterns

### Fetch and display documents

```typescript
const { data, isLoading } = useDocuments({
  page: 1,
  limit: 20,
  category: 'rules',
  buildingId: buildingId
});

if (isLoading) return <Skeleton />;
if (!data?.data.length) return <EmptyDocuments />;

return data.data.map(doc => (
  <Card key={doc.id}>
    <CardContent>
      <div className="flex items-center gap-4">
        <div className="p-3 bg-muted rounded-lg">
          {getDocumentIcon(doc.category)}
        </div>
        <div className="flex-1">
          <h3 className="font-semibold">{doc.title}</h3>
          <div className="text-sm text-muted-foreground">
            {format(new Date(doc.createdAt), 'd. MMMM yyyy', { locale: nb })}
          </div>
        </div>
        <DownloadButton documentId={doc.id} title={doc.title} />
      </div>
    </CardContent>
  </Card>
));
```

### Upload document

```typescript
const uploadDocument = useUploadDocument();

const handleUpload = async (file: File, formData: UploadDocumentData) => {
  // Validate file
  if (!file.type.match(/pdf|word|sheet|presentation/)) {
    toast.error('Kun dokument-filer er tillatt');
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    toast.error('Filen kan ikke være større enn 50MB');
    return;
  }

  try {
    await uploadDocument.mutateAsync({ file, data: formData });
    toast.success('Dokumentet ble lastet opp!');
    onClose();
  } catch (error) {
    toast.error(handleApiError(error));
  }
};
```

### Download document

```typescript
const downloadDocument = useDownloadDocument();

const handleDownload = async (documentId: string, title: string) => {
  try {
    await downloadDocument.mutateAsync(documentId);
    toast.success(`${title} lastes ned...`);
  } catch (error) {
    toast.error('Kunne ikke laste ned dokumentet');
  }
};
```

### Update document metadata

```typescript
const updateDocument = useUpdateDocument();

const handleUpdate = async (documentId: string, updates: Partial<UploadDocumentData>) => {
  try {
    await updateDocument.mutateAsync({ documentId, data: updates });
    toast.success('Dokumentet ble oppdatert!');
  } catch (error) {
    toast.error(handleApiError(error));
  }
};
```

### Delete document

```typescript
const deleteDocument = useDeleteDocument();

const handleDelete = async (documentId: string, title: string) => {
  if (!confirm(`Slett dokumentet "${title}"?`)) return;

  try {
    await deleteDocument.mutateAsync(documentId);
    toast.success('Dokumentet ble slettet!');
  } catch (error) {
    toast.error(handleApiError(error));
  }
};
```

---

## Key File Paths

### Backend

| Role | Path |
|------|------|
| **Controller** | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/documents/documents.controller.ts` |
| **Service** | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/documents/documents.service.ts` |
| **Schema** | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/documents/schemas/document.schema.ts` |
| **Module** | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/documents/documents.module.ts` |
| **DTO: Upload** | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/documents/dto/upload-document.dto.ts` |
| **DTO: Update** | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/documents/dto/update-document.dto.ts` |
| **DTO: Query** | `/sessions/practical-keen-volta/mnt/code/be_grunnsteinen/src/modules/documents/dto/document-query.dto.ts` |

### Frontend

| Role | Path |
|------|------|
| **Hooks** | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/hooks/api/useDocuments.ts` |
| **Page** | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/app/documents/page.tsx` |
| **Types** | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/types/index.ts` |
| **API Endpoints** | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/lib/api/endpoints.ts` |
| **Query Keys** | `/sessions/practical-keen-volta/mnt/code/fe_grunnsteinen/src/lib/api/queryKeys.ts` |

---

## S3 Integration

Documents are stored on AWS S3 with the following configuration:

- **Path Pattern:** `documents/{timestamp-uuid}/{originalFilename}`
- **Bucket:** `AWS_S3_BUCKET` (from environment)
- **Public Access:** Documents are readable via presigned URLs (no public bucket access)
- **Cleanup:** S3 files deleted when document record is deleted
- **Error Handling:** S3 deletion failures logged but don't prevent DB deletion

Presigned URLs are generated via `S3Service.getPresignedDownloadUrl(key, expirySeconds)` with:
- **Expiry:** 3600 seconds (1 hour)
- **Access:** GET method only
- **Security:** URL contains temporary credentials; no permanent keys exposed
