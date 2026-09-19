import type {
  MeetingDetailDto,
  MeetingFinalizeInput,
  MeetingSummaryDto,
} from "@synapse/shared" with { "resolution-mode": "import" }

/**
 * preload bridge 上录音这一域的返回形状。
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

/** 转写收尾时从主进程推过来的一条应用内事件。 */
export type SynapseMeetingTranscriptionCompletedEvent = {
  readonly meetingId: string
  readonly title: string
  readonly status: "done" | "failed"
}

/**
 * 音频落到本机时推过来的一条应用内事件。
 *
 * 缓存自己不吭声（界面上不出现任何缓存的痕迹），这条事件只在主进程和渲染进程之间传：
 * 下载完成时把播放地址换成刚落地的那份本机文件。
 */
export type SynapseMeetingAudioReadyEvent = {
  readonly meetingId: string
  readonly url: string
}

/** `app.meeting.audio.ensure` 的返回。 */
export type SynapseMeetingAudioEnsureResult =
  | { readonly state: "ready"; readonly url: string }
  | { readonly state: "downloading" }
  | { readonly state: "unavailable" }
