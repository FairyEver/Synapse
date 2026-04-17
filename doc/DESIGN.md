# Synapse Design Baseline

## 1. Authority

Synapse 当前的视觉基线来自 shadcn/ui 的 preset 配置，而不是独立的品牌设计系统。

对当前仓库来说，以下文件共同定义默认视觉：

- `components.json`
- `src/styles/globals.css`
- `src/components/ui/`

只要任务没有明确要求变更 preset，这三处应与 shadcn CLI 输出保持一致或高度一致。

## 2. 当前默认基线

当前仓库默认应采用：

- style: `radix-nova`
- primitive base: `radix`
- base color: `neutral`
- CSS variables: 开启
- icon library: `lucide`
- 全局字体与 token 以 `src/styles/globals.css` 为准

如果未来需要切换 preset，必须同步更新：

- `components.json`
- `src/styles/globals.css`
- 相关 `src/components/ui/*`
- 本文档与对应规则文件

## 3. 颜色与主题

默认使用 shadcn preset 提供的 token：

- `--background`
- `--foreground`
- `--card`
- `--card-foreground`
- `--primary`
- `--primary-foreground`
- `--secondary`
- `--secondary-foreground`
- `--muted`
- `--muted-foreground`
- `--accent`
- `--accent-foreground`
- `--destructive`
- `--border`
- `--input`
- `--ring`

规则：

- 优先使用 token 类，如 `bg-background`、`text-foreground`、`bg-card`、`border-border`
- 不要为单个页面引入硬编码品牌色
- 不要额外维护一套 shell 专用配色
- 深浅主题都以同一套 token 体系驱动

## 4. 字体与排版

默认遵循 preset 导入的字体与主题变量：

- 使用 `src/styles/globals.css` 中声明的字体导入
- 使用 `--font-sans` 与 `--font-heading`
- 不再引入额外的 display font、品牌标题类或页面级排版系统

规则：

- 文本层级优先用 shadcn 组件默认字号和 Tailwind 常规排版类
- 需要强调时优先用 `font-medium`、`font-semibold`
- 不要额外创建大段自定义 tracking、display、editorial typography 类

## 5. 组件风格

默认优先使用 `src/components/ui/` 中的 shadcn 组件。

重点组件包括：

- `Button`
- `Card`
- `Input`
- `Textarea`
- `Label`
- `Dialog`
- `Tabs`
- `DropdownMenu`
- `Tooltip`
- `Badge`
- `Separator`

规则：

- 先组合默认组件，再做最小定制
- 优先保留组件默认的边框、圆角、阴影与 focus ring
- 不为了局部页面视觉手工复制一套按钮、卡片、输入框
- 新增组件时优先通过 shadcn CLI 生成
- 保持当前 Radix 基线，不要重新引入 `@base-ui/react` 或切回 Base UI
- 默认决策顺序是：现有业务组合组件 -> `src/components/ui/` 现有组件 -> 新增 shadcn 组件 -> 模块内薄包装组件 -> 最后才允许自定义 primitive
- 如果只是缺一个 shadcn 基础组件，不要先在 `src/components/` 写自定义版本

## 6. Tailwind 使用方式

Tailwind 主要用于：

- 布局
- 间距
- 尺寸
- 响应式
- 溢出控制
- 轻量排版

推荐优先使用：

- `flex` `grid` `block`
- `gap-*` `p-*` `px-*` `py-*`
- `w-*` `h-*` `min-h-*` `max-w-*`
- `items-*` `justify-*`
- `overflow-*`
- `text-sm` `text-base` `text-lg`
- `bg-background` `bg-card` `bg-muted`
- `text-foreground` `text-muted-foreground`
- `border-border`

默认避免：

- 大量硬编码颜色
- 大量任意阴影
- 大量任意圆角
- 渐变与装饰性背景
- 页面级品牌包装
- 用长串 Tailwind 类去重写 shadcn 组件原本的表面视觉

补充规则：

- Tailwind 在本仓库里默认是布局和节奏工具，不是主要视觉系统
- 按钮、输入框、卡片、弹窗、标签页等表面视觉应优先交给 shadcn 组件自身和主题 token
- 若一个 `className` 主要在描述颜色、阴影、圆角、边框和 hover 装饰，而不是布局与间距，应先回退检查是否过度定制

## 7. App Shell

App shell 与业务模块应共享同一套视觉基线。

规则：

- shell 不再保留独立的品牌壳层样式
- 顶栏、侧栏、内容区优先用 shadcn 组件和 token 组合
- 模块进入壳层后不应看到另一套视觉系统

## 8. 何时允许突破默认

仅在以下情况下，可以突破默认 shadcn 基线：

- 用户明确要求重新设计
- 产品需要统一切换 preset 或主题
- 某项功能必须通过额外视觉层级才能被正确理解

即使需要突破，也应优先调整共享 token 或共享组件，而不是在页面中临时堆叠样式。
