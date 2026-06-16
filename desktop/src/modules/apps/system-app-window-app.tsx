import { useEffect, useMemo, useState } from "react"
import {
  subscribeContentOpenRequest,
  type ContentOpenRequest,
} from "@/app-shell/content-navigation"
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { DatabaseModule } from "@/modules/database"
import { EditorScanModule } from "@/modules/editor-scan"
import { ModelPriceModule } from "@/modules/model-price"
import { ResourceRepositoryModule } from "@/modules/resource-repository"
import { UsageMonitorModule } from "@/modules/usage-analysis"
import type { SynapseSystemAppId, SynapseSystemAppOpenOptions } from "./types"
import { parseSystemAppId } from "./definitions"

type AppsBridge = {
  readonly openSystemApp: (appId: SynapseSystemAppId, options?: SynapseSystemAppOpenOptions) => Promise<void>
  readonly onContentOpenRequest: (listener: (request: ContentOpenRequest) => void) => () => void
}

function getAppsBridge(): AppsBridge | undefined {
  return (getSynapseBridge() as (ReturnType<typeof getSynapseBridge> & { readonly apps?: AppsBridge }) | undefined)
    ?.apps
}

function parseInitialContentOpenRequest(): ContentOpenRequest | null {
  const raw = new URLSearchParams(window.location.search).get("contentOpenRequest")
  if (!raw) return null
  try {
    return JSON.parse(raw) as ContentOpenRequest
  } catch {
    return null
  }
}

export function SystemAppWindowApp() {
  const appId = useMemo(
    () => parseSystemAppId(new URLSearchParams(window.location.search).get("appId")),
    [],
  )
  const [pendingContentOpenRequest, setPendingContentOpenRequest] =
    useState<ContentOpenRequest | null>(() => parseInitialContentOpenRequest())

  useEffect(() => {
    const bridge = getAppsBridge()
    if (!bridge) return undefined
    return bridge.onContentOpenRequest((request) => {
      setPendingContentOpenRequest(request)
    })
  }, [])

  useEffect(() => {
    if (appId === "resource-repository") return undefined
    return subscribeContentOpenRequest((request) => {
      void getAppsBridge()?.openSystemApp("resource-repository", {
        contentOpenRequest: request,
      })
    })
  }, [appId])

  if (!appId) {
    return <SystemAppWindowError />
  }

  if (appId === "resource-repository") {
    return (
      <ResourceRepositoryModule
        initialContentOpenRequest={pendingContentOpenRequest}
        onInitialContentOpenRequestConsumed={(requestId) => {
          setPendingContentOpenRequest((current) => current?.requestId === requestId ? null : current)
        }}
      />
    )
  }
  if (appId === "database") return <DatabaseModule />
  if (appId === "editor-scan") return <EditorScanModule />
  if (appId === "usage-monitor") return <UsageMonitorModule />
  if (appId === "model-price") return <ModelPriceModule />

  return <SystemAppWindowError />
}

function SystemAppWindowError() {
  return (
    <div className="flex h-full items-center justify-center bg-surface p-6">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>无法打开应用</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>应用不存在。</EmptyContent>
      </Empty>
    </div>
  )
}
