import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { inspectGlobalSkillInstallations, installSourceToEditorTargets } from "../../../src/app-shell/installers"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import type { SynapseEditorInstallStatusEntry } from "../../../src/types/editor-install-status"
import type { SynapseSkillInstallerSource } from "../../../src/types/installers"

const logger = createRendererLogger("synapse-skill.auto-update")
const CHECKED_SESSION_KEY = "synapse:app:synapse_skill_auto_update_checked:operation"

type UpdateCheck = {
  source: SynapseSkillInstallerSource
  targets: SynapseEditorInstallStatusEntry[]
}

function releaseInstallSource(source: SynapseSkillInstallerSource): void {
  if (!source.preparedSourceId) return
  void requireBridgeDomain("synapseSkill").releaseInstallSource(source.preparedSourceId).catch((error) => {
    logger.warn("Failed to release Synapse Skill install source.", error)
  })
}

function wasCheckedForCurrentProcess(): boolean {
  try {
    return window.sessionStorage.getItem(CHECKED_SESSION_KEY) === "true"
  } catch {
    return false
  }
}

function markCheckedForCurrentProcess(): void {
  try {
    window.sessionStorage.setItem(CHECKED_SESSION_KEY, "true")
  } catch (error) {
    logger.warn("Failed to remember the Synapse Skill update check.", error)
  }
}

function SynapseSkillAutoUpdateHost({ enabled = true }: { readonly enabled?: boolean }) {
  const checkPromiseRef = useRef<Promise<UpdateCheck | null> | null>(null)

  useEffect(() => {
    if (!enabled || wasCheckedForCurrentProcess()) return

    if (!checkPromiseRef.current) {
      checkPromiseRef.current = (async () => {
        let source: SynapseSkillInstallerSource | null = null
        try {
          source = await requireBridgeDomain("synapseSkill").prepareInstallSource()
          const result = await inspectGlobalSkillInstallations(source)
          const targets = result.entries.filter(
            (entry) => entry.scope === "global" && entry.status === "needs_update",
          )
          if (targets.length > 0) return { source, targets }
          releaseInstallSource(source)
          return null
        } catch (error) {
          if (source) releaseInstallSource(source)
          logger.error("Failed to inspect global Synapse Skill installations.", error)
          return null
        }
      })()
    }

    let cancelled = false
    void checkPromiseRef.current.then(async (check) => {
      if (cancelled) {
        if (check) releaseInstallSource(check.source)
        return
      }

      markCheckedForCurrentProcess()
      if (!check) return

      try {
        const result = await installSourceToEditorTargets({
          mode: "update",
          source: check.source,
          targets: check.targets.map((entry) => ({ editorId: entry.editorId, scope: "global" })),
        })
        const failures = result.results.filter((item) => item.status === "failed")
        const warnings = result.results.filter((item) => item.status === "installed" && item.result?.warning)

        if (failures.length > 0) {
          logger.warn("Failed to auto-update some global Synapse Skill installations.", { count: failures.length })
          toast.error("Synapse Skill 更新失败", { description: "请在 Synapse Skill 中重试。" })
        }
        if (warnings.length > 0) {
          logger.warn("Global Synapse Skill update requires inspection.", { count: warnings.length })
          toast.warning("Synapse Skill 更新完成，需检查", {
            description: warnings.map((item) => item.result?.warning).filter(Boolean).join("；"),
          })
        }
      } catch (error) {
        logger.error("Failed to auto-update global Synapse Skill installations.", error)
        toast.error("Synapse Skill 更新失败", { description: "请在 Synapse Skill 中重试。" })
      } finally {
        releaseInstallSource(check.source)
      }
    })

    return () => {
      cancelled = true
      checkPromiseRef.current = null
    }
  }, [enabled])

  return null
}

export { SynapseSkillAutoUpdateHost }
