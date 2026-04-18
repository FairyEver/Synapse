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
  backgroundClassName: string
  foregroundClassName: string
  label: string
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
    label: "浅灰",
    backgroundClassName: "bg-linear-to-br from-zinc-100 to-zinc-300",
    foregroundClassName: "text-zinc-700",
  },
  {
    value: "teal",
    label: "青绿",
    backgroundClassName: "bg-linear-to-br from-teal-600 to-teal-800",
    foregroundClassName: "text-white",
  },
  {
    value: "blue",
    label: "蓝色",
    backgroundClassName: "bg-linear-to-br from-blue-500 to-blue-700",
    foregroundClassName: "text-white",
  },
  {
    value: "indigo",
    label: "靛蓝",
    backgroundClassName: "bg-linear-to-br from-indigo-500 to-indigo-700",
    foregroundClassName: "text-white",
  },
  {
    value: "red",
    label: "赤红",
    backgroundClassName: "bg-linear-to-br from-red-500 to-red-700",
    foregroundClassName: "text-white",
  },
  {
    value: "orange",
    label: "橙色",
    backgroundClassName: "bg-linear-to-br from-orange-500 to-orange-700",
    foregroundClassName: "text-white",
  },
  {
    value: "amber",
    label: "金黄",
    backgroundClassName: "bg-linear-to-br from-amber-400 to-amber-600",
    foregroundClassName: "text-white",
  },
  {
    value: "lime",
    label: "草绿",
    backgroundClassName: "bg-linear-to-br from-lime-500 to-lime-700",
    foregroundClassName: "text-white",
  },
  {
    value: "cyan",
    label: "湖蓝",
    backgroundClassName: "bg-linear-to-br from-cyan-500 to-cyan-700",
    foregroundClassName: "text-white",
  },
]

const SYNAPSE_LEGACY_CONTENT_COLOR_OPTIONS: SynapseContentColorOption[] = [
  {
    value: "rose",
    label: "莓红",
    backgroundClassName: "bg-linear-to-br from-rose-500 to-rose-700",
    foregroundClassName: "text-white",
  },
]

const DEFAULT_SYNAPSE_CONTENT_COLOR_VALUE = SYNAPSE_CONTENT_COLOR_OPTIONS[0]?.value ?? ""

const contentIconOptionMap = new Map(
  SYNAPSE_CONTENT_ICON_OPTIONS.map((option) => [option.value, option]),
)

const contentColorOptionMap = new Map(
  [...SYNAPSE_CONTENT_COLOR_OPTIONS, ...SYNAPSE_LEGACY_CONTENT_COLOR_OPTIONS]
    .map((option) => [option.value, option]),
)

function getContentIconOption(value: string): SynapseContentIconOption | null {
  return contentIconOptionMap.get(value) ?? null
}

function getContentColorOption(value: string): SynapseContentColorOption | null {
  return contentColorOptionMap.get(value) ?? null
}

export {
  DEFAULT_SYNAPSE_CONTENT_COLOR_VALUE,
  getContentColorOption,
  getContentIconOption,
  SYNAPSE_CONTENT_COLOR_OPTIONS,
  SYNAPSE_CONTENT_ICON_OPTIONS,
  type SynapseContentColorOption,
  type SynapseContentIconOption,
}
