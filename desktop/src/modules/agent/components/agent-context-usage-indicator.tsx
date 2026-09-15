import { Progress } from "@/components/ui/progress"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { SynapseAgentContextUsage } from "@/types/agent"

type AgentContextUsageIndicatorProps = {
  readonly contextUsage?: SynapseAgentContextUsage
}

const compactTokenFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
})
const exactTokenFormatter = new Intl.NumberFormat("en-US")

function AgentContextUsageIndicator({ contextUsage }: AgentContextUsageIndicatorProps) {
  if (!contextUsage) return null

  const { usedTokens, contextWindowTokens, autoCompactThresholdTokens } = contextUsage
  const displayWindowTokens = autoCompactThresholdTokens ?? contextWindowTokens
  const hasWindow = displayWindowTokens !== undefined
  const percentage = hasWindow
    ? Math.round((usedTokens / displayWindowTokens) * 100)
    : undefined
  const progressValue = percentage === undefined
    ? undefined
    : Math.min(100, Math.max(0, percentage))
  const exactUsed = exactTokenFormatter.format(usedTokens)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="flex shrink-0 items-center gap-2 rounded-sm px-2 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-agent-context-usage
          tabIndex={0}
        >
          {hasWindow ? (
            <>
              <span className="whitespace-nowrap @max-[620px]/agent-header:hidden">
                {autoCompactThresholdTokens ? `占用 ${compactTokenFormatter.format(usedTokens)} · 整理 ${compactTokenFormatter.format(displayWindowTokens)}` : `上下文 ${compactTokenFormatter.format(usedTokens)} / ${compactTokenFormatter.format(displayWindowTokens)} · ${percentage}%`}
              </span>
              <span className="hidden whitespace-nowrap @max-[620px]/agent-header:inline">
                上下文 {percentage}%
              </span>
              <Progress
                className="w-16 shrink-0"
                value={progressValue}
                aria-label={`上下文占用 ${percentage}%`}
              />
            </>
          ) : (
            <span className="whitespace-nowrap">
              上下文 {compactTokenFormatter.format(usedTokens)}
            </span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="grid gap-1">
          <span>已用 {exactUsed} token</span>
          {hasWindow ? (
            <>
              <span>剩余 {exactTokenFormatter.format(Math.max(0, displayWindowTokens - usedTokens))} token</span>
              {autoCompactThresholdTokens !== undefined ? (
                <span>自动整理触发 {exactTokenFormatter.format(autoCompactThresholdTokens)} token</span>
              ) : (
                <span>运行窗口 {exactTokenFormatter.format(displayWindowTokens)} token</span>
              )}
              {contextWindowTokens !== undefined && contextWindowTokens !== displayWindowTokens ? (
                <span>模型窗口 {exactTokenFormatter.format(contextWindowTokens)} token</span>
              ) : null}
            </>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

export { AgentContextUsageIndicator }
