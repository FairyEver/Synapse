import { randomBytes } from "node:crypto"
import { loadEnv } from "../config/env"

export const updateIntentConfigToken = Symbol("updateIntentConfig")

export interface UpdateIntentConfig {
  readonly secret: string
  readonly enforceOrigin: boolean
  readonly publicOrigin?: string
}

export function createUpdateIntentConfig(): UpdateIntentConfig {
  const env = loadEnv(process.env)
  return {
    secret: env.desktopUpdateIntentSecret ?? randomBytes(32).toString("base64url"),
    enforceOrigin: process.env.NODE_ENV === "production",
    publicOrigin: env.appPublicUrl ? new URL(env.appPublicUrl).origin : undefined,
  }
}
