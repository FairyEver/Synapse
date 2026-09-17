import type { AsrTranscript } from "./asr-transcript"
import type { VoiceFailure } from "./voice-session"

/**
 * 语音界面上的确定键该是什么样子。`none` 是「没进语音界面」，不是「键被藏起来」。
 */
export type VoiceUiAction = "none" | "confirm" | "confirm-disabled" | "retry" | "retry-disabled"

export interface VoiceInputPresentation {
  /** 是否进入语音界面（转写区 + ✗/✓）。失败态也算：提示要落在常驻的输入栏上。 */
  readonly active: boolean
  /** 输入框的占位。空串表示不放占位。 */
  readonly placeholder: string
  /** 插入点只在有内容时出现，它是落点不是装饰。 */
  readonly caretVisible: boolean
  readonly action: VoiceUiAction
}

/**
 * 失败时给用户看的东西。`permission` 只留一句 —— 占位是单行的，放不下操作指引，
 * 而且占位也不是写操作指引的地方。
 */
const FAILURE_TEXT: Record<VoiceFailure, string> = {
  network: "网络已断开",
  silence: "没有听到声音",
  permission: "麦克风权限未开启",
  unavailable: "语音输入不可用",
}

/**
 * 换一条签名就能接着说的失败才值得给重试。
 *
 * `permission` 和 `unavailable` 都置灰：它们要在这次会话之外先被解决（去系统设置里
 * 授权、去平台上配密钥），原地再点一次不会变。麦克风入口就在旁边，解决问题之后
 * 重新点它即可。
 */
function isRetryable(failure: VoiceFailure): boolean {
  return failure === "network" || failure === "silence"
}

/**
 * 状态 → 界面。三端共用这一层判断，端上只负责把结果摆成各自的形状。
 *
 * **判定顺序本身就是规格**，不要重排：
 *
 * 1. 失败优先 —— 录音中途断网也要先显示失败文案，而不是继续显示「聆听中」。
 * 2. 失败态同样算 `active` —— 权限被拒时录音根本没起来（`use-voice-input` 的 catch
 *    把 phase 留在 `idle`），只按录音态渲染的话界面上什么都不会发生。
 * 3. 有没有字决定确定键 —— 没字时置灰不可点（提交空文本没有意义）；**失败时也一
 *    样看字**：已经听到的内容要留得下来，而重试会把这次录音连同转写一起清掉。
 */
export function describeVoiceInput(input: {
  // 用字面量而不是 import VoicePhase，免得为了一个类型把 hook 依赖引进来。
  phase: "idle" | "recording"
  transcript: AsrTranscript
  failure: VoiceFailure | null
}): VoiceInputPresentation {
  const { phase, transcript, failure } = input

  // 只有定稿的句子才写进输入框，未定稿的部分还会变；有没有字按能提交的文本算。
  const hasText = transcript.combined.trim() !== ""

  if (failure !== null) {
    return {
      active: true,
      placeholder: FAILURE_TEXT[failure],
      caretVisible: false,
      // 已经听到的字比失败本身重要：有字就先给「把它留下」。重试会把这次录音
      // 连同转写一起清掉，只有空手而回时才谈得上重来。
      action: hasText ? "confirm" : isRetryable(failure) ? "retry" : "retry-disabled",
    }
  }

  if (phase === "recording") {
    return {
      active: true,
      placeholder: hasText ? "" : "聆听中",
      caretVisible: hasText,
      action: hasText ? "confirm" : "confirm-disabled",
    }
  }

  return { active: false, placeholder: "", caretVisible: false, action: "none" }
}
