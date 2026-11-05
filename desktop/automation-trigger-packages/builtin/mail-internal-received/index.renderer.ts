import { Inbox } from "lucide-react"
import { mailInternalReceivedManifest } from "./manifest"
export const mailInternalReceivedRendererDefinition = { manifest: mailInternalReceivedManifest, icon: Inbox, manualRunUnavailableReason: "需要信件上下文，无法手动运行", summarizeConfig: () => "" }
