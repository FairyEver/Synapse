import { z } from "zod"

import type { IpcModule } from "../../../electron/runtime/ipc/types"
import type { WindowManager } from "../../../electron/runtime/window"
import type { SoundNotifierService } from "./service"
import {
  soundNotifierChangedEventSchema,
  soundNotifierPlayInputSchema,
  soundNotifierPlayRequestedEventSchema,
  soundNotifierPlayResultSchema,
  soundNotifierSettingsPatchSchema,
  soundNotifierSettingsSchema,
} from "../shared/schema"

const soundNotifierEventWiredServices = new WeakSet<SoundNotifierService>()

function resolveSoundNotifierService(ctx: Parameters<IpcModule["methods"][string]["handler"]>[0]): SoundNotifierService {
  const service = ctx.resolve<SoundNotifierService>("core.sound-notifier")
  wireSoundNotifierEvents(ctx, service)
  return service
}

function wireSoundNotifierEvents(
  ctx: Parameters<IpcModule["methods"][string]["handler"]>[0],
  service: SoundNotifierService,
): void {
  if (soundNotifierEventWiredServices.has(service)) return

  const windowManager = ctx.resolve<WindowManager>("core.window-manager")
  service.events.on("changed", (payload) => {
    windowManager.broadcast(soundNotifierIpcModule.events.changed.channel, payload)
  })
  service.events.on("playRequested", (payload) => {
    windowManager.broadcast(soundNotifierIpcModule.events.playRequested.channel, payload)
  })
  soundNotifierEventWiredServices.add(service)
}

export const soundNotifierIpcModule: IpcModule = {
  id: "soundNotifier",
  methods: {
    getSettings: {
      channel: "synapse:sound-notifier:settings:get",
      kind: "invoke",
      request: z.void(),
      response: soundNotifierSettingsSchema,
      handler: (ctx) => resolveSoundNotifierService(ctx).getSettings(),
    },
    updateSettings: {
      channel: "synapse:sound-notifier:settings:update",
      kind: "invoke",
      request: soundNotifierSettingsPatchSchema,
      response: soundNotifierSettingsSchema,
      handler: (ctx, request: z.infer<typeof soundNotifierSettingsPatchSchema>) =>
        resolveSoundNotifierService(ctx).updateSettings(request),
    },
    play: {
      channel: "synapse:sound-notifier:play",
      kind: "invoke",
      request: soundNotifierPlayInputSchema,
      response: soundNotifierPlayResultSchema,
      handler: (ctx, request: z.infer<typeof soundNotifierPlayInputSchema>) =>
        resolveSoundNotifierService(ctx).play(request),
    },
    preview: {
      channel: "synapse:sound-notifier:preview",
      kind: "invoke",
      request: soundNotifierPlayInputSchema,
      response: soundNotifierPlayResultSchema,
      handler: (ctx, request: z.infer<typeof soundNotifierPlayInputSchema>) =>
        resolveSoundNotifierService(ctx).preview(request),
    },
  },
  events: {
    changed: {
      channel: "synapse:sound-notifier:changed",
      kind: "event",
      payload: soundNotifierChangedEventSchema,
    },
    playRequested: {
      channel: "synapse:sound-notifier:play-requested",
      kind: "event",
      payload: soundNotifierPlayRequestedEventSchema,
    },
  },
}
