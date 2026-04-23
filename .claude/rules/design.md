---
name: design
paths:
  - desktop/src/**/*.tsx
  - desktop/src/**/*.css
  - desktop/src/styles/**
  - desktop/components.json
---

# Synapse Design Baseline

## 1. 权威

Synapse 的视觉基线来自 shadcn/ui 的 preset 配置。

以下文件共同定义视觉系统：

- `desktop/components.json`
- `desktop/src/styles/globals.css`
- `desktop/src/components/ui/`

只要任务没有明确要求变更 preset，这三处应与 shadcn CLI 输出保持一致。

## 2. 当前默认基线

```yaml
style: radix-nova
base color: neutral
CSS variables: true
icon library: lucide
menu color: default
menu accent: subtle
primitive: radix-ui  # 组件底座，通过 package.json 依赖和组件实现体现
```

字体与 token 以 `desktop/src/styles/globals.css` 为准。

如需切换 preset，必须同步更新：

- `desktop/components.json`
- `desktop/src/styles/globals.css`
- 相关 `desktop/src/components/ui/*`
- `.claude/rules/design.md` 与 `.claude/rules/ui-rules.md`

## 3. 颜色 Token

使用 shadcn preset 提供的 CSS 变量：

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

深浅主题共用同一套 token 体系。

## 4. 字体

使用 `desktop/src/styles/globals.css` 中声明的字体：

- `--font-sans`: Geist Variable
- `--font-heading`: 与 sans 一致

## 5. 组件风格

默认优先使用 `desktop/src/components/ui/` 中的 shadcn 组件：

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

决策顺序：

1. 现有业务组合组件
2. `desktop/src/components/ui/` 现有组件
3. 新增 shadcn 组件
4. 模块内薄包装组件
5. 最后才允许自定义 primitive

保持当前 Radix 基线，不要重新引入 `@base-ui/react` 或切回 Base UI。

## 6. App Shell

App shell 与业务模块共享同一套视觉基线：

- shell 不保留独立的品牌壳层样式
- 顶栏、侧栏、内容区优先用 shadcn 组件和 token 组合
- 模块进入壳层后不应看到另一套视觉系统

## 7. 何时允许突破默认

仅在以下情况可突破默认基线：

- 用户明确要求重新设计
- 产品需要统一切换 preset 或主题
- 某项功能必须通过额外视觉层级才能被正确理解

即使需要突破，也应优先调整共享 token 或共享组件，而不是在页面中临时堆叠样式。
