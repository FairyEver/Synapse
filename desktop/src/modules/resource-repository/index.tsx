import { useEffect, useState } from "react"
import type { ContentOpenRequest } from "@/app-shell/content-navigation"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import type { ResourceRepositoryViewId } from "@/modules/apps/types"
import { PromptsModule } from "@/modules/prompts"
import { RulesModule } from "@/modules/rules"
import { SkillsModule } from "@/modules/skills"
import { BookOpen } from "lucide-react"
import { SkillAuthoringGuideDialog } from "./skill-authoring-guide-dialog"

const RESOURCE_TABS: readonly { readonly id: ResourceRepositoryViewId; readonly label: string }[] = [
  { id: "skill", label: "技能" },
  { id: "rule", label: "规则" },
  { id: "prompt", label: "提示词" },
]

type ResourceRepositoryModuleProps = {
  readonly initialContentOpenRequest?: ContentOpenRequest | null
  readonly onInitialContentOpenRequestConsumed?: (requestId: string) => void
}

function viewFromContentOpenRequest(request: ContentOpenRequest | null | undefined): ResourceRepositoryViewId {
  if (request?.contentType === "rule") return "rule"
  if (request?.contentType === "skill") return "skill"
  return "skill"
}

export function ResourceRepositoryModule({
  initialContentOpenRequest = null,
  onInitialContentOpenRequestConsumed,
}: ResourceRepositoryModuleProps) {
  const [view, setView] = useState<ResourceRepositoryViewId>(() => viewFromContentOpenRequest(initialContentOpenRequest))
  const [guideOpen, setGuideOpen] = useState(false)

  useEffect(() => {
    if (initialContentOpenRequest) {
      setView(viewFromContentOpenRequest(initialContentOpenRequest))
    }
  }, [initialContentOpenRequest])

  const guideAction = view === "skill" ? (
    <SystemAppTopBarActionButton
      iconOnly
      type="button"
      aria-label="Skill 开发指南"
      tooltip="Skill 开发指南"
      onClick={() => setGuideOpen(true)}
    >
      <BookOpen />
    </SystemAppTopBarActionButton>
  ) : undefined

  return (
    <>
      <SystemAppWindowShell
        tabs={RESOURCE_TABS}
        value={view}
        onValueChange={setView}
        actions={guideAction}
      >
        <Tabs value={view} className="contents">
          <TabsContent value="skill" className="m-0 h-full data-[state=inactive]:hidden">
            <SkillsModule
              pendingContentOpenRequest={initialContentOpenRequest}
              onPendingContentOpenRequestConsumed={onInitialContentOpenRequestConsumed}
            />
          </TabsContent>
          <TabsContent value="rule" className="m-0 h-full data-[state=inactive]:hidden">
            <RulesModule
              pendingContentOpenRequest={initialContentOpenRequest}
              onPendingContentOpenRequestConsumed={onInitialContentOpenRequestConsumed}
            />
          </TabsContent>
          <TabsContent value="prompt" className="m-0 h-full data-[state=inactive]:hidden">
            <PromptsModule />
          </TabsContent>
        </Tabs>
      </SystemAppWindowShell>
      <SkillAuthoringGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
    </>
  )
}
