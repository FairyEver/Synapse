import { Card, CardContent } from "../../../src/components/ui/card"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import { SkillUninstallerFlow } from "./skill-uninstaller-flow"

export function SkillUninstallerModule() {
  return (
    <SystemAppWindowShell>
      <ScrollArea className="h-full min-h-0">
        <div className="mx-auto w-full max-w-2xl p-3 sm:p-5">
          <Card className="py-0">
            <CardContent className="p-4 sm:p-5">
              <SkillUninstallerFlow mode="page" />
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </SystemAppWindowShell>
  )
}

export { SkillUninstallerDialog } from "./skill-uninstaller-dialog"
export { useSkillUninstallerDialog } from "./use-skill-uninstaller-dialog"
