# 网站内容与结构增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 整治网站信息架构、强化首页、添加黑色品牌视觉，使文档站在内测前达到专业可用状态。

**Architecture:** 纯静态站点改动，不涉及构建配置变更。所有改动集中在 `website/` 目录下的 markdown 文件、VitePress 配置和 CSS 变量。

**Tech Stack:** VitePress, Markdown, CSS Custom Properties

**Important:** 本计划基于 `main` 分支的文件状态。实施前需确保工作在 main 最新代码上进行（rebase 或新建分支）。

---

### Task 1: 删除废弃与重复页面

**Files:**
- Delete: `website/guide/features.md`
- Delete: `website/guide/faq.md`
- Delete: `website/guide/download.md`
- Delete: `website/guide/introduction.md`
- Delete: `website/reference/downloads.md`

- [ ] **Step 1: 删除 5 个废弃/重复文件**

```bash
git rm website/guide/features.md website/guide/faq.md website/guide/download.md website/guide/introduction.md website/reference/downloads.md
```

- [ ] **Step 2: Commit**

```bash
git commit -m "chore(website): remove obsolete and duplicate pages"
```

---

### Task 2: 移动开发者文档到 developer 目录

**Files:**
- Move: `website/reference/capability-authoring.md` → `website/developer/capability-authoring.md`
- Move: `website/reference/capability-naming-matrix.md` → `website/developer/capability-naming-matrix.md`

- [ ] **Step 1: 移动文件**

```bash
git mv website/reference/capability-authoring.md website/developer/capability-authoring.md
git mv website/reference/capability-naming-matrix.md website/developer/capability-naming-matrix.md
```

- [ ] **Step 2: Commit**

```bash
git commit -m "refactor(website): move capability docs to developer section"
```

---

### Task 3: 更新 config.mts — nav 和 sidebar

**Files:**
- Modify: `website/.vitepress/config.mts`

- [ ] **Step 1: 更新 nav 数组**

替换整个 `nav` 数组。变更点：
- "用户指南" link 从 `/guide/rules` 改为 `/guide/concepts`
- 删除 `{ text: '下载', link: '/reference/downloads' }` 条目

```typescript
nav: [
  { text: '首页', link: '/' },
  { text: '快速开始', link: '/start/install' },
  { text: '用户指南', link: '/guide/concepts' },
  { text: '团队协作', link: '/team/repository-structure' },
  { text: '高级功能', link: '/advanced/' },
  { text: '开发者', link: '/developer/' },
  { text: '参考', link: '/reference/synapse-mcp-capabilities' }
],
```

- [ ] **Step 2: 更新 guide sidebar — 核心概念移到第一位**

替换 `'/guide/'` sidebar 配置：

```typescript
'/guide/': [{ text: '用户指南', items: [
  { text: '核心概念', link: '/guide/concepts' },
  { text: 'Rule', link: '/guide/rules' },
  { text: 'Skill', link: '/guide/skills' },
  { text: '编辑器安装', link: '/guide/editors' },
  { text: '设置', link: '/guide/settings' }
]}],
```

- [ ] **Step 3: 更新 developer sidebar — 添加能力文档**

替换 `'/developer/'` sidebar 配置：

```typescript
'/developer/': [{ text: '开发者', items: [
  { text: '总览', link: '/developer/' },
  { text: '本地开发', link: '/developer/local-development' },
  { text: '项目结构', link: '/developer/project-structure' },
  { text: '构建与发布', link: '/developer/build-release' },
  { text: '能力矩阵', link: '/developer/capability-naming-matrix' },
  { text: '能力维护', link: '/developer/capability-authoring' }
]}],
```

- [ ] **Step 4: 更新 reference sidebar — 删除已移走的条目和下载**

替换 `'/reference/'` sidebar 配置：

```typescript
'/reference/': [{ text: '参考', items: [
  { text: '常见问题', link: '/reference/faq' },
  { text: '排障', link: '/reference/troubleshooting' },
  { text: '术语表', link: '/reference/glossary' },
  { text: 'MCP 能力', link: '/reference/synapse-mcp-capabilities' }
]}]
```

- [ ] **Step 5: Commit**

```bash
git add website/.vitepress/config.mts
git commit -m "refactor(website): reorganize nav and sidebar structure"
```

---

### Task 4: 更新首页 hero 和 CTA

**Files:**
- Modify: `website/index.md`

- [ ] **Step 1: 替换 hero 和 actions 部分**

替换 `index.md` 的 frontmatter 中 hero 部分：

```yaml
hero:
  name: Synapse
  text: 跨编辑器 AI 能力管理工具
  tagline: 集中管理 Rule、Skill 与 Prompt，一键安装到 Claude Code、Cursor、Codex 等编辑器。
  image:
    src: /icon.png
    alt: Synapse
  actions:
    - theme: brand
      text: 快速开始
      link: /start/install
    - theme: alt
      text: GitHub
      link: https://github.com/FairyEver/Synapse
```

- [ ] **Step 2: 替换 features 部分**

替换 `index.md` 的 frontmatter 中 features 部分：

```yaml
features:
  - title: Rule 与 Skill 管理
    details: 集中管理可复用的规则和能力包，支持分类、搜索、收藏和版本查看。
  - title: 跨编辑器安装
    details: 将内容安装到 Claude Code、Cursor、Codex、Windsurf，可选全局或项目范围。
  - title: 仓库与团队共享
    details: 使用本地目录或 Git 仓库维护团队内容，保留变更记录，支持同步和删除恢复。
  - title: 已有内容迁移
    details: 扫描编辑器中已有的 Rule 和 Skill，导入到仓库或复制到其他编辑器。
  - title: Agent
    details: 配置和管理 AI Agent 工作流，定义执行步骤和触发条件。
  - title: 内置数据库与 MCP
    details: 使用内置 Database 管理本地数据表，并将数据服务注册为 MCP Server。
  - title: 定时任务调度
    details: 通过 cron 或 interval 表达式调度任务，支持启停控制和运行记录查看。
  - title: 诊断工具
    details: 检查编辑器配置状态和内容安装情况，快速定位问题。
```

- [ ] **Step 3: 删除 frontmatter 后的 Sources 注释**

删除 `---` 之后的 `<!-- Sources: ... -->` 注释行。

- [ ] **Step 4: Commit**

```bash
git add website/index.md
git commit -m "feat(website): update homepage hero, CTA and features"
```

---

### Task 5: 品牌色 CSS 变量覆盖

**Files:**
- Modify: `website/.vitepress/theme/custom.css`

- [ ] **Step 1: 替换 custom.css 全部内容**

```css
:root {
  --vp-c-brand-1: #181818;
  --vp-c-brand-2: #2c2c2c;
  --vp-c-brand-3: #3a3a3a;
  --vp-c-brand-soft: rgba(24, 24, 24, 0.1);

  --vp-button-brand-bg: #181818;
  --vp-button-brand-text: #ffffff;
  --vp-button-brand-hover-bg: #2c2c2c;
  --vp-button-brand-hover-text: #ffffff;
  --vp-button-brand-active-bg: #3a3a3a;
  --vp-button-brand-active-text: #ffffff;

  --vp-home-hero-image-background-image: none;
  --vp-home-hero-image-filter: none;
}

.VPHero .tagline {
  white-space: pre-line;
}

.dark {
  --vp-c-brand-1: #f5f5f5;
  --vp-c-brand-2: #e0e0e0;
  --vp-c-brand-3: #cccccc;
  --vp-c-brand-soft: rgba(245, 245, 245, 0.1);

  --vp-button-brand-bg: #f5f5f5;
  --vp-button-brand-text: #181818;
  --vp-button-brand-hover-bg: #e0e0e0;
  --vp-button-brand-hover-text: #181818;
  --vp-button-brand-active-bg: #cccccc;
  --vp-button-brand-active-text: #181818;

  --vp-home-hero-image-background-image: none;
  --vp-home-hero-image-filter: none;
}
```

- [ ] **Step 2: Commit**

```bash
git add website/.vitepress/theme/custom.css
git commit -m "feat(website): add black brand color theme"
```

---

### Task 6: 验证

- [ ] **Step 1: 启动 dev server 验证构建**

```bash
cd website && pnpm dev
```

在浏览器中检查：
- 首页 hero 文案、CTA 按钮、features 列表是否正确
- 亮色/暗色模式下品牌色是否生效（链接、按钮为黑/白色系）
- nav 导航条目是否正确（7 项，无"下载"）
- 用户指南 sidebar 顺序：核心概念在第一位
- 开发者 sidebar 包含能力矩阵和能力维护
- 参考 sidebar 仅 4 项（无下载、无能力文档）
- 已删除页面的 URL 返回 404（`/guide/features`、`/guide/faq`、`/guide/download`、`/guide/introduction`、`/reference/downloads`）

- [ ] **Step 2: 确认无断链**

```bash
grep -r "/guide/features\|/guide/faq\|/guide/download\|/guide/introduction\|/reference/downloads" website/ --include="*.md" --include="*.mts"
```

预期输出为空。如有残留引用，修复后追加 commit。
