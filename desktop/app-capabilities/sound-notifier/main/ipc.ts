import { z } from "zod"

import type { IpcModule } from "../../../electron/runtime/ipc/types"
import type { SoundNotifierService } from "./service"
import {
  soundNotifierChangedEventSchema,
  soundNotifierPlayInputSchema,
  soundNotifierPlayRequestedEventSchema,
  soundNotifierPlayResultSchema,
  soundNotifierSettingsPatchSchema,
  soundNotifierSettingsSchema,
} from "../shared/schema"

function resolveSoundNotifierService(ctx: Parameters<IpcModule["methods"][string]["handler"]>[0]): SoundNotifierService {
  return ctx.resolve<SoundNotifierService>("core.sound-notifier")
}

export const soundNotifierIpcModule: IpcModule = {
  id: "soundNotifier",
  methods: {
    getSettings: {
      operationId: "app.sound_notifier.settings.get",
      kind: "invoke",
      request: z.void(),
      response: soundNotifierSettingsSchema,
      handler: (ctx) => resolveSoundNotifierService(ctx).getSettings(),
    },
    updateSettings: {
      operationId: "app.sound_notifier.settings.update",
      kind: "invoke",
      request: soundNotifierSettingsPatchSchema,
      response: soundNotifierSettingsSchema,
      handler: (ctx, request: z.infer<typeof soundNotifierSettingsPatchSchema>) =>
        resolveSoundNotifierService(ctx).updateSettings(request),
    },
    play: {
      operationId: "app.sound_notifier.sound.play",
      kind: "invoke",
      request: soundNotifierPlayInputSchema,
      response: soundNotifierPlayResultSchema,
      handler: (ctx, request: z.infer<typeof soundNotifierPlayInputSchema>) =>
        resolveSoundNotifierService(ctx).play(request),
    },
    preview: {
      operationId: "app.sound_notifier.sound.preview",
      kind: "invoke",
      request: soundNotifierPlayInputSchema,
      response: soundNotifierPlayResultSchema,
      handler: (ctx, request: z.infer<typeof soundNotifierPlayInputSchema>) =>
        resolveSoundNotifierService(ctx).preview(request),
    },
  },
  events: {
    changed: {
      operationId: "app.sound_notifier.operation.changed",
      kind: "event",
      payload: soundNotifierChangedEventSchema,
    },
    playRequested: {
      operationId: "app.sound_notifier.operation.play_requested",
      kind: "event",
      payload: soundNotifierPlayRequestedEventSchema,
    },
  },
}
