import { LoaderCircle } from "lucide-react"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { useRepositoryManager, useRepositoryOperation } from "@/app-shell/use-repository-manager"
import { Button } from "@/components/ui/button"
import { SettingsGroup } from "@/modules/settings/components/settings-group"

const logger = createRendererLogger("settings.admin")

type RepositoryMaintenancePanelProps = {
  repositoryUuid: string
}

function RepositoryMaintenancePanel({ repositoryUuid }: RepositoryMaintenancePanelProps) {
  const manager = useRepositoryManager()
  const { promise } = useAppNotifications()
  const operation = useRepositoryOperation(repositoryUuid)
  const isBusy = operation?.isRunning && operation.operation === "maintenance"

  return (
    <SettingsGroup>
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">整理历史记录</p>
        </div>

        {isBusy && operation?.statusText ? (
          <p className="text-sm text-muted-foreground">{operation.statusText}</p>
        ) : null}

        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={Boolean(operation?.isRunning)}
            onClick={() => {
              logger.info("Repository maintenance initiated.", { repositoryUuid })
              void promise(
                () => manager.runMaintenance(repositoryUuid),
                {
                  trackingName: "settings.repository.maintenance",
                  loading: "正在整理历史记录...",
                  success: (result) => result.message ?? "整理完成。",
                  error: (error) => error instanceof Error ? error.message : "整理失败。",
                },
              ).catch((err) => { logger.warn("Repository maintenance failed.", { repositoryUuid, error: err instanceof Error ? err.message : String(err) }) })
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
