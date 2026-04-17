export type AppShellTab = {
  label: string
  active: boolean
}

export type AppShellCardItem = {
  title: string
  description: string
}

export const appShellTabs: AppShellTab[] = [
  { label: "规则", active: true },
  { label: "技能", active: false },
  { label: "设置", active: false },
]

export const appShellSidebarGroups = [
  "全部规则",
  "代码质量",
  "安全",
  "性能",
]

export const appShellCards: AppShellCardItem[] = [
  { title: "持续化场景感知", description: "保持壳层结构稳定，让模块内容在统一的主内容区域中切换和扩展。" },
  { title: "代码审查提示", description: "为基础布局预留清晰的主次分区，让列表、详情和辅助信息都能自然承接。" },
  { title: "骨架优先", description: "先建立顶栏、侧栏和内容区的节奏，再逐步填充具体模块能力和业务状态。" },
  { title: "布局即语义", description: "用稳定的容器边界表达导航、筛选和工作区职责，减少后续页面反复重做。" },
  { title: "安全 API 默认边界", description: "把全局动作收敛在顶栏，避免业务区域与壳层能力发生耦合。" },
  { title: "上下文持久化", description: "侧栏负责范围切换和筛选，主区保留给模块内容、详情面板和结果呈现。" },
  { title: "响应式留白策略", description: "在窄屏下退化为纵向堆叠，保证骨架完整，不让功能入口丢失。" },
  { title: "任务密度控制", description: "两列主区仅作为桌面态密度参考，真正的业务组件仍由模块自己决定。" },
  { title: "主视图保护", description: "主内容区域默认保持大面积留白，让未来的数据面板和编辑器有足够空间。" },
  { title: "统一操作入口", description: "刷新、创建等全局动作靠近顶栏右侧，便于形成稳定的使用记忆。" },
]
