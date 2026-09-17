import { describe, expect, it } from "vitest"

import type { AsrTranscript } from "../asr-transcript"
import { describeVoiceInput } from "../voice-input-presentation"

const EMPTY: AsrTranscript = { stable: "", unstable: "", combined: "" }

function transcript(stable: string, unstable: string): AsrTranscript {
  return { stable, unstable, combined: `${stable}${unstable}` }
}

describe("describeVoiceInput", () => {
  it("空闲时不进语音界面", () => {
    expect(describeVoiceInput({ phase: "idle", transcript: EMPTY, failure: null })).toEqual({
      active: false,
      placeholder: "",
      caretVisible: false,
      action: "none",
    })
  })

  it("录音中还没出字时提示聆听中，确定键置灰", () => {
    expect(describeVoiceInput({ phase: "recording", transcript: EMPTY, failure: null })).toEqual({
      active: true,
      placeholder: "聆听中",
      caretVisible: false,
      action: "confirm-disabled",
    })
  })

  it("录音中出了字就收起占位、露出插入点，确定键可点", () => {
    expect(
      describeVoiceInput({
        phase: "recording",
        transcript: transcript("跑一下 ", "pnpm dev"),
        failure: null,
      }),
    ).toEqual({
      active: true,
      placeholder: "",
      caretVisible: true,
      action: "confirm",
    })
  })

  it("只有未定稿时也算有字 —— 用户已经在屏幕上看见它了", () => {
    expect(
      describeVoiceInput({ phase: "recording", transcript: transcript("", "git sta"), failure: null }).action,
    ).toBe("confirm")
  })

  it("空白不当作有字", () => {
    const blank: AsrTranscript = { stable: "", unstable: "", combined: "   " }
    expect(describeVoiceInput({ phase: "recording", transcript: blank, failure: null }).action).toBe(
      "confirm-disabled",
    )
  })

  /**
   * 失败优先于录音态：继续显示「聆听中」会让用户以为还在录。
   */
  it("录音中失败时先显示失败文案", () => {
    expect(
      describeVoiceInput({ phase: "recording", transcript: EMPTY, failure: "network" }),
    ).toEqual({
      active: true,
      placeholder: "网络已断开",
      caretVisible: false,
      action: "retry",
    })
  })

  /**
   * 已经听到的字比失败本身重要。重试会把这次录音连同转写一起清掉，不能拿它当
   * 断网后唯一的出口 —— 否则用户刚说出来的那句话只能看、提交不出去。
   */
  it("失败但已经出了字时给确认键，把听到的留下", () => {
    expect(
      describeVoiceInput({
        phase: "recording",
        transcript: transcript("跑一下 ", "pnpm dev"),
        failure: "network",
      }),
    ).toEqual({
      active: true,
      placeholder: "网络已断开",
      caretVisible: false,
      action: "confirm",
    })
  })

  it("不可重试的失败即使有字也给确认键", () => {
    expect(
      describeVoiceInput({
        phase: "recording",
        transcript: transcript("已经说出来的", ""),
        failure: "unavailable",
      }).action,
    ).toBe("confirm")
  })

  /**
   * 权限被拒时录音根本没起来，phase 停在 idle —— 这一条钉住的就是「界面什么都不提示」
   * 那个存量 bug：失败态必须自己算 active。
   */
  it("没在录音也可以进失败界面", () => {
    expect(describeVoiceInput({ phase: "idle", transcript: EMPTY, failure: "permission" })).toEqual({
      active: true,
      placeholder: "麦克风权限未开启",
      caretVisible: false,
      action: "retry-disabled",
    })
  })

  it("没听到声音可以重试", () => {
    expect(describeVoiceInput({ phase: "idle", transcript: EMPTY, failure: "silence" }).action).toBe("retry")
  })

  it("语音输入不可用时不给重试 —— 点多少次都不会变", () => {
    expect(describeVoiceInput({ phase: "idle", transcript: EMPTY, failure: "unavailable" }).action).toBe(
      "retry-disabled",
    )
  })
})
