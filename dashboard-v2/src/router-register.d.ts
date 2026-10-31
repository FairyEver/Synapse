import type { dashboardRouter } from './main'
import type { adminRouter } from './admin-main'

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof dashboardRouter | typeof adminRouter
  }
}
