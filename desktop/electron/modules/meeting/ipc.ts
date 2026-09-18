import { z } from "zod"

import type { IpcModule } from "../../runtime/ipc/types"
import type { MeetingService } from "./service"

/**
 * 会议记录的 IPC。
 *
 * 分片是**裸字节**：渲染进程直接把 `ArrayBuffer` 交过来，这一层不解析、不封装，原样
 * 转交给服务端代理。用 JSON 包一层会把 1 MB 的音频变成一个巨大的 base64 字符串。
 */

const meetingIdSchema = z.string().min(1).max(64)
const recordingIdSchema = z.string().min(1).max(64)

const startInputSchema = z.object({ title: z.string().trim().max(255).optional() }).strict()

const uploadPartInputSchema = z
  .object({
    recordingId: recordingIdSchema,
    partNumber: z.number().int().min(1).max(10_000),
    bytes: z.instanceof(Uint8Array),
  })
  .strict()

const finalizeInputSchema = z
  .object({
    recordingId: recordingIdSchema,
    durationMs: z.number().int().min(0),
    peaks: z.string(),
    speakerCount: z.number().int().min(0),
  })
  .strict()

const renameInputSchema = z.object({ meetingId: meetingIdSchema, title: z.string().trim().min(1).max(255) }).strict()

const speakerInputSchema = z
  .object({ meetingId: meetingIdSchema, speakerId: z.number().int().min(0), name: z.string().trim().max(64).nullable() })
  .strict()

const minutesTodoSchema = z
  .object({
    id: z.string().min(1).max(64),
    text: z.string().min(1).max(2000),
    owner: z.string().max(64).nullable(),
    due: z.string().max(64).nullable(),
    done: z.boolean(),
  })
  .strict()

const minutesSchema = z
  .object({
    topics: z.array(z.string().max(2000)).max(200),
    conclusions: z.array(z.string().max(2000)).max(200),
    todos: z.array(minutesTodoSchema).max(200),
    editedAt: z.string().nullable(),
  })
  .strict()

const saveMinutesInputSchema = z.object({ meetingId: meetingIdSchema, minutes: minutesSchema }).strict()

const meetingIdInputSchema = z.object({ meetingId: meetingIdSchema }).strict()

function service(ctx: Parameters<IpcModule["methods"][string]["handler"]>[0]): MeetingService {
  return ctx.resolve<MeetingService>("core.meeting")
}

export const meetingIpcModule: IpcModule = {
  id: "meeting",
  methods: {
    startRecording: {
      operationId: "app.meeting.recording.start",
      kind: "invoke",
      request: startInputSchema,
      response: z.any(),
      handler: (ctx, request: z.infer<typeof startInputSchema>) => service(ctx).startRecording(request),
    },
    uploadPart: {
      operationId: "app.meeting.recording.part.upload",
      kind: "invoke",
      request: uploadPartInputSchema,
      response: z.void(),
      handler: async (ctx, request: z.infer<typeof uploadPartInputSchema>) => {
        await service(ctx).uploadPart(request.recordingId, request.partNumber, request.bytes)
      },
    },
    completeRecording: {
      operationId: "app.meeting.recording.complete",
      kind: "invoke",
      request: finalizeInputSchema,
      response: z.void(),
      handler: async (ctx, request: z.infer<typeof finalizeInputSchema>) => {
        await service(ctx).completeRecording(request.recordingId, {
          durationMs: request.durationMs,
          peaks: request.peaks,
          speakerCount: request.speakerCount,
        })
      },
    },
    cancelRecording: {
      operationId: "app.meeting.recording.cancel",
      kind: "invoke",
      request: z.object({ recordingId: recordingIdSchema }).strict(),
      response: z.void(),
      handler: async (ctx, request: { recordingId: string }) => {
        await service(ctx).cancelRecording(request.recordingId)
      },
    },
    findPendingRecording: {
      operationId: "app.meeting.recording.pending.get",
      kind: "invoke",
      request: z.void(),
      response: z.any(),
      handler: (ctx) => service(ctx).findPendingRecording(),
    },
    readSpooledParts: {
      operationId: "app.meeting.recording.spooled_parts.get",
      kind: "invoke",
      request: z.object({ recordingId: recordingIdSchema }).strict(),
      response: z.any(),
      handler: async (ctx, request: { recordingId: string }) => {
        const parts = await service(ctx).readSpooledParts(request.recordingId)
        // 只回编号和字节；渲染进程接着按顺序补传。
        return parts.map((part) => ({ partNumber: part.partNumber, bytes: part.bytes }))
      },
    },
    list: {
      operationId: "app.meeting.entry.list",
      kind: "invoke",
      request: z.void(),
      response: z.any(),
      handler: (ctx) => service(ctx).listMeetings(),
    },
    get: {
      operationId: "app.meeting.entry.get",
      kind: "invoke",
      request: meetingIdInputSchema,
      response: z.any(),
      handler: (ctx, request: z.infer<typeof meetingIdInputSchema>) => service(ctx).getMeeting(request.meetingId),
    },
    rename: {
      operationId: "app.meeting.entry.rename",
      kind: "invoke",
      request: renameInputSchema,
      response: z.void(),
      handler: async (ctx, request: z.infer<typeof renameInputSchema>) => {
        await service(ctx).renameMeeting(request.meetingId, request.title)
      },
    },
    nameSpeaker: {
      operationId: "app.meeting.speaker.name",
      kind: "invoke",
      request: speakerInputSchema,
      response: z.void(),
      handler: async (ctx, request: z.infer<typeof speakerInputSchema>) => {
        await service(ctx).nameSpeaker(request.meetingId, request.speakerId, request.name)
      },
    },
    deleteRecording: {
      operationId: "app.meeting.recording.delete",
      kind: "invoke",
      request: meetingIdInputSchema,
      response: z.void(),
      handler: async (ctx, request: z.infer<typeof meetingIdInputSchema>) => {
        await service(ctx).deleteRecording(request.meetingId)
      },
    },
    retryTranscription: {
      operationId: "app.meeting.transcription.retry",
      kind: "invoke",
      request: meetingIdInputSchema,
      response: z.void(),
      handler: async (ctx, request: z.infer<typeof meetingIdInputSchema>) => {
        await service(ctx).retryTranscription(request.meetingId)
      },
    },
    saveMinutes: {
      operationId: "app.meeting.minutes.save",
      kind: "invoke",
      request: saveMinutesInputSchema,
      response: z.void(),
      handler: async (ctx, request: z.infer<typeof saveMinutesInputSchema>) => {
        await service(ctx).saveMinutes(request.meetingId, request.minutes)
      },
    },
    getPlaybackUrl: {
      operationId: "app.meeting.playback_url.get",
      kind: "invoke",
      request: meetingIdInputSchema,
      response: z.any(),
      handler: (ctx, request: z.infer<typeof meetingIdInputSchema>) => service(ctx).getPlaybackUrl(request.meetingId),
    },
    generateMinutes: {
      operationId: "app.meeting.minutes.generate",
      kind: "invoke",
      request: meetingIdInputSchema,
      response: z.any(),
      handler: (ctx, request: z.infer<typeof meetingIdInputSchema>) => service(ctx).generateMinutes(request.meetingId),
    },
    getPeaks: {
      operationId: "app.meeting.peaks.get",
      kind: "invoke",
      request: meetingIdInputSchema,
      response: z.any(),
      handler: (ctx, request: z.infer<typeof meetingIdInputSchema>) => service(ctx).getPeaks(request.meetingId),
    },
  },
  events: {},
}
