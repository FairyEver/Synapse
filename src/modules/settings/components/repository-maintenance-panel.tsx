import { useState } from "react"
import { LoaderCircle } from "lucide-react"
import { useRepositoryManager } from "@/app-shell/repository"
import { InlineNotice } from "@/components/inline-notice"
import { Button } from "@/components/ui/button"
import { SettingsGroup } from "@/modules/settings/components/settings-group"

type RepositoryMaintenancePanelProps = {
  repositoryUuid: string
}

function RepositoryMaintenancePanel({ repositoryUuid }: RepositoryMaintenancePanelProps) {
  const { operations, runMaintenance } = useRepositoryManager()
  const [notice, setNotice] = useState<{
    message: string
    tone: "default" | "destructive"
  } | null>(null)
  const operation = operations[repositoryUuid]
  const isBusy = operation?.isRunning && operation.operation === "maintenance"

  return (
    <SettingsGroup>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">整理历史记录</p>
          <p className="text-sm text-muted-foreground">
            会压实旧历史，并清理未被任何版本引用的附件。
          </p>
        </div>

        {notice ? (
          <InlineNotice
            message={notice.message}
            tone={notice.tone}
            onDismiss={() => setNotice(null)}
          />
        ) : null}

        {operation?.error && operation.operation === "maintenance" ? (
          <InlineNotice message={operation.error} tone="destructive" />
        ) : null}

        {isBusy && operation?.statusText ? (
          <p className="text-sm text-muted-foreground">{operation.statusText}</p>
        ) : null}

        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={Boolean(operation?.isRunning)}
            onClick={() => {
              setNotice(null)
              void runMaintenance(repositoryUuid)
                .then((result) => {
                  setNotice({
                    message: result.message ?? "整理完成。",
                    tone: "default",
                  })
                })
                .catch((error) => {
                  setNotice({
                    message: error instanceof Error ? error.message : "整理失败。",
                    tone: "destructive",
                  })
                })
            }}
          >
            {isBusy ? <LoaderCircle className="animate-spin" /> : null}
            {isBusy ? "整理中..." : "整理历史记录"}
          </Button>
        </div>
      </div>
    </SettingsGroup>
  )
}

export { RepositoryMaintenancePanel }
