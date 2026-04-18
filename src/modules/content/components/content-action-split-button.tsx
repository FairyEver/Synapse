import { useMemo, useState } from "react"
import {
  ChevronDown,
  Copy,
  Download,
  LoaderCircle,
} from "lucide-react"
import {
  downloadRule,
  downloadSkill,
  readRuleContent,
  readSkillContent,
} from "@/app-shell/content"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { SynapseContentMeta } from "@/types/content"

type ContentActionSplitButtonProps = {
  item: SynapseContentMeta
}

function ContentActionSplitButton({ item }: ContentActionSplitButtonProps) {
  const logger = useMemo(
    () => createRendererLogger(`content.action.${item.type}`),
    [item.type],
  )
  const [isCopying, setIsCopying] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const canCopy = item.type === "rule" || item.files.length === 0
  const isBusy = isCopying || isDownloading

  const handleDownload = async () => {
    if (isBusy) {
      return
    }

    setIsDownloading(true)

    try {
      const result =
        item.type === "rule"
          ? await downloadRule(item.id)
          : await downloadSkill(item.id)

      logger.info("Content download requested.", {
        canceled: result.canceled,
        contentId: item.id,
        contentType: item.type,
        filePath: result.filePath,
      })
    } catch (error) {
      logger.error("Content download failed.", {
        contentId: item.id,
        contentType: item.type,
        error,
      })

      const message = error instanceof Error ? error.message : "下载失败。"
      window.setTimeout(() => {
        window.alert(message)
      }, 0)
    } finally {
      setIsDownloading(false)
    }
  }

  const handleCopy = async () => {
    if (!canCopy || isBusy) {
      return
    }

    setIsCopying(true)

    try {
      const file =
        item.type === "rule"
          ? await readRuleContent(item.id)
          : await readSkillContent(item.id)

      if (!navigator.clipboard?.writeText) {
        throw new Error("当前环境不支持复制到剪贴板。")
      }

      await navigator.clipboard.writeText(file.content)

      logger.info("Content copied to clipboard.", {
        contentId: item.id,
        contentType: item.type,
      })

      window.setTimeout(() => {
        window.alert("正文已复制。")
      }, 0)
    } catch (error) {
      logger.error("Copy to clipboard failed.", {
        contentId: item.id,
        contentType: item.type,
        error,
      })

      const message = error instanceof Error ? error.message : "复制失败。"
      window.setTimeout(() => {
        window.alert(message)
      }, 0)
    } finally {
      setIsCopying(false)
    }
  }

  return (
    <div data-slot="button-group" className="inline-flex items-stretch">
      <Button
        variant="outline"
        size="sm"
        className="rounded-r-none border-r-0"
        disabled={isBusy}
        onClick={() => {
          void handleDownload()
        }}
      >
        {isDownloading ? (
          <LoaderCircle className="animate-spin" data-icon="inline-start" />
        ) : (
          <Download data-icon="inline-start" />
        )}
        下载
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon-sm"
            className="rounded-l-none"
            disabled={isBusy}
            title="更多操作"
          >
            <ChevronDown />
            <span className="sr-only">更多操作</span>
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>安装</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem disabled>安装到 Cursor</DropdownMenuItem>
            <DropdownMenuItem disabled>安装到 Codex</DropdownMenuItem>
            <DropdownMenuItem disabled>安装到 Claude Code</DropdownMenuItem>
            <DropdownMenuItem disabled>安装到指定目录</DropdownMenuItem>
          </DropdownMenuGroup>

          {canCopy ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={isBusy}
                onSelect={() => {
                  void handleCopy()
                }}
              >
                {isCopying ? <LoaderCircle className="animate-spin" /> : <Copy />}
                复制正文
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export { ContentActionSplitButton }
