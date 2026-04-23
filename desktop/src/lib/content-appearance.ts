import {
  AlertTriangle,
  BookOpen,
  Bookmark,
  Brain,
  Bug,
  CheckCircle,
  ClipboardList,
  Code2,
  Cpu,
  Eye,
  FileText,
  Filter,
  FlaskConical,
  FolderTree,
  GitBranch,
  GitFork,
  Hammer,
  Layers,
  Lightbulb,
  Paintbrush,
  PenTool,
  Scan,
  Scissors,
  Search,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  StickyNote,
  Target,
  Terminal,
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
  // 思维/认知类
  { value: "brain", label: "思考", icon: Brain },
  { value: "lightbulb", label: "灵感", icon: Lightbulb },
  { value: "sparkles", label: "智能", icon: Sparkles },
  { value: "target", label: "目标", icon: Target },
  { value: "eye", label: "观察", icon: Eye },
  // 代码/开发类
  { value: "code-2", label: "代码", icon: Code2 },
  { value: "terminal", label: "终端", icon: Terminal },
  { value: "bug", label: "调试", icon: Bug },
  { value: "git-branch", label: "版本", icon: GitBranch },
  { value: "cpu", label: "系统", icon: Cpu },
  // 文档/内容类
  { value: "file-text", label: "文档", icon: FileText },
  { value: "book-open", label: "知识", icon: BookOpen },
  { value: "bookmark", label: "收藏", icon: Bookmark },
  { value: "sticky-note", label: "笔记", icon: StickyNote },
  { value: "clipboard-list", label: "清单", icon: ClipboardList },
  // 工具/操作类
  { value: "wrench", label: "工具", icon: Wrench },
  { value: "pen-tool", label: "编辑", icon: PenTool },
  { value: "scissors", label: "处理", icon: Scissors },
  { value: "hammer", label: "构建", icon: Hammer },
  { value: "paintbrush", label: "设计", icon: Paintbrush },
  // 流程/组织类
  { value: "workflow", label: "流程", icon: Workflow },
  { value: "git-fork", label: "分支", icon: GitFork },
  { value: "layers", label: "分层", icon: Layers },
  { value: "folder-tree", label: "结构", icon: FolderTree },
  // 质量/安全类
  { value: "shield-check", label: "质量", icon: ShieldCheck },
  { value: "check-circle", label: "完成", icon: CheckCircle },
  { value: "alert-triangle", label: "警告", icon: AlertTriangle },
  // 搜索/分析类
  { value: "search", label: "搜索", icon: Search },
  { value: "scan", label: "扫描", icon: Scan },
  { value: "filter", label: "过滤", icon: Filter },
  // 测试/诊断类
  { value: "flask-conical", label: "测试", icon: FlaskConical },
  { value: "stethoscope", label: "诊断", icon: Stethoscope },
]

const SYNAPSE_CONTENT_COLOR_OPTIONS: SynapseContentColorOption[] = [
  {
    value: "graphite",
    label: "银灰",
    backgroundClassName: "bg-linear-to-br from-zinc-200 to-zinc-400",
    foregroundClassName: "text-foreground",
  },
  {
    value: "stone",
    label: "石灰",
    backgroundClassName: "bg-linear-to-br from-stone-500 to-stone-700",
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
    label: "橙黄",
    backgroundClassName: "bg-linear-to-br from-orange-500 to-orange-700",
    foregroundClassName: "text-white",
  },
  {
    value: "amber",
    label: "琥珀",
    backgroundClassName: "bg-linear-to-br from-amber-400 to-amber-600",
    foregroundClassName: "text-amber-950",
  },
  {
    value: "green",
    label: "翠绿",
    backgroundClassName: "bg-linear-to-br from-green-500 to-green-700",
    foregroundClassName: "text-white",
  },
  {
    value: "emerald",
    label: "碧绿",
    backgroundClassName: "bg-linear-to-br from-emerald-500 to-emerald-700",
    foregroundClassName: "text-white",
  },
  {
    value: "teal",
    label: "青绿",
    backgroundClassName: "bg-linear-to-br from-teal-600 to-teal-800",
    foregroundClassName: "text-white",
  },
  {
    value: "blue",
    label: "海蓝",
    backgroundClassName: "bg-linear-to-br from-blue-500 to-blue-700",
    foregroundClassName: "text-white",
  },
  {
    value: "indigo",
    label: "靛蓝",
    backgroundClassName: "bg-linear-to-br from-indigo-500 to-indigo-700",
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
