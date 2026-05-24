# Server And Dashboard Boundary

Synapse server-side product UI is split into two workspace packages:

- `server/`: NestJS API, Prisma, authentication, audit, backup, logs, and business services.
- `dashboard/`: Ant Design Pro management frontend.

Do not add new React pages under `server/admin`; that Vite/shadcn admin frontend has been retired.

The default deployment remains single-domain for simple Docker installation:

- `/dashboard/*` serves the dashboard static bundle.
- `/api/*` and `/v1/*` proxy to the NestJS API.
- `/healthz` proxies to the NestJS health endpoint.

Authentication uses the existing `synapse_admin` HttpOnly cookie. Dashboard requests must include credentials and must not store dashboard session tokens in `localStorage`.

Dashboard feature work should follow Ant Design Pro conventions:

- `config/routes.ts` owns routes and menu entries.
- `src/app.tsx` owns initial state, layout runtime, and request runtime.
- `src/services/synapse/api.ts` owns API calls and response types.
- Pages should use Ant Design and ProComponents such as `PageContainer`, `ProTable`, `ProForm`, `ModalForm`, `ProCard`, and `Result`.
