/**
 * 腾讯云返回的识别结果按「句」推进，每句有自己的 index 和 slice_type：
 *
 *   0 = 这句话开始
 *   1 = 识别中，文字**还会变**
 *   2 = 这句话定稿
 *
 * 未定稿的文字绝不能当成结果写进输入框——用户眼看着字变了会很难受。所以这里把
 * 「已定稿」和「当前句」分开累积，UI 用不同颜色区分，只有定稿部分才参与最终提交。
 */
export type AsrTranscript = {
  /** 已定稿的句子，按 index 拼接。 */
  readonly stable: string
  /** 还在变的当前句。 */
  readonly unstable: string
  /** 定稿 + 未定稿，用于「现在总共听到了什么」。 */
  readonly combined: string
}

export const EMPTY_TRANSCRIPT: AsrTranscript = { stable: "", unstable: "", combined: "" }

export class AsrTranscriptAccumulator {
  private readonly settled = new Map<number, string>()
  private partialIndex: number | null = null
  private partialText = ""

  /** 返回本次是否真的改变了文本，UI 可以据此跳过无谓的重渲染。 */
  apply(result: { sliceType: number; index: number; text: string }): boolean {
    const text = result.text ?? ""
    // 只有 2 是定稿。0 是「这句话开始」，它带的文字同样还会变，归当前句 ——
    // 当成定稿的话，紧接着来的 1 会让同一句同时出现在两级里，拼出重复的文本。
    if (result.sliceType !== 2) {
      // 迟到的非稳态不能把已经定稿的句子重新打开。
      if (this.settled.has(result.index)) return false
      // 同一句的非稳态结果会重复下发，内容是全量而非增量。
      const changed = this.partialIndex !== result.index || this.partialText !== text
      this.partialIndex = result.index
      this.partialText = text
      return changed
    }
    const changed = this.settled.get(result.index) !== text || this.partialIndex === result.index
    this.settled.set(result.index, text)
    if (this.partialIndex === result.index) {
      this.partialIndex = null
      this.partialText = ""
    }
    return changed
  }

  snapshot(): AsrTranscript {
    const stable = [...this.settled.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, text]) => text)
      .join("")
    // 未定稿的当前句排在所有定稿之后。
    const unstable = this.partialIndex === null ? "" : this.partialText
    return { stable, unstable, combined: `${stable}${unstable}` }
  }

  /** 提交给输入框的文本：去掉未定稿部分的空白，句子之间不留空。 */
  finalText(): string {
    return this.snapshot().combined.trim()
  }

  get isEmpty(): boolean {
    return this.settled.size === 0 && !this.partialText
  }
}
