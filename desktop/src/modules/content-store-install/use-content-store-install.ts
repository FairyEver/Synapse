import { useCallback, useEffect, useState } from "react"
import {
  prepareContentStoreInstallPackage,
  resolveContentStoreInstallSession,
} from "@/app-shell/content-store-install"
import { createRendererLogger } from "@/app-shell/logging"
import type { SynapseContentStorePreparedSource } from "@/types/content-store-install"

type ContentStoreInstallState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "error"; message: string }
  | { status: "ready"; source: SynapseContentStorePreparedSource }
  | { status: "completed"; title: string }

const logger = createRendererLogger("content-store-install.window")

function useContentStoreInstall(sessionId: string) {
  const [state, setState] = useState<ContentStoreInstallState>({ status: "loading" })

  const load = useCallback(async () => {
    setState({ status: "loading" })

    try {
      const resolved = await resolveContentStoreInstallSession(sessionId)
      if (resolved.status === "unauthenticated") {
        setState({ status: "unauthenticated" })
        return
      }

      const prepared = await prepareContentStoreInstallPackage(sessionId)
      if (prepared.status === "unauthenticated") {
        setState({ status: "unauthenticated" })
        return
      }

      setState({ status: "ready", source: prepared.source })
    } catch (error) {
      logger.error("Failed to prepare content store install.", { error, sessionIdLength: sessionId.length })
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "安装包准备失败。",
      })
    }
  }, [sessionId])

  useEffect(() => {
    void load()
  }, [load])

  const markCompleted = useCallback((title: string) => {
    setState({ status: "completed", title })
  }, [])

  return {
    load,
    markCompleted,
    setState,
    state,
  }
}

export { useContentStoreInstall }
export type { ContentStoreInstallState }
