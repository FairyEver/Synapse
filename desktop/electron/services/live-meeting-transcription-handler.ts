import type { MeetingTranscriptionCompletedPayload } from "@synapse/shared" with { "resolution-mode": "import" }

import type { EventBus } from "../runtime/event-bus"

/**
 * 把「转写完成」这条云端消息转成一条应用内事件。
 *
 * 会议模块本身就在轮询，这条实时消息只是让它当场就知道，而不是等下一次轮询——转写
 * 经常在用户已经切去做别的事之后才跑完。
 */
export class LiveMeetingTranscriptionHandler {
  private readonly eventBus: Pick<EventBus, "emit">

  constructor(deps: { readonly eventBus: Pick<EventBus, "emit"> }) {
    this.eventBus = deps.eventBus
  }

  async handle(payload: MeetingTranscriptionCompletedPayload): Promise<void> {
    this.eventBus.emit({
      domain: "meeting",
      type: "meeting.transcriptionCompleted",
      payload: {
        meetingId: payload.meetingId,
        title: payload.title,
        status: payload.status,
      },
      timestamp: new Date().toISOString(),
    })
  }
}
