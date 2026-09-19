import type {
  MeetingDetailDto,
  MeetingFinalizeInput,
  MeetingSummaryDto,
} from "@synapse/shared" with { "resolution-mode": "import" }

/**
 * preload bridge 上会议记录这一域的返回形状。
 *
 * 服务端返回的 DTO 直接复用 `@synapse/shared` 里的定义：三端读同一份，字段改名时
 * 编译期就会报出来，不用等运行时。
 */
export type SynapseMeetingSummary = MeetingSummaryDto
export type SynapseMeetingDetail = MeetingDetailDto
export type SynapseMeetingFinalizeInput = MeetingFinalizeInput

export type SynapseMeetingRecordingStart = {
  readonly meetingId: string
  readonly recordingId: string
  readonly uploadId: string
  readonly title: string
}

export type SynapseMeetingPendingRecording = {
  readonly meetingId: string
  readonly recordingId: string
  readonly title: string
  readonly receivedBytes: number
  readonly startedAt: string
} | null

export type SynapseMeetingSpooledPart = {
  readonly partNumber: number
  readonly bytes: Uint8Array
}

/** 转写收尾时从主进程推过来的一条应用内事件。 */
export type SynapseMeetingTranscriptionCompletedEvent = {
  readonly meetingId: string
  readonly title: string
  readonly status: "done" | "failed"
}
