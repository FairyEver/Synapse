import * as React from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { PageState } from "@/components/page-state"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AuditLogsPage } from "@/pages/audit-logs-page"
import { BackupPage } from "@/pages/backup-page"
import { InvitationsPage } from "@/pages/invitations-page"
import { LoginPage } from "@/pages/login-page"
import { SignupPage } from "@/pages/signup-page"
import { SystemPage } from "@/pages/system-page"
import { TeamInvitePage } from "@/pages/team-invite-page"
import { LogsPage } from "@/pages/logs-page"
import { TeamsPage } from "@/pages/teams-page"
import { UserTeamPage } from "@/pages/user-team-page"
import { UsersPage } from "@/pages/users-page"
import { adminApi, type AdminSession } from "@/lib/api"
import { useIdleTimeout } from "@/hooks/use-idle-timeout"

type Route =
  | { name: "audit-logs" }
  | { name: "system" }
  | { name: "backup" }
  | { name: "logs" }
  | { name: "users" }
  | { name: "teams" }
  | { name: "invitations" }

function routeFromHash(): Route {
  const route = window.location.hash.replace(/^#\/?/, "") || "system"
  if (route === "audit-logs") return { name: "audit-logs" }
  if (route === "backup") return { name: "backup" }
  if (route === "logs") return { name: "logs" }
  if (route === "users") return { name: "users" }
  if (route === "teams") return { name: "teams" }
  if (route === "invitations") return { name: "invitations" }
  return { name: "system" }
}

function isSignupRoute(): boolean {
  return window.location.pathname.replace(/\/+$/, "") === "/dashboard/signup"
}

function isTeamInviteRoute(): boolean {
  return window.location.pathname.replace(/\/+$/, "") === "/dashboard/team-invite"
}

function isLoginRoute(): boolean {
  return window.location.pathname.replace(/\/+$/, "") === "/dashboard/login"
}

function dashboardUrlFromCurrentHash(): string {
  return `/dashboard/${window.location.hash}`
}

function normalizeStaleLoginHashRoute(): void {
  if (isLoginRoute() && window.location.hash) {
    window.history.replaceState({}, "", dashboardUrlFromCurrentHash())
  }
}

function inviteTokenFromSearch(): string {
  const query = new URLSearchParams(window.location.search)
  return (query.get("invite") ?? query.get("token"))?.trim() ?? ""
}

function useHashRoute(): Route {
  const [route, setRoute] = React.useState(routeFromHash)
  React.useEffect(() => {
    const handleHashChange = () => setRoute(routeFromHash())
    window.addEventListener("hashchange", handleHashChange)
    return () => window.removeEventListener("hashchange", handleHashChange)
  }, [])
  return route
}

function titleForRoute(route: Route): string {
  switch (route.name) {
    case "audit-logs":
      return "审计日志"
    case "backup":
      return "备份管理"
    case "logs":
      return "系统日志"
    case "users":
      return "用户"
    case "teams":
      return "团队"
    case "invitations":
      return "邀请"
    case "system":
    default:
      return "系统"
  }
}

function accountNameFromEmail(email: string): string {
  const [name] = email.split("@")
  return name?.trim() || email
}

export default function App() {
  normalizeStaleLoginHashRoute()
  const route = useHashRoute()
  const signupRoute = isSignupRoute()
  const teamInviteRoute = isTeamInviteRoute()
  const loginRoute = isLoginRoute()
  const [session, setSession] = React.useState<AdminSession | null | undefined>(undefined)

  React.useEffect(() => {
    if (signupRoute || loginRoute) return
    let alive = true
    adminApi
      .getSession()
      .then((result) => {
        if (alive) setSession(result)
      })
      .catch(() => {
        if (alive) setSession(null)
      })
    return () => {
      alive = false
    }
  }, [loginRoute, signupRoute])

  function handleLogout() {
    adminApi
      .logout()
      .catch(() => undefined)
      .finally(() => setSession(null))
  }

  function handleLoggedIn(nextSession: AdminSession) {
    if (isLoginRoute()) {
      window.history.replaceState({}, "", dashboardUrlFromCurrentHash())
    }
    setSession(nextSession)
  }

  const handleIdleTimeout = React.useCallback(() => {
    adminApi.logout().catch(() => undefined).finally(() => setSession(null))
  }, [])

  useIdleTimeout(handleIdleTimeout)

  if (signupRoute) {
    return <SignupPage inviteToken={inviteTokenFromSearch()} />
  }

  if (loginRoute && session === undefined) {
    return <LoginPage onLoggedIn={handleLoggedIn} />
  }

  if (session === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <PageState>加载中</PageState>
      </main>
    )
  }

  if (session === null) {
    return <LoginPage onLoggedIn={handleLoggedIn} />
  }

  if (teamInviteRoute) {
    if (session.role !== "user") {
      return <LoginPage onLoggedIn={handleLoggedIn} />
    }
    return <TeamInvitePage token={inviteTokenFromSearch()} />
  }

  const activeRoute = session.role === "user" ? { name: "teams" as const } : route

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar
          activeRoute={activeRoute.name}
          role={session.role}
          user={{
            name: accountNameFromEmail(session.email),
            email: session.email,
            avatar: "",
          }}
          onLogout={handleLogout}
        />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-center" />
              <h1 className="text-sm font-medium">{titleForRoute(activeRoute)}</h1>
            </div>
          </header>
          <main className="flex flex-1 flex-col gap-2 p-4 pt-0">
            {session.role === "admin" && activeRoute.name === "audit-logs" ? <AuditLogsPage /> : null}
            {session.role === "admin" && activeRoute.name === "system" ? <SystemPage /> : null}
            {session.role === "admin" && activeRoute.name === "backup" ? <BackupPage /> : null}
            {session.role === "admin" && activeRoute.name === "logs" ? <LogsPage /> : null}
            {session.role === "admin" && activeRoute.name === "users" ? <UsersPage /> : null}
            {session.role === "admin" && activeRoute.name === "teams" ? <TeamsPage /> : null}
            {session.role === "user" && activeRoute.name === "teams" ? <UserTeamPage /> : null}
            {session.role === "admin" && activeRoute.name === "invitations" ? <InvitationsPage /> : null}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
