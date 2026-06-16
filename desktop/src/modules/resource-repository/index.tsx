import { useEffect, useState } from "react"
import type { ContentOpenRequest } from "@/app-shell/content-navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ResourceRepositoryViewId } from "@/modules/apps/types"
import { PromptsModule } from "@/modules/prompts"
import { RulesModule } from "@/modules/rules"
import { SkillsModule } from "@/modules/skills"

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

  useEffect(() => {
    if (initialContentOpenRequest) {
      setView(viewFromContentOpenRequest(initialContentOpenRequest))
    }
  }, [initialContentOpenRequest])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center border-b bg-background px-3 py-2">
        <Tabs value={view} onValueChange={(next) => setView(next as ResourceRepositoryViewId)}>
          <TabsList>
            {RESOURCE_TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>{tab.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="min-h-0 flex-1">
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
      </div>
    </div>
  )
}
