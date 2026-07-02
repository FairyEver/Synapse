import { useCallback, useEffect, useState } from "react"
import {
  prepareSkillRepositoryInstallPackage,
  resolveSkillRepositoryInstallSession,
} from "@/app-shell/skill-repository-install"
import { createRendererLogger } from "@/app-shell/logging"
import type { SynapseSkillRepositoryPreparedSource } from "@/types/skill-repository-install"

type SkillRepositoryInstallState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "error"; message: string }
  | { status: "ready"; source: SynapseSkillRepositoryPreparedSource }
  | { status: "completed"; title: string }

const logger = createRendererLogger("skill-repository-install.window")

function useSkillRepositoryInstall(sessionId: string) {
  const [state, setState] = useState<SkillRepositoryInstallState>({ status: "loading" })

  const load = useCallback(async () => {
    setState({ status: "loading" })

    try {
      const resolved = await resolveSkillRepositoryInstallSession(sessionId)
      if (resolved.status === "unauthenticated") {
        setState({ status: "unauthenticated" })
        return
      }

      const prepared = await prepareSkillRepositoryInstallPackage(sessionId)
      if (prepared.status === "unauthenticated") {
        setState({ status: "unauthenticated" })
        return
      }

      setState({ status: "ready", source: prepared.source })
    } catch (error) {
      logger.error("Failed to prepare skill repository install.", { error, sessionIdLength: sessionId.length })
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

export { useSkillRepositoryInstall }
export type { SkillRepositoryInstallState }
