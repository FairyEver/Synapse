import { useCallback, useState } from "react"

import type { SkillUninstallBatchResult } from "../shared/schema"
import { SkillUninstallerDialog } from "./skill-uninstaller-dialog"

export type OpenSkillUninstallerOptions = {
  readonly initialName: string
  readonly initialSearchRootPath?: string
  readonly onCompleted?: (result: SkillUninstallBatchResult) => Promise<void> | void
}

export function useSkillUninstallerDialog() {
  const [state, setState] = useState<OpenSkillUninstallerOptions | null>(null)
  const openSkillUninstaller = useCallback((options: OpenSkillUninstallerOptions) => setState(options), [])
  const closeSkillUninstaller = useCallback(() => setState(null), [])
  return {
    openSkillUninstaller,
    closeSkillUninstaller,
    dialog: (
      <SkillUninstallerDialog
        open={state !== null}
        query={state ? {
          name: state.initialName,
          searchRootPath: state.initialSearchRootPath,
        } : null}
        onOpenChange={(open) => { if (!open) closeSkillUninstaller() }}
        onCompleted={state?.onCompleted}
      />
    ),
  }
}
