import { useState } from "react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EditorScanModule } from "@/modules/editor-scan"
import { createContentModule } from "@/modules/content/create-content-module"
import { SkillCreateDialog } from "@/modules/skills/components/skill-create-dialog"
import { SkillDetailDialog } from "@/modules/skills/components/skill-detail-dialog"
import { serializeCreateSkillFiles } from "@/modules/skills/utils"

const SkillsLibraryModule = createContentModule({
  contentType: "skill",
  CreateDialog: SkillCreateDialog,
  DetailDialog: SkillDetailDialog,
  transformCreatePayload: async (payload) => ({
    ...payload,
    files: await serializeCreateSkillFiles(payload.files),
  }),
})

type SkillsModuleProps = Parameters<typeof SkillsLibraryModule>[0]
type SkillsView = "library" | "project-scan"

function SkillsModule(props: SkillsModuleProps) {
  const [view, setView] = useState<SkillsView>("library")

  return (
    <div className="flex h-full flex-col gap-3">
      <Tabs value={view} onValueChange={(value) => setView(value as SkillsView)}>
        <TabsList>
          <TabsTrigger value="library">内容库</TabsTrigger>
          <TabsTrigger value="project-scan">项目扫描</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="min-h-0 flex-1">
        {view === "library" ? (
          <SkillsLibraryModule {...props} />
        ) : (
          <EditorScanModule
            lockedContentTab="skill"
            lockedScopeTab="project"
            title="项目 Skill"
          />
        )}
      </div>
    </div>
  )
}

export { SkillsModule }
