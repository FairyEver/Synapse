import { mailReceivedManifest } from "./manifest"
import { MailReceivedConfigForm } from "./config.renderer"
export const mailReceivedRendererDefinition = { manifest: mailReceivedManifest, summarizeConfig: (config: { accountId?: string }) => config.accountId ? "指定邮箱账号" : "全部邮箱账号", ConfigForm: MailReceivedConfigForm }
