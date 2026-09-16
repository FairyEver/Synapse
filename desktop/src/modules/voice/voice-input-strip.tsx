import { Check, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { AsrTranscript } from "./asr-transcript"
import type { VoiceFailure } from "./voice-session"

export type VoiceInputStripProps = {
  readonly transcript: AsrTranscript
  readonly elapsedMs: number
  readonly failure: VoiceFailure | null
  readonly onCancel: () => void
  readonly onConfirm: () => void
  readonly onRetry: () => void
  /**
   * 终端没有输入框，实时文字只能由这条自己承载；Agent 对话的文字写在输入框位置，
   * 这里就只留控制行。
   */
  readonly showTranscript?: boolean
  readonly className?: string
}

const FAILURE_TEXT: Record<VoiceFailure, string> = {
  network: "网络已断开",
  silence: "没有听到声音",
  permission: "麦克风权限未开启 · 设置 › Synapse › 麦克风",
  unavailable: "语音输入不可用",
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000)
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0")
  const seconds = String(totalSeconds % 60).padStart(2, "0")
  return `${minutes}:${seconds}`
}

/**
 * 录音控制条。桌面两端共用，颜色全部走 token —— 终端容器带 `dark`，同一套类名在
 * 那边自动解析成深色，不需要第二套配色。
 */
export function VoiceInputStrip({
  transcript,
  elapsedMs,
  failure,
  onCancel,
  onConfirm,
  onRetry,
  showTranscript = false,
  className,
}: VoiceInputStripProps) {
  const retryable = failure === "network" || failure === "silence"
  return (
    <div
      className={cn("flex shrink-0 flex-col gap-1.5 border-t border-border bg-card px-2.5 py-2", className)}
      data-voice-input-strip
    >
      {showTranscript && transcript.combined ? (
        <p className="max-h-14 overflow-y-auto text-sm leading-snug break-words" data-voice-transcript>
          {transcript.stable}
          {/* 未定稿的部分还会变，用次要色和定稿文字区分开。 */}
          <span className="text-muted-foreground">{transcript.unstable}</span>
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="size-2 shrink-0 animate-pulse rounded-full bg-destructive" />
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatElapsed(elapsedMs)}</span>
        {failure ? (
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-destructive">
            <span className="truncate">{FAILURE_TEXT[failure]}</span>
            {retryable ? (
              <button
                type="button"
                className="shrink-0 underline underline-offset-2"
                onClick={onRetry}
              >
                重试
              </button>
            ) : null}
          </span>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="取消语音输入"
            onClick={onCancel}
          >
            <X />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            className="rounded-full"
            aria-label="完成语音输入"
            onClick={onConfirm}
          >
            <Check />
          </Button>
        </div>
      </div>
    </div>
  )
}
