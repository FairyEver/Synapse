import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, createRoute, lazyRouteComponent, Outlet, redirect, type RouteComponent } from '@tanstack/react-router'
import { z } from 'zod'
import { AdminAuthenticatedLayout } from '@/components/layout/admin-authenticated-layout'
import { NavigationProgress } from '@/components/navigation-progress'
import { Toaster } from '@/components/ui/sonner'
import { AdminAccessPage } from '@/features/admin-access'
import { NotFoundError } from '@/features/errors/not-found-error'
import { GeneralError } from '@/features/errors/general-error'
import { normalizeAdminRedirect } from '@/lib/admin-redirect'
import { useAdminAuthStore } from '@/stores/admin-auth-store'

const AuditLogsPage = lazyRouteComponent(() => import('@/features/audit-logs'))
const BackupPage = lazyRouteComponent(() => import('@/features/backup'))
const DevicesPage = lazyRouteComponent(() => import('@/features/devices'))
const DriveAdminPage = lazyRouteComponent(() => import('@/features/drive'))
const LogsPage = lazyRouteComponent(() => import('@/features/logs'))
const ProblemFeedbackPage = lazyRouteComponent(() => import('@/features/problem-feedback'))
const SkillRepositoryAdminPage = lazyRouteComponent(() => import('@/features/skill-repository'), 'SkillRepositoryAdminPage')
const SystemPage = lazyRouteComponent(() => import('@/features/system'))
const TeamsPage = lazyRouteComponent(() => import('@/features/teams'))
const TeamDetailPage = lazyRouteComponent(() => import('@/features/teams/team-detail'))
const TelemetryPage = lazyRouteComponent(() => import('@/features/telemetry'))
const UsersPage = lazyRouteComponent(() => import('@/features/users'))
const WebhookDeliveriesPage = lazyRouteComponent(() => import('@/features/webhook-deliveries'))

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => <><NavigationProgress /><Outlet /><Toaster duration={5000} /></>,
  notFoundComponent: NotFoundError,
  errorComponent: GeneralError,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({
      to: useAdminAuthStore.getState().auth.isAuthenticated ? '/system' : '/access',
      replace: true,
    })
  },
})

const accessRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'access',
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: () => {
    if (useAdminAuthStore.getState().auth.isAuthenticated) {
      throw redirect({ to: '/system', replace: true })
    }
  },
  component: () => <AdminAccessPage redirectTo={normalizeAdminRedirect(accessRoute.useSearch().redirect)} />,
})

const authenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_authenticated',
  beforeLoad: ({ location }) => {
    if (!useAdminAuthStore.getState().auth.isAuthenticated) {
      throw redirect({
        to: '/access',
        search: { redirect: normalizeAdminRedirect(location.href) },
        replace: true,
      })
    }
  },
  component: AdminAuthenticatedLayout,
})

function adminPage<const TPath extends string>(path: TPath, component: RouteComponent) {
  return createRoute({ getParentRoute: () => authenticatedRoute, path, component })
}

const skillSearchSchema = z.object({
  page: z.coerce.number().optional(), pageSize: z.coerce.number().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'title', 'name']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(), status: z.enum(['active', 'removed']).optional(),
  query: z.string().optional(),
})
const skillRepositoriesRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'skill-repositories',
  validateSearch: skillSearchSchema,
  component: () => <SkillRepositoryAdminPage search={skillRepositoriesRoute.useSearch()} />,
})

const webhookSearchSchema = z.object({
  page: z.coerce.number().optional(), pageSize: z.coerce.number().optional(), sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(), webhookId: z.string().optional(), status: z.string().optional(),
  from: z.string().optional(), to: z.string().optional(), user: z.string().optional(), userId: z.string().optional(),
})
const webhookDeliveriesRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'webhook-deliveries',
  validateSearch: webhookSearchSchema,
  component: () => <WebhookDeliveriesPage mode='admin' search={webhookDeliveriesRoute.useSearch()} />,
})

const teamDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'teams/$teamId',
  component: TeamDetailPage,
})

export const adminRouteTree = rootRoute.addChildren([
  indexRoute,
  accessRoute,
  authenticatedRoute.addChildren([
    adminPage('system', SystemPage), adminPage('users', UsersPage), adminPage('devices', DevicesPage),
    adminPage('teams', TeamsPage), teamDetailRoute,
    adminPage('telemetry', TelemetryPage),
    skillRepositoriesRoute, webhookDeliveriesRoute, adminPage('audit-logs', AuditLogsPage),
    adminPage('problem-feedback', ProblemFeedbackPage),
    adminPage('backup', BackupPage), adminPage('drive', DriveAdminPage), adminPage('logs', LogsPage),
  ]),
])
