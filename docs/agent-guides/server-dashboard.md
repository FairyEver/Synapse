# Server And Dashboard Boundary

Synapse server-side product UI is split into two workspace packages:

- `server/`: NestJS API, Prisma, authentication, audit, backup, logs, and business services.
- `dashboard/`: Vite + React Router + shadcn/ui management frontend.

Do not add new React pages under `server/admin`; that Vite/shadcn admin frontend has been retired.

The default deployment remains single-domain for simple Docker installation:

- `/dashboard/*` serves the dashboard static bundle.
- `/api/*` proxies to the NestJS API.
- `/healthz` proxies to the NestJS health endpoint.

Authentication uses the existing `synapse_admin` HttpOnly cookie. Dashboard requests must include credentials and must not store dashboard session tokens in `localStorage`.

Dashboard feature work should follow the current shadcn/ui conventions:

- `src/routes.ts` owns routes and menu entries.
- `src/app.tsx` owns protected route boundaries and top-level route composition.
- `src/lib/api.ts` owns API calls, response types, cookie credentials, and shared error handling.
- Pages should use existing shadcn/ui primitives from `src/components/ui/`, shared dashboard components from `src/components/`, and restrained Tailwind layout utilities.
- Do not add Ant Design, ProComponents, or a parallel component system unless the user explicitly approves a migration.
