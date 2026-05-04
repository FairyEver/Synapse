# 网站内容与结构增强设计

## 背景

Synapse 即将进入团队内部试用阶段。当前文档站基于 VitePress 默认主题，存在废弃页面残留、信息架构倒置、首页定位模糊、视觉无品牌辨识度等问题。本次改进目标是在内测前将网站提升到可用且专业的状态。

## 改动范围

三个层面：信息架构修正、首页强化、视觉品牌化。

---

## 一、信息架构修正

### 1.1 删除废弃与重复页面

删除以下 5 个文件：

| 文件 | 原因 |
|------|------|
| `guide/features.md` | 废弃重定向页，内容仅"页面已迁移" |
| `guide/faq.md` | 废弃重定向页，与 `reference/faq.md` 重复 |
| `guide/download.md` | 废弃重定向页，与 `start/install.md` 重复 |
| `guide/introduction.md` | 死页面，内容与 `guide/concepts.md` 重复 |
| `reference/downloads.md` | 与 `start/install.md` 内容重复 |

### 1.2 Sidebar 重排

**guide sidebar** 调整顺序：

```
核心概念 → Rule → Skill → 编辑器安装 → 设置
```

当前"核心概念"排在最后，新用户进入指南后直接看到 Rule 操作手册，缺少概念铺垫。移到第一位建立心智模型。

**nav 入口**：用户指南链接从 `/guide/rules` 改为 `/guide/concepts`。

### 1.3 Reference 拆分

将开发者文档从 reference 移入 developer：

- `reference/capability-authoring.md` → developer sidebar
- `reference/capability-naming-matrix.md` → developer sidebar

reference sidebar 精简为：FAQ、排障、术语表、MCP 能力。删除下载条目。

### 1.4 Nav 精简

删除 nav 中的独立"下载"入口（当前指向 `reference/downloads.md`，该页面将被删除）。下载信息统一由"快速开始"覆盖。

最终 nav 结构：

```
首页 | 快速开始 | 用户指南 | 团队协作 | 高级功能 | 开发者 | 参考
```

### 1.5 最终 Sidebar 配置

**guide/**:
- 核心概念 `/guide/concepts`
- Rule `/guide/rules`
- Skill `/guide/skills`
- 编辑器安装 `/guide/editors`
- 设置 `/guide/settings`

**developer/**:
- 总览 `/developer/`
- 本地开发 `/developer/local-development`
- 项目结构 `/developer/project-structure`
- 构建与发布 `/developer/build-release`
- 能力矩阵 `/developer/capability-naming-matrix`（从 `reference/` 移动文件）
- 能力维护 `/developer/capability-authoring`（从 `reference/` 移动文件）

**reference/**:
- 常见问题 `/reference/faq`
- 排障 `/reference/troubleshooting`
- 术语表 `/reference/glossary`
- MCP 能力 `/reference/synapse-mcp-capabilities`

---

## 二、首页强化

### 2.1 Hero 调整

| 字段 | 当前值 | 新值 |
|------|--------|------|
| `hero.name` | `Synapse` | `Synapse`（不变） |
| `hero.text` | `Where Ideas Connect` | `跨编辑器 AI 能力管理工具` |
| `hero.tagline` | `跨编辑器 Rule、Skill 与本地工作流管理工具。` | `集中管理 Rule、Skill 与 Prompt，一键安装到 Claude Code、Cursor、Codex 等编辑器。` |

"Where Ideas Connect" 保留在 `footer.message` 作为品牌语。

### 2.2 CTA 精简

从 3 个按钮精简为 2 个：

- **快速开始**（brand 主题）→ `/start/install`
- **GitHub**（alt 主题）→ `https://github.com/FairyEver/Synapse`

删除独立的"下载"按钮，下载信息已包含在快速开始页面中。

### 2.3 Features 扩充

从 6 项扩充到 8 项，补充高级功能：

| title | details |
|-------|---------|
| Rule 与 Skill 管理 | 集中管理可复用的规则和能力包，支持分类、搜索、收藏和版本查看。 |
| 跨编辑器安装 | 将内容安装到 Claude Code、Cursor、Codex、Windsurf，可选全局或项目范围。 |
| 仓库与团队共享 | 使用本地目录或 Git 仓库维护团队内容，保留变更记录，支持同步和删除恢复。 |
| 已有内容迁移 | 扫描编辑器中已有的 Rule 和 Skill，导入到仓库或复制到其他编辑器。 |
| Agent | 配置和管理 AI Agent 工作流，定义执行步骤和触发条件。 |
| 内置数据库与 MCP | 使用内置 Database 管理本地数据表，并将数据服务注册为 MCP Server。 |
| 定时任务调度 | 通过 cron 或 interval 表达式调度任务，支持启停控制和运行记录查看。 |
| 诊断工具 | 检查编辑器配置状态和内容安装情况，快速定位问题。 |

---

## 三、视觉品牌化

### 3.1 主题色覆盖

品牌色为黑色，与桌面端 primary（`oklch(0.205 0 0)`）保持一致。

**亮色模式：**

```css
:root {
  --vp-c-brand-1: #181818;
  --vp-c-brand-2: #2c2c2c;
  --vp-c-brand-3: #3a3a3a;
  --vp-c-brand-soft: rgba(24, 24, 24, 0.1);
}
```

**暗色模式：**

```css
.dark {
  --vp-c-brand-1: #f5f5f5;
  --vp-c-brand-2: #e0e0e0;
  --vp-c-brand-3: #cccccc;
  --vp-c-brand-soft: rgba(245, 245, 245, 0.1);
}
```

### 3.2 按钮样式

Brand 按钮覆盖为黑底白字（亮色）/ 白底黑字（暗色）：

```css
:root {
  --vp-button-brand-bg: #181818;
  --vp-button-brand-text: #ffffff;
  --vp-button-brand-hover-bg: #2c2c2c;
  --vp-button-brand-hover-text: #ffffff;
  --vp-button-brand-active-bg: #3a3a3a;
  --vp-button-brand-active-text: #ffffff;
}

.dark {
  --vp-button-brand-bg: #f5f5f5;
  --vp-button-brand-text: #181818;
  --vp-button-brand-hover-bg: #e0e0e0;
  --vp-button-brand-hover-text: #181818;
  --vp-button-brand-active-bg: #cccccc;
  --vp-button-brand-active-text: #181818;
}
```

### 3.3 Hero 区域

保持干净简洁，不加彩色光晕。已有的 `--vp-home-hero-image-background-image: none` 保留。

### 3.4 不做的事

- 不自定义字体，使用 VitePress 默认字体栈
- 不修改代码块、表格、提示框的默认样式
- 不添加自定义 Vue 组件

---

## 涉及文件清单

| 操作 | 文件 |
|------|------|
| 删除 | `website/guide/features.md` |
| 删除 | `website/guide/faq.md` |
| 删除 | `website/guide/download.md` |
| 删除 | `website/guide/introduction.md` |
| 删除 | `website/reference/downloads.md` |
| 移动 | `website/reference/capability-authoring.md` → `website/developer/capability-authoring.md` |
| 移动 | `website/reference/capability-naming-matrix.md` → `website/developer/capability-naming-matrix.md` |
| 修改 | `website/.vitepress/config.mts`（nav、sidebar） |
| 修改 | `website/index.md`（hero、features、actions） |
| 修改 | `website/.vitepress/theme/custom.css`（品牌色变量） |
