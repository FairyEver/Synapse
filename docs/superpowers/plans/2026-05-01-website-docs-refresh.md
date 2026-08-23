# Website Docs Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the VitePress documentation site into a publishable, task-first documentation set that only describes currently implemented Synapse behavior.

**Architecture:** Keep the implementation inside `website/`. Use VitePress nav/sidebar configuration for the new information architecture, Markdown pages for content, and source-reading checkpoints before every content batch. Each page must be written from code or existing authoritative documentation, never from product guesses.

**Tech Stack:** VitePress 1.5, Markdown, TypeScript config, pnpm workspace scripts.

---

## File Structure

- Modify: `website/.vitepress/config.mts`
  - Replace the current flat guide nav/sidebar with task-first groups: 快速开始、用户指南、团队协作、高级功能、开发者、参考.
- Modify: `website/index.md`
  - Keep the VitePress home layout, rewrite product copy and feature cards around the verified core workflow.
- Keep and rewrite: `website/guide/concepts.md`
  - Retain as a concept reference if still useful, linked from guide/reference sections.
- Keep and rewrite or move content from:
  - `website/guide/download.md`
  - `website/guide/faq.md`
  - `website/guide/features.md`
  - `website/guide/introduction.md`
- Create:
  - `website/start/install.md`
  - `website/start/repository.md`
  - `website/start/first-install.md`
  - `website/guide/rules.md`
  - `website/guide/skills.md`
  - `website/guide/editors.md`
  - `website/guide/settings.md`
  - `website/team/repository-structure.md`
  - `website/team/content-authoring.md`
  - `website/team/share-review.md`
  - `website/advanced/index.md`
  - `website/advanced/agent.md`
  - `website/advanced/prompts.md`
  - `website/advanced/database.md`
  - `website/advanced/task-scheduler.md`
  - `website/advanced/editor-scan.md`
  - `website/advanced/diagnostics.md`
  - `website/developer/index.md`
  - `website/developer/local-development.md`
  - `website/developer/project-structure.md`
  - `website/developer/build-release.md`
  - `website/reference/faq.md`
  - `website/reference/troubleshooting.md`
  - `website/reference/glossary.md`
  - `website/reference/downloads.md`

## Ground Rules For Every Task

- Before editing a page, read the source files listed in that task.
- Add a Markdown comment near the top of each new or rewritten page in this form:

```markdown
<!-- Sources: root README.md; desktop/README.md; desktop/src/modules/rules/index.tsx -->
```

- Only document facts visible in those sources.
- If source evidence is unclear, write a narrower statement or omit the claim.
- Do not start dev servers, browser previews, Playwright, or Chrome DevTools.
- Do not touch `desktop/` files.
- Do not stage or commit the existing unrelated dirty `desktop/` changes.

---

### Task 1: Confirm Website Baseline And Evidence Discipline

**Files:**
- No file changes.

- [ ] **Step 1: Read current website and workspace scripts**

Run:

```bash
sed -n '1,240p' website/.vitepress/config.mts
sed -n '1,220p' website/README.md
sed -n '1,220p' website/index.md
sed -n '1,220p' package.json
sed -n '1,220p' website/package.json
```

Expected: confirm the site is VitePress, `website/README.md` is excluded by `srcExclude`, and `pnpm --filter @synapse/website run build` is the verification command.

- [ ] **Step 2: Confirm current page inventory**

Run:

```bash
find website -path 'website/node_modules' -prune -o -path 'website/.vitepress/dist' -prune -o -name '*.md' -print | sort
```

Expected: only the current website pages are listed before implementation starts. New pages are created in later tasks only when their source evidence has been read.

- [ ] **Step 3: Confirm no implementation files are touched**

Run:

```bash
git status --short website docs/superpowers/plans/2026-05-01-website-docs-refresh.md
```

Expected: only this plan file is dirty at planning time. Do not commit Task 1 during implementation because it is a read-only checkpoint.

---

### Task 2: Write Quick Start And Download Pages From Existing Docs

**Files:**
- Modify: `website/index.md`
- Create: `website/start/install.md`
- Create: `website/start/repository.md`
- Create: `website/start/first-install.md`
- Create: `website/reference/downloads.md`

- [ ] **Step 1: Read source evidence**

Run:

```bash
sed -n '1,220p' README.md
sed -n '1,260p' desktop/README.md
sed -n '1,240p' website/index.md
sed -n '1,240p' website/guide/download.md
sed -n '1,240p' website/guide/features.md
sed -n '1,220p' desktop/package.json
```

Expected evidence:
- macOS package is `.dmg`; Windows package is `.exe`.
- Root `pnpm dev` starts the broader local development environment.
- Desktop package scripts include `build`, `package:mac`, and `package:win`.

- [ ] **Step 2: Write `website/reference/downloads.md`**

Write the page with this structure:

```markdown
# 下载

<!-- Sources: README.md; desktop/README.md; website/guide/download.md; desktop/package.json -->

## 安装包

| 系统 | 安装包 |
| --- | --- |
| macOS | `.dmg` |
| Windows | `.exe` |

## 相关链接

- [下载与安装](/start/install)
- [本地开发](/developer/local-development)
```

- [ ] **Step 3: Rewrite `website/start/install.md`**

Use headings: `# 下载与安装`, `## 下载`, `## macOS`, `## Windows`, `## 下一步`. Include only the verified macOS and Windows install steps already present in `website/guide/download.md`. Link the next step to `/start/repository`.

- [ ] **Step 4: Rewrite `website/start/repository.md`**

Use headings: `# 配置内容仓库`, `## 仓库是什么`, `## 使用本地目录`, `## 使用 Git 仓库`, `## 下一步`. Explain the repository as the local source of Rules and Skills, and distinguish local directory vs Git repository using existing `website/guide/concepts.md` and `website/guide/download.md`.

- [ ] **Step 5: Rewrite `website/start/first-install.md`**

Use headings: `# 安装第一个内容`, `## 选择 Rule 或 Skill`, `## 选择编辑器`, `## 选择安装范围`, `## 安装后检查`. Mention Claude Code、Cursor、Codex only if confirmed by `desktop/README.md` or editor definitions read in Task 3. Avoid detailed install paths here; link to `/guide/editors`.

- [ ] **Step 6: Rewrite `website/index.md`**

Keep `layout: home`. Use:
- `hero.name: Synapse`
- `hero.text: 跨编辑器 Rules & Skills 管理工具`
- `hero.tagline`: one or two lines about统一维护、搜索、安装团队提示词资产
- Actions: `快速开始` -> `/start/install`, `下载` -> `/reference/downloads`, `GitHub` -> repository URL.
- Features: Rules、Skills、编辑器安装、内容仓库、团队协作、高级功能入口.

Do not mention unsupported or unverified future features.

- [ ] **Step 7: Build and commit**

Run:

```bash
pnpm --filter @synapse/website run build
git add website/index.md website/start/install.md website/start/repository.md website/start/first-install.md website/reference/downloads.md
git commit -m "docs: write website quick start"
```

Expected: build passes before commit.

---

### Task 3: Write Core User Guide From Rules, Skills, Settings, And Concepts Code

**Files:**
- Create: `website/guide/rules.md`
- Create: `website/guide/skills.md`
- Create: `website/guide/editors.md`
- Create: `website/guide/settings.md`
- Modify: `website/guide/concepts.md`

- [ ] **Step 1: Read renderer and service evidence**

Run:

```bash
sed -n '1,260p' desktop/src/modules/rules/index.tsx
sed -n '1,260p' desktop/src/modules/rules/utils.ts
sed -n '1,260p' desktop/src/modules/skills/index.tsx
sed -n '1,260p' desktop/src/modules/skills/types.ts
sed -n '1,260p' desktop/src/modules/skills/utils.ts
sed -n '1,260p' desktop/src/modules/settings/index.tsx
sed -n '1,260p' desktop/src/modules/settings/data.ts
sed -n '1,260p' desktop/src/modules/settings/types.ts
sed -n '1,320p' desktop/README.md
```

If a file imports a component that owns visible labels or behavior, read that component before writing the relevant section:

```bash
find desktop/src/modules/rules desktop/src/modules/skills desktop/src/modules/settings -maxdepth 3 -type f | sort
```

- [ ] **Step 2: Verify editor support from definitions**

Run:

```bash
find desktop/src/definitions/editor -maxdepth 2 -type f | sort
```

Read the `editor.ts`, `adapter.ts`, and `install.ts` files for each supported editor directory before documenting editor support or install paths. If the current code supports an editor that the old website omits, document the code-backed current state and do not rely on stale website text.

- [ ] **Step 3: Write `website/guide/rules.md`**

Use headings:
- `# Rule`
- `## 用途`
- `## 浏览与搜索`
- `## 下载`
- `## 安装`
- `## 什么时候用 Rule`

Document only behavior confirmed by `rules` module and content/editor services. Keep examples short and mark them as examples, not built-in content.

- [ ] **Step 4: Write `website/guide/skills.md`**

Use headings:
- `# Skill`
- `## 用途`
- `## 附件`
- `## 浏览与搜索`
- `## 下载`
- `## 安装`
- `## 什么时候用 Skill`

Confirm attachment behavior in code before mentioning drag/drop, zip export, or directory preservation.

- [ ] **Step 5: Write `website/guide/editors.md`**

Use headings:
- `# 编辑器安装`
- `## 支持范围`
- `## 全局安装`
- `## 项目级安装`
- `## 安装状态`
- `## 路径参考`

The support table must be generated from current editor definitions and install strategies, not copied blindly from old website pages.

- [ ] **Step 6: Write `website/guide/settings.md`**

Use headings:
- `# 设置`
- `## 仓库`
- `## 项目`
- `## 用户信息`
- `## 更新`
- `## 诊断入口`

Only include sections visible in current settings code. If the current UI uses different labels, use the UI labels.

- [ ] **Step 7: Rewrite `website/guide/concepts.md`**

Keep Rule、Skill、仓库、项目 as core concepts. Update editor names and install scope statements to match the source evidence from Steps 1-2.

- [ ] **Step 8: Build and commit**

Run:

```bash
pnpm --filter @synapse/website run build
git add website/guide/rules.md website/guide/skills.md website/guide/editors.md website/guide/settings.md website/guide/concepts.md
git commit -m "docs: write core user guide"
```

Expected: build passes before commit.

---

### Task 4: Write Team Collaboration Pages From Content And Repository Services

**Files:**
- Create: `website/team/repository-structure.md`
- Create: `website/team/content-authoring.md`
- Create: `website/team/share-review.md`

- [ ] **Step 1: Read source evidence**

Run:

```bash
sed -n '1,280p' desktop/electron/services/content-service.ts
sed -n '1,280p' desktop/electron/services/content-index-service.ts
sed -n '1,280p' desktop/electron/services/content-write-service.ts
sed -n '1,280p' desktop/electron/services/content-submission-service.ts
sed -n '1,280p' desktop/electron/services/repository-structure-service.ts
sed -n '1,280p' desktop/electron/services/repository-git-service.ts
sed -n '1,240p' desktop/electron/services/pending-pushes-service.ts
sed -n '1,240p' desktop/electron/services/repository-store.ts
```

If these services reference schema or type files, read those files before writing field names or directory names.

- [ ] **Step 2: Write `website/team/repository-structure.md`**

Use headings:
- `# 仓库结构`
- `## 仓库目录`
- `## Rules`
- `## Skills`
- `## Git 仓库与本地目录`

Do not invent a recommended directory tree unless `repository-structure-service.ts` or related code confirms it.

- [ ] **Step 3: Write `website/team/content-authoring.md`**

Use headings:
- `# 内容编写`
- `## Rule 编写`
- `## Skill 编写`
- `## 标题、简介与分类`
- `## 附件`

Use code-confirmed fields only. Include concise writing guidance, but avoid making it sound like product behavior if it is merely recommendation.

- [ ] **Step 4: Write `website/team/share-review.md`**

Use headings:
- `# 分享与审核`
- `## 创建内容`
- `## 提交`
- `## 审核`
- `## 同步`

Only describe Git branch/commit/push behavior if confirmed in `content-submission-service.ts` and `repository-git-service.ts`.

- [ ] **Step 5: Build and commit**

Run:

```bash
pnpm --filter @synapse/website run build
git add website/team/repository-structure.md website/team/content-authoring.md website/team/share-review.md
git commit -m "docs: write team collaboration guide"
```

Expected: build passes before commit.

---

### Task 5: Write Advanced Feature Pages From Each Module

**Files:**
- Create: `website/advanced/index.md`
- Create: `website/advanced/agent.md`
- Create: `website/advanced/prompts.md`
- Create: `website/advanced/database.md`
- Create: `website/advanced/task-scheduler.md`
- Create: `website/advanced/editor-scan.md`
- Create: `website/advanced/diagnostics.md`

- [ ] **Step 1: Read Agent evidence**

Run:

```bash
find desktop/src/modules/agent desktop/electron/modules/agent desktop/electron/services/agent-runtime -maxdepth 3 -type f | sort
sed -n '1,280p' desktop/src/modules/agent/index.tsx
sed -n '1,240p' desktop/src/modules/agent/live-sync.ts
sed -n '1,240p' desktop/src/modules/agent/project-resolution.ts
sed -n '1,260p' desktop/electron/modules/agent/ipc.ts
```

Read additional files listed by `find` when they define visible behavior.

- [ ] **Step 2: Read Prompts evidence**

Run:

```bash
find desktop/src/modules/prompts -maxdepth 3 -type f | sort
sed -n '1,260p' desktop/src/modules/prompts/index.tsx
```

- [ ] **Step 3: Read Database evidence**

Run:

```bash
find desktop/src/modules/database desktop/electron/database -maxdepth 3 -type f | sort
sed -n '1,320p' desktop/src/modules/database/index.tsx
sed -n '1,280p' desktop/electron/database/service.ts
sed -n '1,240p' desktop/electron/database/types.ts
```

- [ ] **Step 4: Read Task Scheduler evidence**

Run:

```bash
find desktop/src/modules/task-scheduler desktop/electron/services/task-scheduler desktop/electron/modules/task-scheduler -maxdepth 3 -type f | sort
sed -n '1,320p' desktop/src/modules/task-scheduler/index.tsx
sed -n '1,280p' desktop/src/modules/task-scheduler/types.ts
sed -n '1,280p' desktop/electron/services/task-scheduler/types.ts
sed -n '1,280p' desktop/electron/services/task-scheduler/task-scheduler-service.ts
```

- [ ] **Step 5: Read Editor Scan and Diagnostics evidence**

Run:

```bash
find desktop/src/modules/editor-scan desktop/electron/modules/editor-scan desktop/electron/services -maxdepth 3 -type f | rg 'editor-scan|diagnostics' | sort
sed -n '1,320p' desktop/src/modules/editor-scan/index.tsx
sed -n '1,280p' desktop/electron/services/editor-scan-service.ts
sed -n '1,320p' desktop/src/modules/settings/components/diagnostics-panel.tsx
sed -n '1,280p' desktop/electron/services/diagnostics-service.ts
```

- [ ] **Step 6: Write advanced pages**

For each page use this structure, omitting any section that cannot be supported by the files read for that page:

```markdown
# Feature Name

<!-- Sources: list exact files read for this page -->

## 能做什么

## 怎么使用

## 注意事项
```

The body text under each heading must be complete, code-backed user documentation before commit. If a feature lacks enough evidence for a section, omit that section.

- [ ] **Step 7: Write `website/advanced/index.md`**

Create a short index linking to all advanced pages. Keep it factual and avoid promotional descriptions.

- [ ] **Step 8: Build and commit**

Run:

```bash
pnpm --filter @synapse/website run build
git add website/advanced
git commit -m "docs: write advanced feature guide"
```

Expected: build passes before commit.

---

### Task 6: Write Developer Pages From Repository Docs And Scripts

**Files:**
- Create: `website/developer/index.md`
- Create: `website/developer/local-development.md`
- Create: `website/developer/project-structure.md`
- Create: `website/developer/build-release.md`

- [ ] **Step 1: Read developer evidence**

Run:

```bash
sed -n '1,260p' README.md
sed -n '1,360p' desktop/README.md
sed -n '1,260p' package.json
sed -n '1,320p' desktop/package.json
sed -n '1,220p' pnpm-workspace.yaml
find .github/workflows -maxdepth 1 -type f | sort
```

Read release workflow before documenting release behavior:

```bash
sed -n '1,320p' .github/workflows/release.yml
```

- [ ] **Step 2: Write `website/developer/index.md`**

Use headings:
- `# 开发者`
- `## 本地开发`
- `## 项目结构`
- `## 构建与发布`

Link to the three developer pages.

- [ ] **Step 3: Write `website/developer/local-development.md`**

Document prerequisites and commands confirmed by `README.md`, `desktop/README.md`, and package scripts:

```bash
pnpm install
pnpm dev
pnpm quit
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/website run build
```

Do not document commands that are not present in package scripts.

- [ ] **Step 4: Write `website/developer/project-structure.md`**

Document the monorepo structure confirmed by `AGENTS.md`, `README.md`, and current directories:

```text
desktop/
server/
server/admin/
website/
docs/
```

For `desktop/`, mention renderer modules under `desktop/src/modules/`, Electron code under `desktop/electron/`, and shared UI under `desktop/src/components/`.

- [ ] **Step 5: Write `website/developer/build-release.md`**

Document build and packaging commands from `desktop/package.json` and release behavior from `.github/workflows/release.yml`.

- [ ] **Step 6: Build and commit**

Run:

```bash
pnpm --filter @synapse/website run build
git add website/developer
git commit -m "docs: write developer guide"
```

Expected: build passes before commit.

---

### Task 7: Write Reference Pages And Migrate Old FAQ Content

**Files:**
- Create: `website/reference/faq.md`
- Create: `website/reference/troubleshooting.md`
- Create: `website/reference/glossary.md`
- Modify: `website/guide/faq.md`
- Modify: `website/guide/download.md`
- Modify: `website/guide/features.md`
- Modify: `website/guide/introduction.md`

- [ ] **Step 1: Read existing reference content**

Run:

```bash
sed -n '1,260p' website/guide/faq.md
sed -n '1,240p' website/guide/download.md
sed -n '1,240p' website/guide/features.md
sed -n '1,240p' website/guide/introduction.md
```

- [ ] **Step 2: Write `website/reference/faq.md`**

Move still-accurate FAQ content into reference FAQ. Remove claims that were contradicted or not confirmed by Tasks 2-6.

- [ ] **Step 3: Write `website/reference/troubleshooting.md`**

Use headings:
- `# 排障`
- `## 安装包无法打开`
- `## 看不到仓库内容`
- `## 安装按钮不可用`
- `## 同步失败`

Only keep troubleshooting paths confirmed by existing docs or code.

- [ ] **Step 4: Write `website/reference/glossary.md`**

Define only terms already used in the docs: Rule、Skill、仓库、项目、全局安装、项目级安装、编辑器.

- [ ] **Step 5: Convert old moved pages into short compatibility pages**

Because VitePress static redirects are not configured, keep these pages as compatibility pages with short links:

```markdown
# 页面已迁移

<!-- Sources: website/.vitepress/config.mts -->

请查看新的文档页面：

- [快速开始](/start/install)
- [用户指南](/guide/rules)
- [参考](/reference/faq)
```

Apply this pattern to old pages whose content moved: `website/guide/faq.md`, `website/guide/download.md`, `website/guide/features.md`, and `website/guide/introduction.md`.

- [ ] **Step 6: Build and commit**

Run:

```bash
pnpm --filter @synapse/website run build
git add website/reference website/guide/faq.md website/guide/download.md website/guide/features.md website/guide/introduction.md
git commit -m "docs: write website reference pages"
```

Expected: build passes before commit.

---

### Task 8: Wire Navigation And Run Final Audit

**Files:**
- Modify: `website/.vitepress/config.mts`
- Modify only pages that fail the audit.

- [ ] **Step 1: Read current config**

Run:

```bash
sed -n '1,260p' website/.vitepress/config.mts
```

- [ ] **Step 2: Update nav and sidebar**

Edit `website/.vitepress/config.mts` so `themeConfig.nav` is:

```ts
nav: [
  { text: '首页', link: '/' },
  { text: '快速开始', link: '/start/install' },
  { text: '用户指南', link: '/guide/rules' },
  { text: '团队协作', link: '/team/repository-structure' },
  { text: '高级功能', link: '/advanced/' },
  { text: '开发者', link: '/developer/' },
  { text: '下载', link: '/reference/downloads' }
],
```

Replace `themeConfig.sidebar` with route groups for `/start/`, `/guide/`, `/team/`, `/advanced/`, `/developer/`, and `/reference/`. Use these labels and links:

```ts
sidebar: {
  '/start/': [
    {
      text: '快速开始',
      items: [
        { text: '下载与安装', link: '/start/install' },
        { text: '配置内容仓库', link: '/start/repository' },
        { text: '安装第一个内容', link: '/start/first-install' }
      ]
    }
  ],
  '/guide/': [
    {
      text: '用户指南',
      items: [
        { text: 'Rule', link: '/guide/rules' },
        { text: 'Skill', link: '/guide/skills' },
        { text: '编辑器安装', link: '/guide/editors' },
        { text: '设置', link: '/guide/settings' },
        { text: '核心概念', link: '/guide/concepts' }
      ]
    }
  ],
  '/team/': [
    {
      text: '团队协作',
      items: [
        { text: '仓库结构', link: '/team/repository-structure' },
        { text: '内容编写', link: '/team/content-authoring' },
        { text: '分享与审核', link: '/team/share-review' }
      ]
    }
  ],
  '/advanced/': [
    {
      text: '高级功能',
      items: [
        { text: '总览', link: '/advanced/' },
        { text: 'Agent', link: '/advanced/agent' },
        { text: 'Prompts', link: '/advanced/prompts' },
        { text: 'Database', link: '/advanced/database' },
        { text: 'Task Scheduler', link: '/advanced/task-scheduler' },
        { text: 'Editor Scan', link: '/advanced/editor-scan' },
        { text: 'Diagnostics', link: '/advanced/diagnostics' }
      ]
    }
  ],
  '/developer/': [
    {
      text: '开发者',
      items: [
        { text: '总览', link: '/developer/' },
        { text: '本地开发', link: '/developer/local-development' },
        { text: '项目结构', link: '/developer/project-structure' },
        { text: '构建与发布', link: '/developer/build-release' }
      ]
    }
  ],
  '/reference/': [
    {
      text: '参考',
      items: [
        { text: '常见问题', link: '/reference/faq' },
        { text: '排障', link: '/reference/troubleshooting' },
        { text: '术语表', link: '/reference/glossary' },
        { text: '下载', link: '/reference/downloads' }
      ]
    }
  ]
},
```

- [ ] **Step 3: Verify every Markdown page has a source comment**

Run:

```bash
find website -path 'website/node_modules' -prune -o -path 'website/.vitepress/dist' -prune -o -name '*.md' -print | sort
```

Open every listed page except `website/README.md`; confirm each content page has a `<!-- Sources:` comment near the top.

- [ ] **Step 4: Check internal links**

Run:

```bash
rg -n "\\]\\(/" website --glob '*.md'
```

For every internal link, confirm the target file exists under `website/` or is a VitePress clean URL backed by a Markdown file.

- [ ] **Step 5: Search for unsupported language**

Run:

```bash
rg -n "待补充|规划中|敬请期待|应该可以|可能支持" website
```

Expected: no matches. If there are matches, rewrite or delete those sentences.

- [ ] **Step 6: Build the site**

Run:

```bash
pnpm --filter @synapse/website run build
```

Expected: PASS.

- [ ] **Step 7: Inspect git diff**

Run:

```bash
git diff --stat
git diff -- website
git status --short
```

Expected:
- Changes are limited to `website/` for implementation.
- Existing unrelated dirty `desktop/` files remain unstaged.
- No temporary `.superpowers/` files are staged.

- [ ] **Step 8: Commit navigation and final fixes**

Run:

```bash
git add website/.vitepress/config.mts website
git commit -m "docs: wire website documentation navigation"
```

Expected: navigation, audit fixes, and website docs are committed without staging unrelated `desktop/` changes.

---

## Self-Review

- Spec coverage: The plan covers the requested task-first IA, publishable content, user/team/developer audiences, mature core path, advanced feature section, implementation boundary inside `website/`, build verification, link audit, and the hard rule that every page must be sourced from code or authoritative docs.
- Placeholder scan: The plan does not create placeholder pages; each page is written after its evidence-reading step.
- Scope check: This is one website documentation subsystem. It does not require separate implementation plans because tasks are sequential content batches inside the same VitePress site.
