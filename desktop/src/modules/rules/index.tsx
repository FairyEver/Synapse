import { createContentModule } from "@/modules/content/create-content-module"
import { RuleCreateDialog } from "@/modules/rules/components/rule-create-dialog"
import { RuleDetailDialog } from "@/modules/rules/components/rule-detail-dialog"

export const RulesModule = createContentModule({
  contentType: "rule",
  CreateDialog: RuleCreateDialog,
  DetailDialog: RuleDetailDialog,
})
