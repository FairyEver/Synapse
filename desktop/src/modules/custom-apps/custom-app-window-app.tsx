import { useEffect, useMemo } from "react"
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import type { CustomAppId } from "@synapse/shared"

import { CustomWebAppContent } from "./web-app-content"
import { useCustomApps } from "./context"

export function CustomAppWindowApp() {
  const appId = useMemo(
    () => new URLSearchParams(window.location.search).get("appId"),
    [],
  ) as CustomAppId | null
  const customApps = useCustomApps()
  const app = appId
    ? customApps.state.snapshot?.apps.find((candidate) => candidate.id === appId) ?? null
    : null

  useEffect(() => {
    if (
      appId
      && customApps.state.syncState === "ready"
      && (!app || app.openMode !== "window")
    ) window.close()
  }, [app, appId, customApps.state.syncState])

  if (!appId) return <WindowError message="应用不存在。" />
  if (customApps.state.syncState === "loading" && !customApps.state.snapshot) {
    return (
      <div className="flex h-full items-center justify-center bg-surface" role="status">
        <Spinner />
      </div>
    )
  }
  if (!app) {
    return <WindowError message={
      customApps.state.syncState === "signed-out" ? "请先登录 Synapse。" : "应用不存在或已删除。"
    } />
  }
  if (app.openMode !== "window") {
    return <WindowError message="该应用只在主窗口内打开。" />
  }
  return <CustomWebAppContent app={app} appId={app.id} windowMode />
}

function WindowError({ message }: { readonly message: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-surface p-6">
      <Empty>
        <EmptyHeader><EmptyTitle>无法打开应用</EmptyTitle></EmptyHeader>
        <EmptyContent>{message}</EmptyContent>
      </Empty>
    </div>
  )
}
