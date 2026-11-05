import {
  Bot, Cloud, Database, FolderOpen, GitBranch, Inbox, KeyRound, LayoutGrid, LibraryBig,
  ListTodo, Mail, MessageCircle, Mic, PackageCheck, Plug, Settings, SquareCode, SquareTerminal,
  Tag, TextCursorInput, Timer, Workflow, type LucideIcon,
} from "lucide-react"
import type { SynapseSystemAppId } from "./types"

export const appCategories = [
  { id: "collaboration", name: "协作与沟通", icon: MessageCircle },
  { id: "resources", name: "文件与资源", icon: FolderOpen },
  { id: "development", name: "开发与自动化", icon: SquareTerminal },
  { id: "system", name: "设置与监控", icon: Settings },
] as const

export type AppCategoryId = (typeof appCategories)[number]["id"]

export const systemAppPresentation: Record<SynapseSystemAppId, {
  readonly icon: LucideIcon
  readonly category: AppCategoryId | null
}> = {
  agent: { icon: MessageCircle, category: "collaboration" },
  "agent-personas": { icon: Bot, category: "collaboration" },
  "mail-internal": { icon: Inbox, category: "collaboration" },
  mail: { icon: Mail, category: "collaboration" },
  todos: { icon: ListTodo, category: "collaboration" },
  meeting: { icon: Mic, category: "collaboration" },
  drive: { icon: Cloud, category: "resources" },
  "resource-repository": { icon: LibraryBig, category: "resources" },
  database: { icon: Database, category: "resources" },
  "synapse-skill": { icon: PackageCheck, category: "resources" },
  "quick-input": { icon: TextCursorInput, category: "resources" },
  workflow: { icon: Workflow, category: "development" },
  automation: { icon: Timer, category: "development" },
  terminal: { icon: SquareTerminal, category: "development" },
  git: { icon: GitBranch, category: "development" },
  "editor-scan": { icon: SquareCode, category: "development" },
  connectors: { icon: Plug, category: "development" },
  settings: { icon: Settings, category: "system" },
  secrets: { icon: KeyRound, category: "system" },
  "model-price": { icon: Tag, category: "system" },
  launcher: { icon: LayoutGrid, category: null },
}
