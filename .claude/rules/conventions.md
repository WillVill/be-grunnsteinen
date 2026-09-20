# Project Conventions

## Naming Conventions

### Files

| Type | Convention | Example |
| --- | --- | --- |
| Components | PascalCase | `CreatePostDialog.tsx`, `MainLayout.tsx` |
| Pages | `page.tsx` in route folder | `app/events/page.tsx` |
| Hooks | camelCase with `use` prefix | `usePosts.ts`, `useMediaQuery.ts` |
| Stores | camelCase | `authStore.ts`, `building-store.ts` |
| Backend controllers | `[feature].controller.ts` | `posts.controller.ts` |
| Backend services | `[feature].service.ts` | `posts.service.ts` |
| Backend schemas | `schemas/[feature].schema.ts` | `schemas/post.schema.ts` |
| Backend DTOs | `[action]-[feature].dto.ts` | `create-post.dto.ts` |

### Code

| Element | Convention | Example |
| --- | --- | --- |
| React components | PascalCase | `CreatePostDialog` |
| Hooks | `use` prefix | `usePosts()` |
| Event handlers | `handle` prefix | `handleSubmit` |
| Boolean state | `is`/`has` prefix | `isLoading`, `hasError` |
| Constants | UPPER_SNAKE_CASE | `API_ENDPOINTS` |
| Enums (BE) | PascalCase name, lowercase values | `PostCategory.GENERAL = 'general'` |
| Backend classes | `[Feature]Controller`, `[Feature]Service` | `PostsController` |
| DTOs | `[Action][Feature]Dto` | `CreatePostDto` |
| Routes | kebab-case | `/help-requests` |
| Logger | `new Logger(ClassName.name)` | `new Logger(PostsService.name)` |

## Localization

- **Language**: Norwegian bokmål (nb-NO). All UI text hardcoded in Norwegian.
- **No i18n library** — strings inline in components.
- **Date formatting**: `date-fns` with `nb` locale:

  ```tsx
  import { format } from 'date-fns';
  import { nb } from 'date-fns/locale';
  format(new Date(), 'dd. MMMM yyyy', { locale: nb });
  ```

- **Common toast phrases**:
  - Success: `"Opprettet!"`, `"Oppdatert!"`, `"Slettet!"`
  - Error: `"Noe gikk galt"`, `"En uventet feil oppstod"`
  - Auth: `"Økten din har utløpt"`, `"Du har ikke tilgang til denne ressursen"`
  - Validation: `"Navn er påkrevd"`, `"Må være minst 3 tegn"`

## Key Rules

1. **Always scope by organization** — every backend query must filter by `organizationId`
2. **JWT guard is global** — use `@Public()` to opt out for public endpoints
3. **Backend strict mode OFF** — be careful with null/undefined
4. **Frontend strict mode ON** — handle all cases
5. **Rate limiting** — 300/min global, 10/min for uploads (`@ThrottleUpload()`)
6. **Token refresh** — proactive refresh 5 min before JWT expiry
7. **All API calls via `apiClient`** — never raw `fetch` in hooks
8. **Query keys via `queryKeys` factory** — never inline arrays
9. **Norwegian UI text** — all user-facing strings in Norwegian bokmål
10. **Cache invalidation on mutations** — use `queryClient.invalidateQueries()`
11. **Backend validation** — `whitelist: true`, `forbidNonWhitelisted: true` (unknown fields rejected)
12. **Package manager** — Yarn 4.5.1 for both projects
