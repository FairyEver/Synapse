import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * 详情里的状态提示块。
 *
 * 「录音已删除」「转写失败」「还没有文字」是同一个形状：一句结论、一句说明，需要时再带
 * 一个操作。之前这三处在详情里各写了一遍，收敛到这里。
 */

type MeetingNoticeProps = {
  readonly title: string
  readonly description: ReactNode
  readonly tone?: "default" | "destructive"
  readonly action?: ReactNode
}

export function MeetingNotice(props: MeetingNoticeProps) {
  const destructive = props.tone === "destructive"

  return (
    <div className={cn("rounded-lg border px-3 py-8 text-center", destructive && "border-destructive/40")}>
      <p className="text-sm font-medium">{props.title}</p>
      <p className={cn("mt-1 text-xs text-pretty", destructive ? "text-destructive" : "text-muted-foreground")}>
        {props.description}
      </p>
      {props.action ? <div className="mt-3">{props.action}</div> : null}
    </div>
  )
}
