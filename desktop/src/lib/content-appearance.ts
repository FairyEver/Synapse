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
import {
  DEFAULT_SYNAPSE_CONTENT_COLOR_VALUE,
  getContentColorOption,
  SYNAPSE_CONTENT_COLOR_OPTIONS,
  SYNAPSE_CONTENT_ICON_OPTION_DATA,
  type SynapseContentColorOption,
  type SynapseContentIconOptionData,
} from "./content-appearance-options"

type SynapseContentIconOption = SynapseContentIconOptionData & {
  icon: LucideIcon
}

const ICON_COMPONENTS_BY_VALUE = new Map<string, LucideIcon>([
  ["brain", Brain],
  ["lightbulb", Lightbulb],
  ["sparkles", Sparkles],
  ["target", Target],
  ["eye", Eye],
  ["code-2", Code2],
  ["terminal", Terminal],
  ["bug", Bug],
  ["git-branch", GitBranch],
  ["cpu", Cpu],
  ["file-text", FileText],
  ["book-open", BookOpen],
  ["bookmark", Bookmark],
  ["sticky-note", StickyNote],
  ["clipboard-list", ClipboardList],
  ["wrench", Wrench],
  ["pen-tool", PenTool],
  ["scissors", Scissors],
  ["hammer", Hammer],
  ["paintbrush", Paintbrush],
  ["workflow", Workflow],
  ["git-fork", GitFork],
  ["layers", Layers],
  ["folder-tree", FolderTree],
  ["shield-check", ShieldCheck],
  ["check-circle", CheckCircle],
  ["alert-triangle", AlertTriangle],
  ["search", Search],
  ["scan", Scan],
  ["filter", Filter],
  ["flask-conical", FlaskConical],
  ["stethoscope", Stethoscope],
])

const SYNAPSE_CONTENT_ICON_OPTIONS: SynapseContentIconOption[] =
  SYNAPSE_CONTENT_ICON_OPTION_DATA.map((option) => ({
    ...option,
    icon: ICON_COMPONENTS_BY_VALUE.get(option.value) ?? Wrench,
  }))

function getContentIconOption(value: string): SynapseContentIconOption | null {
  return SYNAPSE_CONTENT_ICON_OPTIONS.find((option) => option.value === value) ?? null
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
