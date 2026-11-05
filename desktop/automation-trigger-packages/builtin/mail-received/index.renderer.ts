import { mailReceivedManifest } from "./manifest"
import { MailReceivedConfigForm } from "./config.renderer"
export const mailReceivedRendererDefinition = { manifest: mailReceivedManifest, summarizeConfig: () => "收到新的邮件", ConfigForm: MailReceivedConfigForm }
