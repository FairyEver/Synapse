import { Mail } from "lucide-react"
import { mailReceivedManifest } from "./manifest"
import { MailReceivedConfigForm } from "./config.renderer"
export const mailReceivedRendererDefinition = { manifest: mailReceivedManifest, icon: Mail, manualRunUnavailableReason: "需要信件上下文，无法手动运行", summarizeConfig: (config: { accountId?: string }) => config.accountId ? "指定邮箱账号" : "全部邮箱账号", ConfigForm: MailReceivedConfigForm }
