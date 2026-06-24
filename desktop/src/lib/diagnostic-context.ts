import type { SanitizedTrackValue, TrackAction } from "@/lib/ui-tracking"

export type DiagnosticBreadcrumb = {
  action: TrackAction
  component: string
  createdAt: string
  metadata?: Record<string, SanitizedTrackValue>
  name: string
  value?: SanitizedTrackValue
}

export type DiagnosticContext = {
  activeRepositoryUuid?: string
  activeAppId?: string
  windowType?: string
}

const MAX_BREADCRUMBS = 100
const breadcrumbs: DiagnosticBreadcrumb[] = []
const context: DiagnosticContext = {}

export function recordDiagnosticBreadcrumb(breadcrumb: Omit<DiagnosticBreadcrumb, "createdAt">): void {
  breadcrumbs.push({
    ...breadcrumb,
    createdAt: new Date().toISOString(),
  })
  if (breadcrumbs.length > MAX_BREADCRUMBS) {
    breadcrumbs.splice(0, breadcrumbs.length - MAX_BREADCRUMBS)
  }
}

export function updateDiagnosticContext(nextContext: DiagnosticContext): void {
  Object.assign(context, nextContext)
}

export function getDiagnosticSnapshot(): {
  breadcrumbs: DiagnosticBreadcrumb[]
  context: DiagnosticContext
  url?: string
} {
  return {
    breadcrumbs: breadcrumbs.slice(-MAX_BREADCRUMBS),
    context: { ...context },
    url: typeof window === "undefined" ? undefined : window.location.href,
  }
}

export function resetDiagnosticContextForTests(): void {
  breadcrumbs.splice(0, breadcrumbs.length)
  for (const key of Object.keys(context) as Array<keyof DiagnosticContext>) {
    delete context[key]
  }
}
