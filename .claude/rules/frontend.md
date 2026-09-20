---
paths:
  - "fe_grunnsteinen/**"
---

# Frontend Patterns (Next.js 16 / React 19)

Also see `fe_grunnsteinen/CLAUDE.md` for API hook conventions (apiClient, queryKeys, useApiQuery).

## Project Structure

```
fe_grunnsteinen/src/
├── app/                  # Next.js App Router pages
├── components/
│   ├── ui/               # shadcn/ui base components
│   ├── features/         # Domain components (posts/, events/, admin/, etc.)
│   ├── layout/           # MainLayout, Sidebar, Header, MobileNav
│   └── auth/             # ProtectedRoute
├── hooks/api/            # One hook file per feature + useApiQuery.ts
├── lib/api/              # client.ts, endpoints.ts, queryKeys.ts, tokenManager.ts
├── store/                # Zustand stores (authStore, building-store, app-store)
└── types/index.ts        # All TypeScript types (single file)
```

## Page Structure

Every protected page:

```tsx
'use client';

import { ProtectedRoute } from '@/components/auth';
import { MainLayout } from '@/components/layout';

export default function FeaturePage() {
  return (
    <ProtectedRoute requiredRoles={['board', 'admin']}> {/* optional */}
      <MainLayout>
        {/* content */}
      </MainLayout>
    </ProtectedRoute>
  );
}
```

## Dialog / Create Components

Support both controlled and uncontrolled modes:

```tsx
interface CreateXDialogProps {
  trigger?: React.ReactNode;
  onXCreated?: (id: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CreateXDialog({ open: controlledOpen, onOpenChange, trigger, onXCreated }: CreateXDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;
  // ...
}
```

## Form Handling

Local state + manual validation + toast (not React Hook Form for most dialogs):

```tsx
const [formData, setFormData] = useState({ name: '', description: '' });
const [errors, setErrors] = useState<{ name?: string }>({});

const validateForm = () => {
  const newErrors: typeof errors = {};
  if (!formData.name.trim()) newErrors.name = 'Navn er påkrevd';
  setErrors(newErrors);
  return Object.keys(newErrors).length === 0;
};

const handleSubmit = async () => {
  if (!validateForm()) return;
  try {
    await mutation.mutateAsync(formData);
    toast.success('Opprettet!');
  } catch (error) {
    toast.error(handleApiError(error));
  }
};
```

## Loading / Error / Empty States

Use pre-built components from `components/ui/`:

```tsx
if (isLoading) return <Skeleton />;

// Error variants
<GenericError />       // "Noe gikk galt"
<NetworkError />       // "Ingen internettforbindelse"
<ServerError />        // "Serverfeil"
<AccessDeniedError />  // "Ingen tilgang"
<NotFoundError />      // "Ikke funnet"

// Empty state variants (one per feature)
<EmptyPosts />  <EmptyEvents />  <EmptyBookings />  <EmptyMessages />
<EmptyDocuments />  <EmptyGroups />  <EmptySearchResults />
```

## File Upload Validation

Always validate type and size before processing:

```tsx
if (!file.type.startsWith('image/')) {
  toast.error('Kun bildefiler er tillatt');
  return;
}
if (file.size > 5 * 1024 * 1024) {
  toast.error('Bildet kan ikke være større enn 5MB');
  return;
}
```

## Styling

- `cn()` from `@/lib/utils` to merge Tailwind classes
- CVA (`class-variance-authority`) for component variants
- Mobile-first responsive: `hidden md:block` / `block md:hidden`
- Color tokens via CSS custom properties: `--color-primary`, `--color-destructive`, etc.
- Icons: Lucide React (`lucide-react`)
- Toasts: Sonner (`sonner`)

## Available UI Components (shadcn/ui)

`components/ui/`: button, card, dialog, alert-dialog, responsive-dialog, input, label, textarea, select, checkbox, switch, tabs, badge, avatar, user-avatar, popover, calendar, form, form-error, empty-state, error-state, sonner, skeleton, separator, scroll-area, sheet, dropdown-menu, tooltip

## State Management

- **Zustand** for client state: `authStore` (user, tokens, auth actions), `building-store` (selected building filter), `app-store` (sidebar, theme)
- **TanStack Query v5** for server state: queries via `useApiQuery`/`usePaginatedQuery`, mutations with `queryClient.invalidateQueries()`
- Zustand uses `devtools` + `persist` middleware (localStorage)

## Error Flow

1. `apiClient` catches HTTP errors → throws `ApiError(statusCode, message, fieldErrors)`
2. 401 → token refresh + retry; if fails → logout + redirect to `/login`
3. 403 → redirect to `/unauthorized`
4. Components catch → `toast.error(handleApiError(error))`
5. Full-page states → `<ErrorState>` / `<EmptyState>` components

## TypeScript

- Strict mode ON
- Path alias: `@/*` → `./src/*`
- All types in single `types/index.ts`
- Role helpers: `isAdminRole(role)`, `isBoardOrAbove(role)`
