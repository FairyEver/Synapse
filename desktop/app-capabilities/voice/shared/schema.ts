import { z } from "zod"

export const voiceSettingsSchema = z.object({
  appId: z.string().trim(),
  secretId: z.string().trim(),
  engineModelType: z.string().trim().min(1),
  hotwordList: z.string(),
  domain: z.number().int().min(0).max(3),
}).strict()

/** 只有 secretKey 走加密存储，设置项本身不含密钥。 */
export const voiceSettingsPatchSchema = z.object({
  appId: z.string().trim().optional(),
  secretId: z.string().trim().optional(),
  engineModelType: z.string().trim().min(1).optional(),
  hotwordList: z.string().optional(),
  domain: z.number().int().min(0).max(3).optional(),
  secretKey: z.string().optional(),
}).strict()

/**
 * 设置视图永远不回传 secretKey，只回传「有没有」。密钥读出后只在主进程参与签名，
 * 不下发到任何客户端。
 */
export const voiceSettingsViewSchema = voiceSettingsSchema.extend({
  hasSecretKey: z.boolean(),
  configured: z.boolean(),
}).strict()

export const voiceSessionSignInputSchema = z.object({
  /** 客户端生成的 UUID；不传则由主进程生成。每次连接都要换新的。 */
  voiceId: z.string().trim().min(1).optional(),
  engineModelType: z.string().trim().min(1).optional(),
  hotwordList: z.string().optional(),
  domain: z.number().int().min(0).max(3).optional(),
}).strict()

export const voiceSignedSessionSchema = z.object({
  url: z.string().min(1),
  voiceId: z.string().min(1),
  expiredAt: z.number().int(),
}).strict()

export type VoiceSettings = z.infer<typeof voiceSettingsSchema>
export type VoiceSettingsPatch = z.infer<typeof voiceSettingsPatchSchema>
export type VoiceSettingsView = z.infer<typeof voiceSettingsViewSchema>
export type VoiceSessionSignInput = z.infer<typeof voiceSessionSignInputSchema>
export type VoiceSignedSession = z.infer<typeof voiceSignedSessionSchema>
