import {
  Brain,
  Code2,
  FileText,
  Lightbulb,
  PenTool,
  Search,
  ShieldCheck,
  Sparkles,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react"

type SynapseContentIconOption = {
  icon: LucideIcon
  label: string
  value: string
}

type SynapseContentColorOption = {
  badgeClassName: string
  label: string
  swatchClassName: string
  value: string
}

const SYNAPSE_CONTENT_ICON_OPTIONS: SynapseContentIconOption[] = [
  { value: "brain", label: "思考", icon: Brain },
  { value: "code-2", label: "代码", icon: Code2 },
  { value: "file-text", label: "文档", icon: FileText },
  { value: "lightbulb", label: "想法", icon: Lightbulb },
  { value: "pen-tool", label: "写作", icon: PenTool },
  { value: "search", label: "检索", icon: Search },
  { value: "shield-check", label: "质量", icon: ShieldCheck },
  { value: "sparkles", label: "助手", icon: Sparkles },
  { value: "workflow", label: "流程", icon: Workflow },
  { value: "wrench", label: "工具", icon: Wrench },
]

const SYNAPSE_CONTENT_COLOR_OPTIONS: SynapseContentColorOption[] = [
  {
    value: "graphite",
    label: "石墨",
    badgeClassName: "bg-zinc-700 text-white",
    swatchClassName: "bg-zinc-700",
  },
  {
    value: "teal",
    label: "青绿",
    badgeClassName: "bg-teal-700 text-white",
    swatchClassName: "bg-teal-700",
  },
  {
    value: "blue",
    label: "蓝色",
    badgeClassName: "bg-blue-600 text-white",
    swatchClassName: "bg-blue-600",
  },
  {
    value: "indigo",
    label: "靛蓝",
    badgeClassName: "bg-indigo-600 text-white",
    swatchClassName: "bg-indigo-600",
  },
  {
    value: "rose",
    label: "莓红",
    badgeClassName: "bg-rose-600 text-white",
    swatchClassName: "bg-rose-600",
  },
  {
    value: "red",
    label: "赤红",
    badgeClassName: "bg-red-600 text-white",
    swatchClassName: "bg-red-600",
  },
  {
    value: "orange",
    label: "橙色",
    badgeClassName: "bg-orange-600 text-white",
    swatchClassName: "bg-orange-600",
  },
  {
    value: "amber",
    label: "金黄",
    badgeClassName: "bg-amber-500 text-white",
    swatchClassName: "bg-amber-500",
  },
  {
    value: "lime",
    label: "草绿",
    badgeClassName: "bg-lime-600 text-white",
    swatchClassName: "bg-lime-600",
  },
  {
    value: "cyan",
    label: "湖蓝",
    badgeClassName: "bg-cyan-600 text-white",
    swatchClassName: "bg-cyan-600",
  },
]

const contentIconOptionMap = new Map(
  SYNAPSE_CONTENT_ICON_OPTIONS.map((option) => [option.value, option]),
)

const contentColorOptionMap = new Map(
  SYNAPSE_CONTENT_COLOR_OPTIONS.map((option) => [option.value, option]),
)

function getContentIconOption(value: string): SynapseContentIconOption | null {
  return contentIconOptionMap.get(value) ?? null
}

function getContentColorOption(value: string): SynapseContentColorOption | null {
  return contentColorOptionMap.get(value) ?? null
}

export {
  getContentColorOption,
  getContentIconOption,
  SYNAPSE_CONTENT_COLOR_OPTIONS,
  SYNAPSE_CONTENT_ICON_OPTIONS,
  type SynapseContentColorOption,
  type SynapseContentIconOption,
}
