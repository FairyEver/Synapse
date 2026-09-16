import { z } from "zod"

import type { IpcModule } from "../../../electron/runtime/ipc/types"
import {
  voiceSessionSignInputSchema,
  voiceSignedSessionSchema,
  voiceStatusSchema,
} from "../shared/schema"
import type { VoiceService } from "./service"

function resolveVoiceService(ctx: Parameters<IpcModule["methods"][string]["handler"]>[0]): VoiceService {
  return ctx.resolve<VoiceService>("core.voice")
}

export const voiceIpcModule: IpcModule = {
  id: "voice",
  methods: {
    getStatus: {
      operationId: "app.voice.status.get",
      kind: "invoke",
      request: z.void(),
      response: voiceStatusSchema,
      handler: (ctx) => resolveVoiceService(ctx).getStatus(),
    },
    signSession: {
      operationId: "app.voice.session.sign",
      kind: "invoke",
      request: voiceSessionSignInputSchema,
      response: voiceSignedSessionSchema,
      handler: (ctx, request: z.infer<typeof voiceSessionSignInputSchema>) => {
        void request
        return resolveVoiceService(ctx).signSession()
      },
    },
  },
  events: {},
}
