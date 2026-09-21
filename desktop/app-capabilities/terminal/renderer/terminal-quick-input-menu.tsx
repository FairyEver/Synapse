import { useEffect, useState } from "react"
import { ChevronUp, Eye, X } from "lucide-react"

import { Button } from "../../../src/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "../../../src/components/ui/popover"
import type { SynapseQuickInputItem } from "../../../src/types/quick-input"

/** 行标签与折叠正文的长度上限。句子本身没有长度约束，这里只是防止长句撑破行。 */
const QUICK_INPUT_LABEL_MAX_LENGTH = 24
const QUICK_INPUT_BODY_MAX_LENGTH = 60

function truncateLine(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

/** 行标签：`content` 里第一个非空行的去空白结果。 */
export function quickInputLabel(content: string): string {
  const line = content
    .split(/\r?\n/)
    .map((current) => current.trim())
    .find((current) => current.length > 0)
  return truncateLine(line ?? "", QUICK_INPUT_LABEL_MAX_LENGTH)
}

/** 行正文：标签行之后的其余内容折成一行；没有其余内容时返回空串，调用方据此不渲染第二行。 */
export function quickInputBody(content: string): string {
  const lines = content.split(/\r?\n/).map((current) => current.trim())
  const labelIndex = lines.findIndex((current) => current.length > 0)
  if (labelIndex < 0) return ""
  const body = lines.slice(labelIndex + 1).filter((current) => current.length > 0).join(" ")
  return truncateLine(body, QUICK_INPUT_BODY_MAX_LENGTH)
}

const LIST_CLASS_NAME =
  "max-h-[340px] w-[392px] shrink-0 overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"

type TerminalQuickInputMenuProps = {
  readonly items: readonly SynapseQuickInputItem[]
  readonly disabled?: boolean
  readonly onPick: (content: string) => void
}

export function TerminalQuickInputMenu({ items, disabled, onPick }: TerminalQuickInputMenuProps) {
  const [open, setOpen] = useState(false)
  const [previewedId, setPreviewedId] = useState<string | null>(null)

  // 会话不再 running（被终止或被手机端接管）时，面板里的行点了也不会写入，
  // 与其留一个点不动的面板，不如跟入口一起收起。
  useEffect(() => {
    if (!disabled) return
    setOpen(false)
    setPreviewedId(null)
  }, [disabled])

  if (items.length === 0) return null

  const previewed = items.find((item) => item.id === previewedId)

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setPreviewedId(null)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 rounded-md px-2 text-foreground/75 hover:bg-accent hover:text-foreground"
          aria-label="快捷输入"
          disabled={disabled}
        >
          <span>快捷输入</span>
          <ChevronUp data-icon="inline-end" className={open ? "rotate-180" : undefined} />
        </Button>
      </PopoverTrigger>
      {/*
        终端区那个 `.dark` 管不到挂到 body 上的弹层，面板要自己带一份，
        否则浅色主题下面板会是浅的，压在深色终端上。
      */}
      <PopoverContent
        side="top"
        align="start"
        avoidCollisions={false}
        className="dark flex w-[392px] flex-row items-stretch gap-2 bg-transparent p-0 ring-0 shadow-none"
      >
        <div className={LIST_CLASS_NAME}>
          {items.map((item) => {
            const label = quickInputLabel(item.content)
            const body = quickInputBody(item.content)
            return (
              <div key={item.id} className="flex items-start rounded-md hover:bg-accent">
                {/* 行主体与眼睛是兄弟按钮：button 里不能放 button。 */}
                <button
                  type="button"
                  className="min-w-0 flex-1 px-2 py-1.5 text-left"
                  aria-label={`填入快捷输入：${label}`}
                  onClick={() => {
                    setOpen(false)
                    setPreviewedId(null)
                    onPick(item.content)
                  }}
                >
                  <span className="block truncate">{label}</span>
                  {body ? <span className="block truncate text-xs text-muted-foreground">{body}</span> : null}
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="mt-1 mr-1"
                  aria-label={`看全文：${label}`}
                  onClick={() => setPreviewedId(item.id)}
                >
                  <Eye />
                </Button>
              </div>
            )
          })}
        </div>
        {previewed ? (
          <div className={LIST_CLASS_NAME}>
            <div className="flex items-center justify-between pl-1.5">
              <span className="text-xs text-muted-foreground">全文</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="收起全文"
                onClick={() => setPreviewedId(null)}
              >
                <X />
              </Button>
            </div>
            <p className="px-1.5 py-1 leading-relaxed select-text whitespace-pre-wrap">{previewed.content}</p>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
