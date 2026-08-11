import type {
  SynapseAgentEvent,
  SynapseAgentErrorKind,
  SynapseAgentImageArtifact,
  SynapseAgentMainThreadPersonaMetadata,
  SynapseAgentMessageTimelineItem,
  SynapseAgentResultMetadata,
  SynapseAgentTimelineItem,
  SynapseAgentToolProgressTimelineItem,
  SynapseAgentTurnOutcome,
  SynapseAgentUserQuestion,
  SynapseAgentUserQuestionResolution,
} from "../types/agent"

type TimelineRecordRole = "user" | "assistant" | "system" | "tool"

export type AgentHistoryRecord = {
  readonly role: TimelineRecordRole
  readonly content: string
  readonly timestamp: string
  readonly metadata?: Record<string, unknown>
}

type TimelineItemContext = {
  readonly id: string
  readonly timestamp: string
  readonly agentType?: string
}

export function agentEventToTimelineItem(
  event: SynapseAgentEvent,
  context: TimelineItemContext,
): SynapseAgentTimelineItem {
  const base = {
    id: context.id,
    timestamp: context.timestamp,
    agentType: context.agentType,
    sdkSessionId: event.sdkSessionId,
    agentSessionId: event.agentSessionId,
    threadId: event.threadId,
  }
  switch (event.type) {
    case "text":
      return { ...base, kind: "message", role: "assistant", content: event.content }
    case "stream": {
      const thinking = streamThinking(event)
      return thinking
        ? {
            ...base,
            kind: "thinking",
            content: thinking,
            streaming: true,
            ...(typeof event.blockIndex === "number" ? { streamBlockIndex: event.blockIndex } : {}),
          }
        : {
            ...base,
            kind: "message",
            role: "assistant",
            content: streamText(event),
            streaming: true,
          }
    }
    case "assistant":
      return { ...base, kind: "message", role: "assistant", content: assistantText(event) }
    case "thinking":
      return { ...base, kind: "thinking", content: event.content }
    case "toolUse":
      return {
        ...base,
        kind: "toolCall",
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        toolInput: event.toolInput,
        toolInputRaw: event.toolInputRaw,
      }
    case "toolResult":
      return {
        ...base,
        kind: "toolResult",
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        content: event.content,
        contentDiagnostics: event.contentDiagnostics,
        imageArtifacts: event.imageArtifacts,
        status: event.status,
        exitCode: event.exitCode,
        success: event.success,
      }
    case "permissionRequest":
      return {
        ...base,
        kind: "permissionRequest",
        requestId: event.requestId,
        toolName: event.toolName,
        toolInput: event.toolInput,
        toolInputRaw: event.toolInputRaw,
        questions: event.questions,
        blockedPath: event.blockedPath,
        sessionDirectoryGrantAvailable: event.sessionDirectoryGrantAvailable,
      }
    case "result":
      return {
        ...base,
        kind: "result",
        content: event.content,
        metadata: resultMetadata(event),
      }
    case "error":
      return {
        ...base,
        kind: "error",
        message: event.message,
        errorKind: event.errorKind,
        recoverable: event.recoverable,
        turnOutcome: event.turnOutcome,
      }
    case "sessionInit":
      return {
        ...base,
        kind: "sdkEvent",
        sdkType: "sessionInit",
        label: "SDK event",
        summary: event.model ?? event.tools?.join(", "),
      }
    case "status":
      return {
        ...base,
        kind: "sdkEvent",
        sdkType: "status",
        label: "SDK event",
        summary: event.message ?? event.status ?? undefined,
      }
    case "compactBoundary":
      return {
        ...base,
        kind: "sdkEvent",
        sdkType: "compactBoundary",
        label: "SDK event",
        summary: "compact boundary",
      }
    case "sdkEvent":
      if (event.sdkType === "nativeSlashPassthrough") {
        return {
          ...base,
          kind: "sdkEvent",
          sdkType: event.sdkType,
          sdkSubtype: event.sdkSubtype,
          label: "Native slash",
          summary: event.sdkSubtype,
        }
      }
      return {
        ...base,
        kind: "sdkEvent",
        sdkType: event.sdkType,
        sdkSubtype: event.sdkSubtype,
        label: "SDK event",
      }
    default: {
      const exhaustive: never = event
      return exhaustive
    }
  }
}

export function historyRecordToTimelineItem(
  sessionId: string,
  entry: AgentHistoryRecord,
  index: number,
  agentType?: string,
): SynapseAgentTimelineItem {
  const metadata = entry.metadata
  const base = {
    id: `${sessionId}:history:${index}`,
    timestamp: entry.timestamp,
    agentType,
    sdkSessionId: stringMetadata(metadata, "sdkSessionId"),
    agentSessionId: stringMetadata(metadata, "agentSessionId"),
    threadId: stringMetadata(metadata, "threadId"),
  }
  const storedMetadata = storedResultMetadata(metadata)
  switch (stringMetadata(metadata, "agentEventType")) {
    case "toolUse":
      return {
        ...base,
        kind: "toolCall",
        toolUseId: stringMetadata(metadata, "toolUseId"),
        toolName: stringMetadata(metadata, "toolName") ?? firstLine(entry.content),
        toolInput: entry.content.includes("\n") ? entry.content.slice(entry.content.indexOf("\n") + 1) : undefined,
        toolInputRaw: recordMetadata(metadata, "toolInputRaw"),
      }
    case "toolResult":
      return {
        ...base,
        kind: "toolResult",
        toolUseId: stringMetadata(metadata, "toolUseId"),
        toolName: stringMetadata(metadata, "toolName") ?? "tool",
        content: entry.content,
        imageArtifacts: imageArtifactsMetadata(metadata, "imageArtifacts"),
        status: stringMetadata(metadata, "status"),
        exitCode: numberMetadata(metadata, "exitCode"),
        success: booleanMetadata(metadata, "success"),
      }
    case "thinking": {
      const startedAt = stringMetadata(metadata, "startedAt")
      return { ...base, kind: "thinking", content: entry.content, ...(startedAt ? { startedAt } : {}) }
    }
    case "permissionRequest":
      return {
        ...base,
        kind: "permissionRequest",
        requestId: stringMetadata(metadata, "requestId") ?? `${sessionId}:permission:${index}`,
        toolName: stringMetadata(metadata, "toolName") ?? firstLine(entry.content),
        toolInput: entry.content.includes("\n") ? entry.content.slice(entry.content.indexOf("\n") + 1) : undefined,
        toolInputRaw: recordMetadata(metadata, "toolInputRaw"),
        questions: questionsMetadata(metadata, "questions"),
        blockedPath: stringMetadata(metadata, "blockedPath"),
        sessionDirectoryGrantAvailable: booleanMetadata(metadata, "sessionDirectoryGrantAvailable"),
        resolution: userQuestionResolutionMetadata(metadata, "userQuestionResolution"),
        resolutionAttempt: userQuestionResolutionMetadata(metadata, "userQuestionResolutionAttempt"),
      }
    case "error":
      return {
        ...base,
        kind: "error",
        message: entry.content,
        errorKind: errorKindMetadata(metadata, "errorKind"),
        recoverable: booleanMetadata(metadata, "recoverable"),
        turnOutcome: turnOutcomeMetadata(metadata, "turnOutcome"),
      }
    case "result":
      return {
        ...base,
        kind: "result",
        content: entry.content,
        metadata: storedMetadata,
      }
    case "sdkEvent":
      return {
        ...base,
        kind: "sdkEvent",
        sdkType: stringMetadata(metadata, "sdkType") ?? "sdkEvent",
        sdkSubtype: stringMetadata(metadata, "sdkSubtype"),
        label: stringMetadata(metadata, "sdkType") === "nativeSlashPassthrough" ? "Native slash" : "SDK event",
        summary: stringMetadata(metadata, "sdkSubtype"),
      }
    default:
      return {
        ...base,
        kind: "message",
        role: entry.role,
        content: entry.content,
        legacy: entry.role === "tool" || entry.role === "system",
        ...(storedMetadata ? { metadata: storedMetadata } : {}),
      }
  }
}

export function appendAgentTimelineEvent(
  current: readonly SynapseAgentTimelineItem[],
  event: SynapseAgentEvent,
  timestamp: string,
  agentType?: string,
): SynapseAgentTimelineItem[] {
  if (event.type === "assistant" || event.type === "result" || event.type === "error") {
    const completedThinking = completeStreamingThinking(current, timestamp)
    if (completedThinking) {
      return appendAgentTimelineEvent(completedThinking, event, timestamp, agentType)
    }
  }
  const item = agentEventToTimelineItem(event, {
    id: `event:${timestamp}:${event.type}:${current.length}`,
    timestamp,
    agentType,
  })
  const last = current.at(-1)
  if (event.type === "stream") {
    const streamCurrent = stringValue(event.event?.type) === "content_block_stop"
      ? completeStreamingThinking(current, timestamp, event.blockIndex) ?? current
      : current
    const toolProgress = toolProgressFromStreamEvent(event, item, timestamp)
    if (toolProgress) return appendToolProgress(streamCurrent, toolProgress, event, timestamp)

    const kind = streamKind(event)
    if (kind === "text" && item.kind === "message") {
      if (item.content.length === 0) return [...streamCurrent]
      const assistantIndex = latestAssistantDraftIndex(streamCurrent)
      if (assistantIndex !== -1) {
        const assistant = streamCurrent[assistantIndex]
        if (assistant.kind === "message" && assistant.role === "assistant") {
          return [
            ...streamCurrent.slice(0, assistantIndex),
            { ...assistant, content: `${assistant.content}${item.content}`, timestamp, streaming: true },
            ...streamCurrent.slice(assistantIndex + 1),
          ]
        }
      }
      return [...streamCurrent, item]
    }

    if (kind === "thinking" && item.kind === "thinking") {
      if (item.content.length === 0) return [...streamCurrent]
      const thinkingIndex = latestThinkingDraftIndex(streamCurrent, event.blockIndex)
      if (thinkingIndex !== -1) {
        const thinking = streamCurrent[thinkingIndex]
        if (thinking.kind === "thinking") {
          return [
            ...streamCurrent.slice(0, thinkingIndex),
            {
              ...thinking,
              content: `${thinking.content}${item.content}`,
              startedAt: thinking.startedAt ?? thinking.timestamp,
              timestamp,
              streaming: true,
              ...(thinking.streamBlockIndex === undefined && typeof event.blockIndex === "number"
                ? { streamBlockIndex: event.blockIndex }
                : {}),
            },
            ...streamCurrent.slice(thinkingIndex + 1),
          ]
        }
      }
      return [...streamCurrent, { ...item, startedAt: timestamp, streaming: true }]
    }

    return [...streamCurrent]
  }
  if (isEmptyTimelineItem(item)) return [...current]
  if (event.type === "toolUse" && item.kind === "toolCall") {
    const progressIndex = matchingToolProgressIndex(current, item)
    if (progressIndex !== -1) {
      const progress = current[progressIndex]
      const startedAt = progress?.kind === "toolProgress"
        ? progress.startedAt ?? progress.timestamp
        : undefined
      return [
        ...current.slice(0, progressIndex),
        { ...item, ...(startedAt ? { startedAt } : {}) },
        ...current.slice(progressIndex + 1),
      ]
    }
  }
  if (event.type === "error") {
    const withStoppedProgress = markInFlightToolProgressStopped(current, timestamp)
    return [...withStoppedProgress, item]
  }
  if (event.type === "text" && item.kind === "message" && last?.kind === "message" && last.role === "assistant") {
    return [...current.slice(0, -1), { ...last, content: `${last.content}${item.content}`, timestamp }]
  }
  if (event.type === "assistant" && item.kind === "message" && last?.kind === "message" && last.role === "assistant") {
    if (isStreamedAssistantDraft(last)) {
      return [...current.slice(0, -1), { ...last, content: item.content, timestamp, streaming: false }]
    }
    if (last.content === item.content) return [...current]
    if (item.content.startsWith(last.content)) {
      return [...current.slice(0, -1), { ...last, content: item.content, timestamp }]
    }
    return [...current, item]
  }
  if (event.type === "assistant" && item.kind === "message") {
    const assistantIndex = latestAssistantDraftForFinalIndex(current)
    const assistant = assistantIndex === -1 ? undefined : current[assistantIndex]
    if (assistant?.kind === "message" && assistant.role === "assistant") {
      return [
        ...current.slice(0, assistantIndex),
        { ...assistant, content: item.content, timestamp, streaming: false },
        ...current.slice(assistantIndex + 1),
      ]
    }
    const latestAssistantIndex = latestAssistantMessageIndex(current)
    const latestAssistant = latestAssistantIndex === -1 ? undefined : current[latestAssistantIndex]
    if (latestAssistant?.kind === "message" && latestAssistant.role === "assistant" && latestAssistant.content === item.content) {
      return [...current]
    }
    return [...current, item]
  }
  if (event.type === "result" && last?.kind === "message" && last.role === "assistant") {
    const next = mergeResultIntoAssistantMessage(last, event, timestamp)
    return next === last ? [...current] : [...current.slice(0, -1), next]
  }
  if (event.type === "result") {
    const assistantIndex = latestAssistantMessageIndex(current)
    const assistant = assistantIndex === -1 ? undefined : current[assistantIndex]
    if (assistant?.kind === "message" && assistant.role === "assistant") {
      const next = mergeResultIntoAssistantMessage(assistant, event, timestamp)
      return next !== assistant
        ? [
            ...current.slice(0, assistantIndex),
            next,
            ...current.slice(assistantIndex + 1),
          ]
        : [...current]
    }
  }
  if (item.kind === "result" && item.content.trim().length === 0) return [...current]
  if (item.kind === "result") {
    return [...current, {
      id: item.id,
      kind: "message" as const,
      role: "assistant" as const,
      content: item.content,
      timestamp: item.timestamp,
      agentType: item.agentType,
      sdkSessionId: item.sdkSessionId,
      agentSessionId: item.agentSessionId,
      threadId: item.threadId,
      metadata: item.metadata,
    }]
  }
  return [...current, item]
}

function toolProgressFromStreamEvent(
  event: Extract<SynapseAgentEvent, { type: "stream" }>,
  item: SynapseAgentTimelineItem,
  timestamp: string,
): SynapseAgentToolProgressTimelineItem | null {
  const eventType = stringValue(event.event?.type)
  const contentBlock = recordValue(event.event?.content_block)
  const isToolStart = eventType === "content_block_start" && stringValue(contentBlock?.type) === "tool_use"
  const isToolInput = event.deltaType === "input_json_delta"
  if (!isToolStart && !isToolInput && eventType !== "content_block_stop") return null
  const toolName = event.toolName ?? stringValue(contentBlock?.name)
  const toolUseId = event.toolUseId ?? stringValue(contentBlock?.id)
  return {
    id: `event:${timestamp}:toolProgress:${event.blockIndex ?? "unknown"}`,
    kind: "toolProgress",
    timestamp,
    agentType: item.agentType,
    sdkSessionId: item.sdkSessionId,
    agentSessionId: item.agentSessionId,
    threadId: item.threadId,
    ...(toolUseId ? { toolUseId } : {}),
    toolName: toolName ?? "工具",
    ...(typeof event.blockIndex === "number" ? { blockIndex: event.blockIndex } : {}),
    inputCharCount: isToolInput ? toolInputDeltaLength(event) : 0,
    status: "preparing",
    startedAt: timestamp,
  }
}

function appendToolProgress(
  current: readonly SynapseAgentTimelineItem[],
  progress: SynapseAgentToolProgressTimelineItem,
  event: Extract<SynapseAgentEvent, { type: "stream" }>,
  timestamp: string,
): SynapseAgentTimelineItem[] {
  if (stringValue(event.event?.type) === "content_block_stop") {
    const progressIndex = matchingToolProgressIndex(current, progress)
    if (progressIndex === -1) return [...current]
    return [...current.slice(0, progressIndex), ...current.slice(progressIndex + 1)]
  }
  const progressIndex = matchingToolProgressIndex(current, progress)
  if (progressIndex === -1) return [...current, progress]
  const existing = current[progressIndex]
  if (existing?.kind !== "toolProgress") return [...current]
  const next: SynapseAgentToolProgressTimelineItem = {
    ...existing,
    timestamp,
    ...(!existing.toolUseId && progress.toolUseId ? { toolUseId: progress.toolUseId } : {}),
    toolName: existing.toolName === "工具" ? progress.toolName : existing.toolName,
    inputCharCount: existing.inputCharCount + progress.inputCharCount,
    status: "preparing",
  }
  return [
    ...current.slice(0, progressIndex),
    next,
    ...current.slice(progressIndex + 1),
  ]
}

function toolInputDeltaLength(event: Extract<SynapseAgentEvent, { type: "stream" }>): number {
  if (typeof event.inputJsonDeltaLength === "number") return Math.max(0, event.inputJsonDeltaLength)
  return Math.max(0, event.partialJson?.length ?? 0)
}

function markInFlightToolProgressStopped(
  current: readonly SynapseAgentTimelineItem[],
  timestamp: string,
): SynapseAgentTimelineItem[] {
  const progressIndex = latestInFlightToolProgressIndex(current)
  if (progressIndex === -1) return [...current]
  const progress = current[progressIndex]
  if (progress?.kind !== "toolProgress" || progress.status !== "preparing") return [...current]
  return [
    ...current.slice(0, progressIndex),
    { ...progress, status: "stopped" as const, timestamp },
    ...current.slice(progressIndex + 1),
  ]
}

function matchingToolProgressIndex(
  items: readonly SynapseAgentTimelineItem[],
  target: { readonly toolUseId?: string; readonly blockIndex?: number },
): number {
  if (target.toolUseId) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index]
      if (item?.kind === "toolProgress" && item.toolUseId === target.toolUseId) return index
    }
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.kind !== "toolProgress" || item.status !== "preparing") continue
    if (target.toolUseId && item.toolUseId) continue
    if (typeof target.blockIndex === "number" && item.blockIndex === target.blockIndex) return index
  }
  return -1
}

function latestInFlightToolProgressIndex(items: readonly SynapseAgentTimelineItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.kind === "toolProgress" && item.status === "preparing") return index
    if (item?.kind === "toolCall" || item?.kind === "toolResult" || (item?.kind === "message" && item.role === "user")) {
      return -1
    }
  }
  return -1
}

function latestAssistantMessageIndex(items: readonly SynapseAgentTimelineItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.kind === "message" && item.role === "assistant") return index
    if (item && isTimelineMergeBoundary(item)) return -1
    if (item?.kind === "message" && item.role === "user") return -1
  }
  return -1
}

function latestAssistantDraftIndex(items: readonly SynapseAgentTimelineItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.kind === "message" && item.role === "assistant" && isStreamedAssistantDraft(item)) return index
    if (item?.kind === "thinking") return -1
    if (item && isTimelineMergeBoundary(item)) return -1
    if (item?.kind === "message" && item.role === "user") return -1
  }
  return -1
}

function latestAssistantDraftForFinalIndex(items: readonly SynapseAgentTimelineItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.kind === "message" && item.role === "assistant" && isStreamedAssistantDraft(item)) return index
    if (item && isTimelineMergeBoundary(item)) return -1
    if (item?.kind === "message" && item.role === "user") return -1
  }
  return -1
}

function latestThinkingDraftIndex(
  items: readonly SynapseAgentTimelineItem[],
  blockIndex: number | undefined,
): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (
      item?.kind === "thinking"
      && (item.streaming === true || (item.streaming !== false && item.id.includes(":stream:")))
      && (blockIndex === undefined || item.streamBlockIndex === undefined || item.streamBlockIndex === blockIndex)
    ) return index
    if (item?.kind === "message" && item.role === "assistant") return -1
    if (item && isTimelineMergeBoundary(item)) return -1
    if (item?.kind === "message" && item.role === "user") return -1
  }
  return -1
}

function completeStreamingThinking(
  items: readonly SynapseAgentTimelineItem[],
  timestamp: string,
  blockIndex?: number,
): SynapseAgentTimelineItem[] | undefined {
  let changed = false
  const next = items.map((item) => {
    if (
      item.kind !== "thinking"
      || item.streaming !== true
      || (blockIndex !== undefined && item.streamBlockIndex !== undefined && item.streamBlockIndex !== blockIndex)
    ) return item
    changed = true
    return { ...item, streaming: false, timestamp }
  })
  return changed ? next : undefined
}

function isStreamedAssistantDraft(item: SynapseAgentTimelineItem): boolean {
  return item.kind === "message"
    && item.role === "assistant"
    && (item.streaming === true || (item.streaming !== false && item.id.includes(":stream:")))
}

function isTimelineMergeBoundary(item: SynapseAgentTimelineItem): boolean {
  return item.kind === "toolCall"
    || item.kind === "toolResult"
    || item.kind === "permissionRequest"
    || item.kind === "toolProgress"
    || item.kind === "error"
    || item.kind === "result"
}

export function localUserTimelineItem(
  content: string,
  timestamp: string,
  index: number,
): SynapseAgentTimelineItem {
  return {
    id: `local:${timestamp}:user:${index}`,
    kind: "message",
    role: "user",
    content,
    timestamp,
  }
}

function isEmptyTimelineItem(item: SynapseAgentTimelineItem): boolean {
  if (item.kind === "message") return item.content.trim().length === 0
  if (item.kind === "thinking") return item.content.trim().length === 0
  if (item.kind === "error") return item.message.trim().length === 0
  return false
}

function firstLine(value: string): string {
  return value.split("\n", 1)[0]?.trim() || "tool"
}

function stringMetadata(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key]
  return typeof value === "string" ? value : undefined
}

function numberMetadata(metadata: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = metadata?.[key]
  return typeof value === "number" ? value : undefined
}

function booleanMetadata(metadata: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = metadata?.[key]
  return typeof value === "boolean" ? value : undefined
}

function recordMetadata(metadata: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = metadata?.[key]
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function questionsMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
): SynapseAgentUserQuestion[] | undefined {
  const value = metadata?.[key]
  if (!Array.isArray(value)) return undefined
  const questions: SynapseAgentUserQuestion[] = []
  for (const item of value) {
    const record = item && typeof item === "object" && !Array.isArray(item)
      ? item as Record<string, unknown>
      : undefined
    const question = typeof record?.question === "string" ? record.question : undefined
    const rawOptions = Array.isArray(record?.options) ? record.options : undefined
    if (!question || !rawOptions) return undefined
    const options = rawOptions.map((rawOption) => {
      const option = rawOption && typeof rawOption === "object" && !Array.isArray(rawOption)
        ? rawOption as Record<string, unknown>
        : undefined
      const label = typeof option?.label === "string" ? option.label : undefined
      if (!label) return undefined
      const description = typeof option?.description === "string" ? option.description : undefined
      return {
        label,
        ...(description ? { description } : {}),
      }
    })
    if (options.some((option) => !option)) return undefined
    const header = typeof record?.header === "string" ? record.header : undefined
    const id = stringMetadata(record, "id")
    const key = stringMetadata(record, "key")
    questions.push({
      ...(id ? { id } : {}),
      ...(key ? { key } : {}),
      question,
      ...(header ? { header } : {}),
      options: options as SynapseAgentUserQuestion["options"],
      multiSelect: typeof record?.multiSelect === "boolean" ? record.multiSelect : false,
    })
  }
  return questions.length > 0 ? questions : undefined
}

function userQuestionResolutionMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
): SynapseAgentUserQuestionResolution | undefined {
  const value = metadata?.[key]
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const status = record.status
  const resolvedAt = record.resolvedAt
  if (
    status !== "answered"
    && status !== "skipped"
    && status !== "timed_out"
    && status !== "cancelled"
  ) return undefined
  if (typeof resolvedAt !== "string") return undefined
  const rawAnswers = record.answers
  if (rawAnswers !== undefined && !Array.isArray(rawAnswers)) return undefined
  const answers = rawAnswers?.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return undefined
    const answer = item as Record<string, unknown>
    if (!Number.isInteger(answer.questionIndex) || (answer.questionIndex as number) < 0) return undefined
    if (!Array.isArray(answer.values) || answer.values.some((entry) => typeof entry !== "string")) return undefined
    return {
      questionIndex: answer.questionIndex as number,
      values: answer.values as string[],
    }
  })
  if (answers?.some((answer) => !answer)) return undefined
  return {
    status,
    resolvedAt,
    ...(answers ? { answers: answers as SynapseAgentUserQuestionResolution["answers"] } : {}),
  }
}

function imageArtifactsMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
): readonly SynapseAgentImageArtifact[] | undefined {
  const value = metadata?.[key]
  if (!Array.isArray(value)) return undefined
  const artifacts = value.filter((item): item is SynapseAgentImageArtifact => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false
    const record = item as Record<string, unknown>
    return record.kind === "image"
      && typeof record.id === "string"
      && typeof record.mimeType === "string"
      && typeof record.byteSize === "number"
      && typeof record.url === "string"
  })
  return artifacts.length > 0 ? artifacts : undefined
}

function storedResultMetadata(metadata: Record<string, unknown> | undefined): SynapseAgentResultMetadata | undefined {
  const result: SynapseAgentResultMetadata = {
    mainThreadPersona: mainThreadPersonaMetadata(metadata),
    model: stringMetadata(metadata, "model"),
    effort: stringMetadata(metadata, "effort"),
    contextRemainingPercent: numberMetadata(metadata, "contextRemainingPercent"),
    workDir: stringMetadata(metadata, "workDir"),
    cancelled: booleanMetadata(metadata, "cancelled"),
    turnOutcome: turnOutcomeMetadata(metadata, "turnOutcome"),
    usage: recordMetadata(metadata, "usage"),
    turnUsage: recordMetadata(metadata, "turnUsage"),
    modelUsage: recordMetadata(metadata, "modelUsage"),
    sdkResultUuid: stringMetadata(metadata, "sdkResultUuid"),
    costUsd: numberMetadata(metadata, "costUsd"),
    costCny: numberMetadata(metadata, "costCny"),
    costBreakdownCny: recordMetadata(metadata, "costBreakdownCny") as Record<string, number> | undefined,
    totalCostUsd: numberMetadata(metadata, "totalCostUsd"),
    totalCostCny: numberMetadata(metadata, "totalCostCny"),
    totalCostBreakdownCny: recordMetadata(metadata, "totalCostBreakdownCny") as Record<string, number> | undefined,
    costCurrency: stringMetadata(metadata, "costCurrency") === "CNY" ? "CNY" : undefined,
    estimatedCost: booleanMetadata(metadata, "estimatedCost"),
  }
  return Object.values(result).some((value) => value !== undefined) ? result : undefined
}

function mainThreadPersonaMetadata(
  metadata: Record<string, unknown> | undefined,
): SynapseAgentMainThreadPersonaMetadata | undefined {
  const value = metadata?.mainThreadPersona
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    typeof record.id !== "string"
    || typeof record.name !== "string"
    || (record.source !== "builtin" && record.source !== "user")
  ) {
    return undefined
  }
  return {
    id: record.id,
    name: record.name,
    source: record.source,
    ...(typeof record.definitionHash === "string" ? { definitionHash: record.definitionHash } : {}),
  }
}

function turnOutcomeMetadata(metadata: Record<string, unknown> | undefined, key: string): SynapseAgentTurnOutcome | undefined {
  const value = metadata?.[key]
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.status !== "string") return undefined
  return record as unknown as SynapseAgentTurnOutcome
}

function resultMetadata(event: Extract<SynapseAgentEvent, { type: "result" }>): SynapseAgentResultMetadata | undefined {
  const usage = event.metadata?.usage ?? event.usage
  const metadata: SynapseAgentResultMetadata = {
    ...event.metadata,
    usage,
    turnUsage: event.metadata?.turnUsage ?? event.usage,
    costUsd: event.metadata?.costUsd ?? event.costUsd,
    costCny: event.metadata?.costCny ?? event.costCny,
    costCurrency: (event.metadata?.costCurrency ?? event.costCurrency) === "CNY" ? "CNY" : undefined,
  }
  return Object.values(metadata).some((value) => value !== undefined) ? metadata : undefined
}

function mergeResultIntoAssistantMessage(
  item: SynapseAgentMessageTimelineItem,
  event: Extract<SynapseAgentEvent, { type: "result" }>,
  timestamp: string,
): SynapseAgentMessageTimelineItem {
  const metadata = resultMetadata(event)
  const content = event.content.trim().length > 0 ? event.content : item.content
  if (!metadata && content === item.content) {
    return item.streaming ? { ...item, streaming: false, timestamp } : item
  }
  return { ...item, content, metadata: metadata ?? item.metadata, timestamp, streaming: false }
}

function assistantText(event: Extract<SynapseAgentEvent, { type: "assistant" }>): string {
  if (typeof event.content === "string") return event.content
  const blocks = event.contentBlocks ?? arrayValue(event.message?.content)
  return textFromBlocks(blocks)
}

function streamText(event: Extract<SynapseAgentEvent, { type: "stream" }>): string {
  if (typeof event.text === "string") return event.text
  const rawEvent = event.event
  const delta = recordValue(rawEvent?.delta)
  if (stringValue(delta?.type) === "text_delta") return stringValue(delta?.text) ?? ""
  return stringValue(delta?.text)
    ?? stringValue(rawEvent?.text)
    ?? ""
}

function streamThinking(event: Extract<SynapseAgentEvent, { type: "stream" }>): string {
  if (typeof event.thinking === "string") return event.thinking
  const delta = recordValue(event.event?.delta)
  if (stringValue(delta?.type) === "thinking_delta") return stringValue(delta?.thinking) ?? ""
  return stringValue(delta?.thinking) ?? ""
}

function streamKind(event: Extract<SynapseAgentEvent, { type: "stream" }>): "text" | "thinking" | "other" {
  if (event.deltaType === "text_delta" || streamText(event).length > 0) return "text"
  if (event.deltaType === "thinking_delta" || streamThinking(event).length > 0) return "thinking"
  return "other"
}

function textFromBlocks(blocks: readonly unknown[] | undefined): string {
  if (!blocks) return ""
  return blocks.map((block) => {
    if (typeof block === "string") return block
    const record = recordValue(block)
    return stringValue(record?.text) ?? ""
  }).join("")
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function errorKindMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
): SynapseAgentErrorKind | undefined {
  const value = stringMetadata(metadata, key)
  return value === "execution_failed"
    || value === "tool_use_interrupted"
    || value === "webfetch_preflight_failed"
    ? value
    : undefined
}
