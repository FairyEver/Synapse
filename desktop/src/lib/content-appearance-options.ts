type SynapseContentIconOptionData = {
  label: string
  value: string
}

type SynapseContentColorOption = {
  backgroundClassName: string
  foregroundClassName: string
  label: string
  value: string
}

const SYNAPSE_CONTENT_ICON_OPTION_DATA: SynapseContentIconOptionData[] = [
  { value: "brain", label: "思考" },
  { value: "lightbulb", label: "灵感" },
  { value: "sparkles", label: "智能" },
  { value: "target", label: "目标" },
  { value: "eye", label: "观察" },
  { value: "code-2", label: "代码" },
  { value: "terminal", label: "终端" },
  { value: "bug", label: "调试" },
  { value: "git-branch", label: "版本" },
  { value: "cpu", label: "系统" },
  { value: "file-text", label: "文档" },
  { value: "book-open", label: "知识" },
  { value: "bookmark", label: "收藏" },
  { value: "sticky-note", label: "笔记" },
  { value: "clipboard-list", label: "清单" },
  { value: "wrench", label: "工具" },
  { value: "pen-tool", label: "编辑" },
  { value: "scissors", label: "处理" },
  { value: "hammer", label: "构建" },
  { value: "paintbrush", label: "设计" },
  { value: "workflow", label: "流程" },
  { value: "git-fork", label: "分支" },
  { value: "layers", label: "分层" },
  { value: "folder-tree", label: "结构" },
  { value: "shield-check", label: "质量" },
  { value: "check-circle", label: "完成" },
  { value: "alert-triangle", label: "警告" },
  { value: "search", label: "搜索" },
  { value: "scan", label: "扫描" },
  { value: "filter", label: "过滤" },
  { value: "flask-conical", label: "测试" },
  { value: "stethoscope", label: "诊断" },
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

const contentIconOptionDataMap = new Map(
  SYNAPSE_CONTENT_ICON_OPTION_DATA.map((option) => [option.value, option]),
)

const contentColorOptionMap = new Map(
  [...SYNAPSE_CONTENT_COLOR_OPTIONS, ...SYNAPSE_LEGACY_CONTENT_COLOR_OPTIONS]
    .map((option) => [option.value, option]),
)

function getContentIconOptionData(value: string): SynapseContentIconOptionData | null {
  return contentIconOptionDataMap.get(value) ?? null
}

function getContentColorOption(value: string): SynapseContentColorOption | null {
  return contentColorOptionMap.get(value) ?? null
}

export {
  DEFAULT_SYNAPSE_CONTENT_COLOR_VALUE,
  getContentColorOption,
  getContentIconOptionData,
  SYNAPSE_CONTENT_COLOR_OPTIONS,
  SYNAPSE_CONTENT_ICON_OPTION_DATA,
  SYNAPSE_LEGACY_CONTENT_COLOR_OPTIONS,
  type SynapseContentColorOption,
  type SynapseContentIconOptionData,
}
