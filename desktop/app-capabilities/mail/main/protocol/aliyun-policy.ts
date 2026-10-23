import { accountConfigSchema } from "../../shared/schema"
import type { AccountConfig } from "../../shared/types"

export function aliyunConfig(email: string, name: string): AccountConfig {
  return accountConfigSchema.parse({ provider: "aliyun", name, email,
    imap: { host: "imap.qiye.aliyun.com", port: 993, security: "tls" },
    smtp: { host: "smtp.qiye.aliyun.com", port: 465, security: "tls" }, sentPolicy: "server",
  })
}
export function providerPolicy(config: AccountConfig) {
  return { copyActsAsMove: config.provider === "aliyun", serverSavesSent: config.provider === "aliyun" || config.sentPolicy === "server", remoteTextSearchReliable: config.provider !== "aliyun" }
}
