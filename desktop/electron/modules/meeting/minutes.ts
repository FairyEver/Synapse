import type {
  MeetingMinutesDto,
  MeetingSpeakerDto,
  MeetingTranscriptSegmentDto,
  MeetingTodoDto,
} from "@synapse/shared" with { "resolution-mode": "import" }

/**
 * 纪要生成。
 *
 * 复用现有的 Agent 会话能力，不为这件事另写一套模型调用：把逐字稿交给一次性的 Agent
 * 查询，让它整理成议题、结论和待办。**不买腾讯云那项「口语转书面语」增值服务**——
 * 它只支持通用引擎，用不了我们选的会议引擎。
 *
 * 这里只负责「把逐字稿变成一段提示词」和「把返回的文本变成结构」，实际的模型调用由
 * 调用方注入，便于在没有运行时的情况下单测。
 */

export type MeetingMinutesAgentRequest = {
  readonly projectId: string
  readonly prompt: string
  readonly timeoutMs: number
  readonly abortSignal?: AbortSignal
}

export type MeetingMinutesAgentResult = {
  readonly status: string
  readonly summary?: string
  readonly error?: string
}

export type MeetingMinutesGeneratorDeps = {
  readonly sendScheduled: (input: MeetingMinutesAgentRequest) => Promise<MeetingMinutesAgentResult>
  readonly projectId: string
  readonly timeoutMs?: number
  readonly logger?: { warn(message: string, meta?: Record<string, unknown>): void }
}

export type MeetingMinutesInput = {
  readonly title: string
  readonly speakers: readonly MeetingSpeakerDto[]
  readonly segments: readonly MeetingTranscriptSegmentDto[]
}

/** 纪要整理不需要跑太久；卡住就当作失败，别让用户一直等。 */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

/** 逐字稿整段塞进提示词里，但给个上限防止超长会议把请求撑爆。 */
const MAX_PROMPT_CHARS = 120_000

const MAX_ITEMS = 40
const MAX_TEXT_CHARS = 500

function speakerLabel(speakers: readonly MeetingSpeakerDto[], speakerId: number): string {
  const named = speakers.find((speaker) => speaker.speakerId === speakerId)?.name
  return named && named.trim() ? named.trim() : `发言人 ${speakerId + 1}`
}

export function buildMinutesPrompt(input: MeetingMinutesInput): string {
  const lines: string[] = []
  for (const segment of input.segments) {
    lines.push(`${speakerLabel(input.speakers, segment.speakerId)}：${segment.text}`)
  }
  const transcript = lines.join("\n").slice(0, MAX_PROMPT_CHARS)
  return [
    "下面是一场会议的逐字稿。请整理成会议纪要，只输出一个 JSON 对象，不要任何解释文字或 Markdown 代码块。",
    "",
    "字段：",
    '- "topics"：讨论到的议题，字符串数组。',
    '- "conclusions"：达成的结论，字符串数组。',
    '- "todos"：待办，对象数组，每项含 "text"（做什么）、"owner"（负责人姓名，没提到就 null）、"due"（时间，没提到就 null）。',
    "",
    "要求：",
    "- 只写逐字稿里真的出现过的事，不要补充任何没提到的内容。",
    "- 每条一句话，不要写成段落。",
    "- 没有的部分给空数组。",
    "",
    `会议标题：${input.title}`,
    "",
    "逐字稿：",
    transcript,
  ].join("\n")
}

/**
 * 从模型输出里抠出 JSON。
 *
 * 模型经常把结果包在代码块里，或者在前后补一句说明，所以直接 `JSON.parse` 整段文本
 * 是不可靠的；这里按第一个 `{` 到最后一个 `}` 取一段再解析。
 */
export function parseMinutesJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const items: string[] = []
  for (const item of value) {
    if (typeof item !== "string") continue
    const text = item.trim().slice(0, MAX_TEXT_CHARS)
    if (text) items.push(text)
    if (items.length >= MAX_ITEMS) break
  }
  return items
}

function normalizeOwnerOrDue(value: unknown): string | null {
  if (typeof value !== "string") return null
  const text = value.trim().slice(0, 64)
  return text && text !== "null" ? text : null
}

function normalizeTodos(value: unknown): MeetingTodoDto[] {
  if (!Array.isArray(value)) return []
  const todos: MeetingTodoDto[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const record = item as Record<string, unknown>
    const text = typeof record.text === "string" ? record.text.trim().slice(0, MAX_TEXT_CHARS) : ""
    if (!text) continue
    todos.push({
      id: `todo-${todos.length + 1}`,
      text,
      owner: normalizeOwnerOrDue(record.owner),
      due: normalizeOwnerOrDue(record.due),
      done: false,
    })
    if (todos.length >= MAX_ITEMS) break
  }
  return todos
}

export function normalizeMinutes(value: Record<string, unknown>): MeetingMinutesDto {
  return {
    topics: normalizeStringList(value.topics),
    conclusions: normalizeStringList(value.conclusions),
    todos: normalizeTodos(value.todos),
    editedAt: null,
  }
}

export function createMeetingMinutesGenerator(deps: MeetingMinutesGeneratorDeps) {
  async function generate(input: MeetingMinutesInput): Promise<MeetingMinutesDto> {
    if (input.segments.length === 0) throw new Error("这段录音里没有识别到语音。")
    const result = await deps.sendScheduled({
      projectId: deps.projectId,
      prompt: buildMinutesPrompt(input),
      timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })
    if (result.status !== "success" || !result.summary) {
      deps.logger?.warn("Meeting minutes generation failed.", { status: result.status })
      throw new Error(result.error?.trim() || "生成纪要失败。")
    }
    const parsed = parseMinutesJson(result.summary)
    if (!parsed) {
      deps.logger?.warn("Meeting minutes response was not JSON.")
      throw new Error("生成纪要失败。")
    }
    return normalizeMinutes(parsed)
  }

  return { generate }
}

export type MeetingMinutesGenerator = ReturnType<typeof createMeetingMinutesGenerator>
