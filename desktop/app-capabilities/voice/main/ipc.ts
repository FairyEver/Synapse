import { z } from "zod"

import type { IpcModule } from "../../../electron/runtime/ipc/types"
import {
  voiceSessionSignInputSchema,
  voiceSettingsPatchSchema,
  voiceSettingsViewSchema,
  voiceSignedSessionSchema,
} from "../shared/schema"
import type { VoiceService } from "./service"

function resolveVoiceService(ctx: Parameters<IpcModule["methods"][string]["handler"]>[0]): VoiceService {
  return ctx.resolve<VoiceService>("core.voice")
}

export const voiceIpcModule: IpcModule = {
  id: "voice",
  methods: {
    getSettings: {
      operationId: "app.voice.settings.get",
      kind: "invoke",
      request: z.void(),
      response: voiceSettingsViewSchema,
      handler: (ctx) => resolveVoiceService(ctx).getSettings(),
    },
    updateSettings: {
      operationId: "app.voice.settings.update",
      kind: "invoke",
      request: voiceSettingsPatchSchema,
      response: voiceSettingsViewSchema,
      handler: (ctx, request: z.infer<typeof voiceSettingsPatchSchema>) =>
        resolveVoiceService(ctx).updateSettings(request),
    },
    signSession: {
      operationId: "app.voice.session.sign",
      kind: "invoke",
      request: voiceSessionSignInputSchema,
      response: voiceSignedSessionSchema,
      handler: (ctx, request: z.infer<typeof voiceSessionSignInputSchema>) =>
        resolveVoiceService(ctx).signSession(request),
    },
  },
  events: {},
}
