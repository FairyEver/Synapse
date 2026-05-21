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
import { LoginPage } from "@/pages/login-page"
import { SystemPage } from "@/pages/system-page"
import { LogsPage } from "@/pages/logs-page"
import { adminApi, type AdminSession } from "@/lib/api"
import { useIdleTimeout } from "@/hooks/use-idle-timeout"

type Route =
  | { name: "audit-logs" }
  | { name: "system" }
  | { name: "backup" }
  | { name: "logs" }

function routeFromHash(): Route {
  const route = window.location.hash.replace(/^#\/?/, "") || "system"
  if (route === "audit-logs") return { name: "audit-logs" }
  if (route === "backup") return { name: "backup" }
  if (route === "logs") return { name: "logs" }
  return { name: "system" }
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
    case "system":
    default:
      return "系统"
  }
}

export default function App() {
  const route = useHashRoute()
  const [session, setSession] = React.useState<AdminSession | null | undefined>(undefined)

  React.useEffect(() => {
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
  }, [])

  function handleLogout() {
    adminApi
      .logout()
      .catch(() => undefined)
      .finally(() => setSession(null))
  }

  const handleIdleTimeout = React.useCallback(() => {
    adminApi.logout().catch(() => undefined).finally(() => setSession(null))
  }, [])

  useIdleTimeout(handleIdleTimeout)

  if (session === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <PageState>加载中</PageState>
      </main>
    )
  }

  if (session === null) {
    return <LoginPage onLoggedIn={setSession} />
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar
          activeRoute={route.name}
          user={{
            name: "Admin",
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
              <h1 className="text-sm font-medium">{titleForRoute(route)}</h1>
            </div>
          </header>
          <main className="flex flex-1 flex-col gap-2 p-4 pt-0">
            {route.name === "audit-logs" ? <AuditLogsPage /> : null}
            {route.name === "system" ? <SystemPage /> : null}
            {route.name === "backup" ? <BackupPage /> : null}
            {route.name === "logs" ? <LogsPage /> : null}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
