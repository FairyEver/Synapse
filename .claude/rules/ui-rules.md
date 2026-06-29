---
name: ui-rules
paths:
  - desktop/src/**/*.tsx
  - desktop/src/**/*.css
  - desktop/src/styles/**
  - desktop/components.json
---

# Synapse UI 编写规则

## 0. 规范优先级

`.claude/rules/design.md` 是视觉与样式规范的最高优先级来源。

只要任务涉及以下任一内容，都必须先遵守 `.claude/rules/design.md`：

- 颜色
- 字体
- 字号
- 行高
- 间距
- 阴影
- 圆角
- 组件外观
- 页面结构
- 深浅主题切换

## 1. 目标

Synapse 的 UI 代码默认追求：

- 清晰
- 稳定
- 易扩展
- 易维护

默认基线是 shadcn/ui 当前 preset，而不是额外的品牌化视觉系统。

## 2. 颜色使用规则

优先使用 token 类：

```
bg-background      text-foreground
bg-card            text-muted-foreground
bg-muted           border-border
```

禁止：

- 为单个页面引入硬编码品牌色
- 额外维护一套 shell 专用配色
- 大量硬编码颜色

## 3. 字体使用规则

- 文本层级优先用 shadcn 组件默认字号和 Tailwind 常规排版类
- 需要强调时优先用 `font-medium`、`font-semibold`
- 不要额外创建大段自定义 tracking、display、editorial typography 类

## 4. Tailwind 使用边界

Tailwind 主要用于：

- 布局：`flex` `grid` `block` `hidden`
- 间距：`gap-*` `p-*` `px-*` `py-*` `m-*`
- 尺寸：`w-*` `h-*` `min-h-*` `max-w-*`
- 对齐：`items-*` `justify-*`
- 溢出：`overflow-*`
- 响应式：`sm:` `md:` `lg:` `xl:`
- 轻量排版：`text-sm` `text-base` `text-lg` `font-medium` `font-semibold`
- Token 引用：`bg-background` `text-foreground` `bg-card` `border-border` `bg-muted` `text-muted-foreground`

默认避免：

- 与 shadcn preset 无关的硬编码颜色
- 大量任意阴影、圆角
- 渐变类
- 动画类
- 装饰性 absolute/fixed 定位
- 很长的 `className` 串
- 用 Tailwind 大面积重写组件库已有的表面视觉

核心原则：Tailwind 是布局和节奏工具，不是主要视觉系统。按钮、输入框、卡片等表面视觉应交给 shadcn 组件自身和主题 token。

## 5. shadcn/ui 使用规则

- 默认保留组件基础视觉风格
- 先组合，再定制
- 不为了"更好看"随意改内部源码
- 需要新增组件时，优先通过 shadcn CLI 生成或严格对齐 CLI 输出
- 需要定制时，优先调整主题 token 或共享组件层，而不是在页面里零散覆盖
- 新建共享 UI 前，先确认现有 `desktop/src/components/ui/` 是否可直接使用或是否应先补一个 shadcn 组件
- 不要为了单个页面或单个模块，在 `desktop/src/components/` 新建与 shadcn 等价的按钮、输入框、卡片、弹窗、标签等基础组件

优先使用的组件包括：

- `Button`
- `Card`
- `Input`
- `Textarea`
- `Label`
- `Dialog`
- `Sheet`
- `Tabs`
- `DropdownMenu`
- `Tooltip`
- `Badge`
- `ScrollArea`
- `Separator`

### Dialog 布局补充

- 普通小表单、确认、导入类弹窗继续使用默认 shadcn `DialogContent` 关闭按钮。
- 固定高度、`p-0`、主体滚动、右侧 header actions、或标题栏中间有 tabs 的大弹窗，必须使用共享 `DialogFrame`、`DialogFrameHeader`、`DialogFrameBody`、`DialogFrameFooter`，并让 `DialogContent` 显式 `showCloseButton={false}`。
- 带 tabs 的大弹窗必须通过 `DialogFrameHeader center` 放置中间 tabs，左侧标题/描述、右侧 actions 和关闭按钮保持三列对齐，禁止业务文件手写三列标题栏。
- 禁止用 `DialogHeader className="pr-8"` / `pr-12` 给默认绝对定位 close 让位；同一类大弹窗不得混用默认绝对 close 和 header 内 close。
- 真正阻塞且不可关闭的流程弹窗可以不渲染 close，但必须是迁移、强制 onboarding 等由流程状态明确支撑的例外。

## 6. 页面结构顺序

实现页面时优先顺序：

1. 页面骨架
2. 状态流
3. 交互逻辑
4. 细节样式

不要先做花哨样式，再回头补结构和状态。

## 7. className 纪律

`className` 应做到：

- 短
- 稳定
- 可读
- 以布局类和 token 类为主

如果一个组件的 `className` 变得很长、重复、充满装饰性细节，优先考虑：

- 提炼成更小的组件
- 复用已有组件
- 减少不必要的视觉定制

## 8. 模块页面默认样式方向

业务模块页面默认应偏向：

- `Card` 分区
- 清晰标题与说明
- 简洁表单
- 列表与空状态
- 明确的主次操作按钮
- 与共享 preset 一致的中性色表面、边框、阴影和 focus ring

默认不应偏向：

- 海报式页面
- 页面级品牌包装
- 大量悬浮元素
- 复杂动效
- 纯展示型排版

### 列表与表格交互补充

- 表格行或列表项如果代表“打开 / 进入 / 选择”这类主操作，整行或主要内容区域都必须可点击；不要只让文件名、标题文字或很小的局部文本可点击。
- 行内的分享、删除、更多菜单等次要操作必须阻止事件冒泡，不能触发行的主操作。

## 9. 用户文案规则

所有界面文案默认都是写给用户看的，不是写给开发者看的。

必须遵守：

- 不要把"后续会接入""当前先保留入口""为了稳定状态边界""步骤 X 才支持"这类实现说明写进界面
- 不要在 UI 里解释架构、模块边界、技术选型、开发阶段、预留位或重构原因
- 空状态、加载态、禁用说明、帮助文案都要短、直接、可操作
- 优先告诉用户现在能做什么，而不是内部还有什么没做
- 能用一句话说清的，不要写成两三句说明
- 如果删掉一段文案后，不影响用户完成当前任务，就应该删掉

判断标准：

- 这是用户现在完成操作必须知道的信息吗？
- 这句话是在帮助用户，还是在解释实现过程？

如果更像开发备注，就不要显示在界面里。
