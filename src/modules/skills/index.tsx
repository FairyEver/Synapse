import { createContentModule } from "@/modules/content/create-content-module"
import { SkillCreateDialog } from "@/modules/skills/components/skill-create-dialog"
import { SkillDetailDialog } from "@/modules/skills/components/skill-detail-dialog"
import { serializeCreateSkillFiles } from "@/modules/skills/utils"

export const SkillsModule = createContentModule({
  contentType: "skill",
  CreateDialog: SkillCreateDialog,
  DetailDialog: SkillDetailDialog,
  transformCreatePayload: async (payload) => ({
    ...payload,
    files: await serializeCreateSkillFiles(payload.files),
  }),
})
