# Synapse Dashboard

Ant Design Pro based management dashboard for Synapse.

## Scripts

- `pnpm --filter @synapse/dashboard run dev`
- `pnpm --filter @synapse/dashboard run lint`
- `pnpm --filter @synapse/dashboard run build`

The app is served under `/dashboard/` and talks to the Synapse API through `/api/*` with the existing HttpOnly cookie session.
