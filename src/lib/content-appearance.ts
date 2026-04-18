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
  { value: "#3f3f46", label: "石墨" },
  { value: "#0f766e", label: "青绿" },
  { value: "#2563eb", label: "蓝色" },
  { value: "#4f46e5", label: "靛蓝" },
  { value: "#be185d", label: "莓红" },
  { value: "#dc2626", label: "赤红" },
  { value: "#ea580c", label: "橙色" },
  { value: "#ca8a04", label: "金黄" },
  { value: "#65a30d", label: "草绿" },
  { value: "#0891b2", label: "湖蓝" },
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
