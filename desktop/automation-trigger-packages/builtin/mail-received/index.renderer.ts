import { Mail } from "lucide-react"
import { summarizeMailReceivedConfig } from "./filter"
import { mailReceivedManifest } from "./manifest"
import { MailReceivedConfigForm } from "./config.renderer"
import type { MailReceivedConfig } from "./schema"

export const mailReceivedRendererDefinition = {
  manifest: mailReceivedManifest,
  icon: Mail,
  manualRunUnavailableReason: "需要信件上下文，无法手动运行",
  summarizeConfig: (config: MailReceivedConfig) => summarizeMailReceivedConfig(config),
  ConfigForm: MailReceivedConfigForm,
}
