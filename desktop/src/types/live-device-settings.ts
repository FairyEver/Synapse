import { z } from "zod"

export const liveDeviceNameSchema = z.string().trim().min(1, "请输入设备名称").max(120, "设备名称最多 120 个字符")
  .refine((value) => Array.from(value).every((character) => {
    const code = character.charCodeAt(0)
    return code >= 32 && code !== 127
  }), "设备名称不能包含控制字符")

export const liveDeviceSettingsSchema = z.object({ name: liveDeviceNameSchema })
export type LiveDeviceSettings = z.infer<typeof liveDeviceSettingsSchema>
