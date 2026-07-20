import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  MODEL_TIER_DISPLAY_LABELS,
  MODEL_TIER_ORIGINAL_LABELS,
} from "@/lib/provider-model"
import { cn } from "@/lib/utils"
import type { ModelTier } from "@/types/provider-model"

type ModelTierLabelProps = {
  readonly tier: ModelTier
  readonly className?: string
}

function ModelTierLabel({ tier, className }: ModelTierLabelProps) {
  const label = MODEL_TIER_DISPLAY_LABELS[tier]
  const originalLabel = MODEL_TIER_ORIGINAL_LABELS[tier]

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={`${label}，原名称：${originalLabel}`}
          className={cn("cursor-help", className)}
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{originalLabel}</TooltipContent>
    </Tooltip>
  )
}

export { ModelTierLabel }
export type { ModelTierLabelProps }
