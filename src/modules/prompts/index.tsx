import { createContentModule } from "@/modules/content/create-content-module"
import { PromptCreateDialog } from "@/modules/prompts/components/prompt-create-dialog"
import { PromptDetailDialog } from "@/modules/prompts/components/prompt-detail-dialog"

export const PromptsModule = createContentModule({
  contentType: "prompt",
  CreateDialog: PromptCreateDialog,
  DetailDialog: PromptDetailDialog,
})
