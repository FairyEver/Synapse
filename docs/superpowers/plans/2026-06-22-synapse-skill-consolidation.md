# Synapse Skill Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate built-in Synapse MCP Skill templates with one `synapse-skill` template that routes to domain folders.

**Architecture:** This is a built-in template migration. The root `content.md` becomes the installed Skill's primary `SKILL.md`; domain instructions live in attachment folders under `files/<domain>/`, each with an `index.md` and `api-reference.md`. Existing template loading code already supports nested attachments, so the implementation should only change templates, focused template tests, and release notes.

**Tech Stack:** Electron main-process template loader, built-in content templates under `desktop/resources/templates`, Vitest, Markdown, JSON.

---

## File Structure

- Modify: `desktop/electron/services/__tests__/repository-template-service.test.ts`
  - Replace tests that expect the eight old `synapse-*-mcp` templates with tests for one `synapse-skill`.
  - Keep coverage for Drive tools, Automation workflow executor docs, and Model Price safety docs by looking inside the new domain attachments.
- Create: `desktop/resources/templates/skills/synapse-skill/meta.json`
  - The only visible built-in Synapse MCP Skill metadata.
- Create: `desktop/resources/templates/skills/synapse-skill/content.md`
  - Short router entry point.
- Create: `desktop/resources/templates/skills/synapse-skill/files/{automation,content,database,drive,model-price,repository,variable,workflow}/index.md`
  - Domain secondary entry points copied from each old `content.md`.
- Create: `desktop/resources/templates/skills/synapse-skill/files/{automation,content,database,drive,model-price,repository,variable,workflow}/api-reference.md`
  - Domain reference files copied from each old `files/api-reference.md`.
- Delete:
  - `desktop/resources/templates/skills/synapse-automation-mcp/`
  - `desktop/resources/templates/skills/synapse-content-mcp/`
  - `desktop/resources/templates/skills/synapse-database-mcp/`
  - `desktop/resources/templates/skills/synapse-drive-mcp/`
  - `desktop/resources/templates/skills/synapse-model-price-mcp/`
  - `desktop/resources/templates/skills/synapse-repository-mcp/`
  - `desktop/resources/templates/skills/synapse-variable-mcp/`
  - `desktop/resources/templates/skills/synapse-workflow-mcp/`
- Modify: `RELEASE_NOTES_PENDING.md`
  - Add one user-facing note under `## 功能优化`.

### Task 1: Update Focused Template Tests

**Files:**
- Modify: `desktop/electron/services/__tests__/repository-template-service.test.ts`

- [ ] **Step 1: Write failing tests for the consolidated template**

Replace the existing Synapse MCP Skill tests in `desktop/electron/services/__tests__/repository-template-service.test.ts` with these helpers and tests, keeping the current imports:

```ts
function readAttachmentText(
  seed: Awaited<ReturnType<typeof readRepositorySeedContents>>[number] | undefined,
  originalName: string,
): string {
  const attachment = seed?.attachments
    ?.find((candidate) => candidate.originalName === originalName)

  return attachment ? Buffer.from(attachment.bytes).toString("utf8") : ""
}

describe("RepositoryTemplateService", () => {
  it("ships one consolidated Synapse Skill template", async () => {
    const seeds = await readRepositorySeedContents()
    const skillIds = seeds
      .filter((seed) => seed.type === "skill")
      .map((seed) => seed.id)
      .sort((left, right) => left.localeCompare(right))

    expect(skillIds).toContain("synapse-skill")
    expect(skillIds).toContain("synapse-test-skill")
    expect(skillIds).toContain("bark-notification")
    expect(skillIds).not.toContain("synapse-automation-mcp")
    expect(skillIds).not.toContain("synapse-content-mcp")
    expect(skillIds).not.toContain("synapse-database-mcp")
    expect(skillIds).not.toContain("synapse-drive-mcp")
    expect(skillIds).not.toContain("synapse-model-price-mcp")
    expect(skillIds).not.toContain("synapse-repository-mcp")
    expect(skillIds).not.toContain("synapse-variable-mcp")
    expect(skillIds).not.toContain("synapse-workflow-mcp")
  })

  it("keeps the consolidated Synapse Skill metadata stable", async () => {
    const seeds = await readRepositorySeedContents()
    const synapseSkill = seeds.find((seed) => seed.id === "synapse-skill")

    expect(synapseSkill).toMatchObject({
      id: "synapse-skill",
      name: "synapse-skill",
      title: "Synapse Skill",
      category: "automation",
      icon: "workflow",
      iconBg: "teal",
    })
    expect(synapseSkill?.description).toContain("Database")
    expect(synapseSkill?.description).toContain("Drive")
    expect(synapseSkill?.description).toContain("Workflow")
    expect(synapseSkill?.content).toContain("database/index.md")
    expect(synapseSkill?.content).toContain("workflow/index.md")
  })

  it("ships every Synapse Skill domain folder attachment", async () => {
    const seeds = await readRepositorySeedContents()
    const synapseSkill = seeds.find((seed) => seed.id === "synapse-skill")
    const attachmentNames = synapseSkill?.attachments
      ?.map((attachment) => attachment.originalName)
      .sort((left, right) => left.localeCompare(right))

    expect(attachmentNames).toEqual([
      "automation/api-reference.md",
      "automation/index.md",
      "content/api-reference.md",
      "content/index.md",
      "database/api-reference.md",
      "database/index.md",
      "drive/api-reference.md",
      "drive/index.md",
      "model-price/api-reference.md",
      "model-price/index.md",
      "repository/api-reference.md",
      "repository/index.md",
      "variable/api-reference.md",
      "variable/index.md",
      "workflow/api-reference.md",
      "workflow/index.md",
    ])
  })

  it("documents Drive share access settings in the consolidated Synapse Skill", async () => {
    const seeds = await readRepositorySeedContents()
    const synapseSkill = seeds.find((seed) => seed.id === "synapse-skill")
    const driveIndex = readAttachmentText(synapseSkill, "drive/index.md")

    expect(driveIndex).not.toContain("不处理密码分享")
    expect(driveIndex).toContain("passwordEnabled")
    expect(driveIndex).toContain("expiresIn")
  })

  it("documents every Drive MCP tool in the consolidated API reference", async () => {
    const seeds = await readRepositorySeedContents()
    const synapseSkill = seeds.find((seed) => seed.id === "synapse-skill")
    const apiText = readAttachmentText(synapseSkill, "drive/api-reference.md")

    const missingTools = buildDriveTools()
      .map((tool) => tool.name)
      .filter((toolName) => !apiText.includes(`\`${toolName}\``))

    expect(missingTools).toEqual([])
  })

  it("documents Workflow executors in the consolidated Automation domain", async () => {
    const seeds = await readRepositorySeedContents()
    const synapseSkill = seeds.find((seed) => seed.id === "synapse-skill")
    const automationIndex = readAttachmentText(synapseSkill, "automation/index.md")
    const apiText = readAttachmentText(synapseSkill, "automation/api-reference.md")

    expect(automationIndex).toContain("builtin.workflow")
    expect(automationIndex).toContain("workflowId")
    expect(automationIndex).toContain("paramTemplates")
    expect(apiText).toContain("builtin.workflow")
    expect(apiText).toContain("paramTemplates")
  })

  it("does not force a POSIX shell in consolidated Automation examples", async () => {
    const seeds = await readRepositorySeedContents()
    const synapseSkill = seeds.find((seed) => seed.id === "synapse-skill")
    const apiText = readAttachmentText(synapseSkill, "automation/api-reference.md")

    expect(apiText).toContain("automation_executor_type_list")
    expect(apiText).toContain("defaultConfig")
    expect(apiText).not.toContain('"shell": "posix"')
  })

  it("documents safe Model Price MCP rule operations in the consolidated skill", async () => {
    const seeds = await readRepositorySeedContents()
    const synapseSkill = seeds.find((seed) => seed.id === "synapse-skill")
    const modelPriceIndex = readAttachmentText(synapseSkill, "model-price/index.md")
    const apiText = readAttachmentText(synapseSkill, "model-price/api-reference.md")

    expect(modelPriceIndex).toContain("model_price_used_model_list")
    expect(modelPriceIndex).toContain("ruleId")
    expect(modelPriceIndex).toContain("RMB per 1M tokens")
    expect(modelPriceIndex).toContain("Usage Analysis refresh")
    expect(modelPriceIndex).toContain("price-rule hash changes")
    expect(apiText).toContain("model_price_rule_update")
    expect(apiText).toContain("ruleId")
    expect(apiText).toContain("already indexed usage totals")
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/repository-template-service.test.ts
```

Expected: FAIL because `synapse-skill` does not exist yet and the old templates still exist.

- [ ] **Step 3: Commit the failing test**

Run:

```bash
git add desktop/electron/services/__tests__/repository-template-service.test.ts
git commit -m "test: cover consolidated synapse skill template"
```

### Task 2: Create the Consolidated Synapse Skill Template

**Files:**
- Create: `desktop/resources/templates/skills/synapse-skill/meta.json`
- Create: `desktop/resources/templates/skills/synapse-skill/content.md`
- Create: `desktop/resources/templates/skills/synapse-skill/files/*/index.md`
- Create: `desktop/resources/templates/skills/synapse-skill/files/*/api-reference.md`

- [ ] **Step 1: Create the domain folder structure**

Run:

```bash
mkdir -p \
  desktop/resources/templates/skills/synapse-skill/files/automation \
  desktop/resources/templates/skills/synapse-skill/files/content \
  desktop/resources/templates/skills/synapse-skill/files/database \
  desktop/resources/templates/skills/synapse-skill/files/drive \
  desktop/resources/templates/skills/synapse-skill/files/model-price \
  desktop/resources/templates/skills/synapse-skill/files/repository \
  desktop/resources/templates/skills/synapse-skill/files/variable \
  desktop/resources/templates/skills/synapse-skill/files/workflow
```

Expected: directories exist and no existing files are overwritten.

- [ ] **Step 2: Copy old domain instructions into secondary entry files**

Run:

```bash
cp desktop/resources/templates/skills/synapse-automation-mcp/content.md desktop/resources/templates/skills/synapse-skill/files/automation/index.md
cp desktop/resources/templates/skills/synapse-content-mcp/content.md desktop/resources/templates/skills/synapse-skill/files/content/index.md
cp desktop/resources/templates/skills/synapse-database-mcp/content.md desktop/resources/templates/skills/synapse-skill/files/database/index.md
cp desktop/resources/templates/skills/synapse-drive-mcp/content.md desktop/resources/templates/skills/synapse-skill/files/drive/index.md
cp desktop/resources/templates/skills/synapse-model-price-mcp/content.md desktop/resources/templates/skills/synapse-skill/files/model-price/index.md
cp desktop/resources/templates/skills/synapse-repository-mcp/content.md desktop/resources/templates/skills/synapse-skill/files/repository/index.md
cp desktop/resources/templates/skills/synapse-variable-mcp/content.md desktop/resources/templates/skills/synapse-skill/files/variable/index.md
cp desktop/resources/templates/skills/synapse-workflow-mcp/content.md desktop/resources/templates/skills/synapse-skill/files/workflow/index.md
```

Expected: each new `index.md` matches the old domain `content.md`.

- [ ] **Step 3: Copy old API references into domain folders**

Run:

```bash
cp desktop/resources/templates/skills/synapse-automation-mcp/files/api-reference.md desktop/resources/templates/skills/synapse-skill/files/automation/api-reference.md
cp desktop/resources/templates/skills/synapse-content-mcp/files/api-reference.md desktop/resources/templates/skills/synapse-skill/files/content/api-reference.md
cp desktop/resources/templates/skills/synapse-database-mcp/files/api-reference.md desktop/resources/templates/skills/synapse-skill/files/database/api-reference.md
cp desktop/resources/templates/skills/synapse-drive-mcp/files/api-reference.md desktop/resources/templates/skills/synapse-skill/files/drive/api-reference.md
cp desktop/resources/templates/skills/synapse-model-price-mcp/files/api-reference.md desktop/resources/templates/skills/synapse-skill/files/model-price/api-reference.md
cp desktop/resources/templates/skills/synapse-repository-mcp/files/api-reference.md desktop/resources/templates/skills/synapse-skill/files/repository/api-reference.md
cp desktop/resources/templates/skills/synapse-variable-mcp/files/api-reference.md desktop/resources/templates/skills/synapse-skill/files/variable/api-reference.md
cp desktop/resources/templates/skills/synapse-workflow-mcp/files/api-reference.md desktop/resources/templates/skills/synapse-skill/files/workflow/api-reference.md
```

Expected: each new `api-reference.md` matches the old domain reference file.

- [ ] **Step 4: Add the consolidated metadata**

Create `desktop/resources/templates/skills/synapse-skill/meta.json` with:

```json
{
  "id": "synapse-skill",
  "name": "synapse-skill",
  "title": "Synapse Skill",
  "usage": "让 AI 通过一个入口使用 Synapse MCP 能力，并按数据库、云盘、工作流、自动化、内容发布、价格规则、变量和仓库等意图读取对应说明。\n\n- **适合**：需要操作 Synapse Database、Drive、Workflow、Automation、Content、模型价格规则、本地变量或仓库配置的请求。\n- **会做**：先判断用户意图所属领域，再读取对应域文件夹里的 `index.md` 和必要引用文件；跨域任务按步骤连续路由。\n- **限制**：不把一个领域的规则套用到另一个领域；不自动清理用户已经安装到编辑器里的旧独立 Skill。",
  "description": "Use when operating Synapse through MCP tools, including Database, Drive, Workflow, Automation, Content, model price rules, variables, and repositories.",
  "category": "automation",
  "icon": "workflow",
  "iconBg": "teal"
}
```

- [ ] **Step 5: Add the root router content**

Create `desktop/resources/templates/skills/synapse-skill/content.md` with:

```md
# Synapse Skill

Use this skill when the user wants to operate Synapse through MCP tools.

## Routing

First classify the user's intent, then read the matching domain file before using tools:

- Database, tables, rows, columns, choices, SQL, table folders, mutation logs -> `database/index.md`
- Drive files, folders, upload, download, preview, share links, public assets, trash, versions -> `drive/index.md`
- Workflow definitions, nodes, edges, DAG validation, layout, variables, providers, workflow runs -> `workflow/index.md`
- Automation items, triggers, executors, enablement, manual runs, active runs, run history -> `automation/index.md`
- Rule, Skill, Prompt publishing and content resource management -> `content/index.md`
- Model price rules and used-model pricing -> `model-price/index.md`
- User-scoped local variables -> `variable/index.md`
- Configured Synapse repositories -> `repository/index.md`

If the task spans multiple domains, handle each part in order and read each relevant domain file.

If the user message contains `sss`, treat it as Synapse Services Shortcut. Infer the real domain from surrounding intent. Do not default to Database just because `sss` appears.

## Boundaries

Use only the domain guidance that matches the current task. Do not apply Workflow rules to Automation items, Drive rules to local files, or Database SQL rules to Content resources.

Before destructive operations, follow the safety rules in the relevant domain file and ask when the user's intent is ambiguous.

Do not expose tokens, Authorization headers, cookies, share passwords from list results, presigned URLs, or other secrets returned by tools.
```

- [ ] **Step 6: Parse the new metadata**

Run:

```bash
node -e 'JSON.parse(require("fs").readFileSync("desktop/resources/templates/skills/synapse-skill/meta.json", "utf8")); console.log("ok")'
```

Expected: prints `ok`.

- [ ] **Step 7: Run the focused test and verify remaining failure only comes from old templates**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/repository-template-service.test.ts
```

Expected: FAIL only on assertions that old template ids still appear, because old directories have not been removed yet.

- [ ] **Step 8: Commit the new consolidated template**

Run:

```bash
git add desktop/resources/templates/skills/synapse-skill
git commit -m "feat: add consolidated synapse skill template"
```

### Task 3: Remove Old Built-In Synapse MCP Templates and Add Release Note

**Files:**
- Delete old template directories listed in the spec
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Remove old built-in Synapse MCP template directories**

Run:

```bash
git rm -r \
  desktop/resources/templates/skills/synapse-automation-mcp \
  desktop/resources/templates/skills/synapse-content-mcp \
  desktop/resources/templates/skills/synapse-database-mcp \
  desktop/resources/templates/skills/synapse-drive-mcp \
  desktop/resources/templates/skills/synapse-model-price-mcp \
  desktop/resources/templates/skills/synapse-repository-mcp \
  desktop/resources/templates/skills/synapse-variable-mcp \
  desktop/resources/templates/skills/synapse-workflow-mcp
```

Expected: only these eight directories are staged for deletion. `bark-notification` and `synapse-test-skill` remain.

- [ ] **Step 2: Add the release note**

Update `RELEASE_NOTES_PENDING.md` so `## 功能优化` contains:

```md
- 内置 Synapse MCP 技能合并为一个 Synapse Skill，安装入口更清爽，技能内部会按数据库、云盘、工作流、自动化等意图路由到对应说明。
```

Expected file shape:

```md
# Pending Release Notes

## 新增功能

## 功能优化

- 内置 Synapse MCP 技能合并为一个 Synapse Skill，安装入口更清爽，技能内部会按数据库、云盘、工作流、自动化等意图路由到对应说明。

## 问题修复

## 技术调整
```

- [ ] **Step 3: Run the focused test and verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/repository-template-service.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit removal and release note**

Run:

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "feat: consolidate built-in synapse mcp skills"
```

### Task 4: Final Verification

**Files:**
- Read only unless a verification failure points to a missed migration.

- [ ] **Step 1: Verify the final built-in Skill files**

Run:

```bash
find desktop/resources/templates/skills -maxdepth 4 -type f | sort
```

Expected output includes:

```text
desktop/resources/templates/skills/bark-notification/content.md
desktop/resources/templates/skills/bark-notification/meta.json
desktop/resources/templates/skills/synapse-skill/content.md
desktop/resources/templates/skills/synapse-skill/files/automation/api-reference.md
desktop/resources/templates/skills/synapse-skill/files/automation/index.md
desktop/resources/templates/skills/synapse-skill/files/content/api-reference.md
desktop/resources/templates/skills/synapse-skill/files/content/index.md
desktop/resources/templates/skills/synapse-skill/files/database/api-reference.md
desktop/resources/templates/skills/synapse-skill/files/database/index.md
desktop/resources/templates/skills/synapse-skill/files/drive/api-reference.md
desktop/resources/templates/skills/synapse-skill/files/drive/index.md
desktop/resources/templates/skills/synapse-skill/files/model-price/api-reference.md
desktop/resources/templates/skills/synapse-skill/files/model-price/index.md
desktop/resources/templates/skills/synapse-skill/files/repository/api-reference.md
desktop/resources/templates/skills/synapse-skill/files/repository/index.md
desktop/resources/templates/skills/synapse-skill/files/variable/api-reference.md
desktop/resources/templates/skills/synapse-skill/files/variable/index.md
desktop/resources/templates/skills/synapse-skill/files/workflow/api-reference.md
desktop/resources/templates/skills/synapse-skill/files/workflow/index.md
desktop/resources/templates/skills/synapse-skill/meta.json
desktop/resources/templates/skills/synapse-test-skill/content.md
desktop/resources/templates/skills/synapse-test-skill/files/verify-marker.txt
desktop/resources/templates/skills/synapse-test-skill/meta.json
```

- [ ] **Step 2: Verify old ids are absent and new id is present**

Run:

```bash
rg -n '"id": "synapse-(automation|content|database|drive|model-price|repository|variable|workflow)-mcp"|"id": "synapse-skill"' desktop/resources/templates/skills
```

Expected: only `desktop/resources/templates/skills/synapse-skill/meta.json` matches with `"id": "synapse-skill"`.

- [ ] **Step 3: Run focused template tests again**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/repository-template-service.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run desktop typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 5: Inspect git status**

Run:

```bash
git status --short
```

Expected: clean working tree after the commits above.

## Self-Review

- Spec coverage: The plan creates one `synapse-skill`, organizes domain folders with `index.md` and `api-reference.md`, removes the eight old MCP templates, preserves `synapse-test-skill` and `bark-notification`, updates release notes, and verifies built-in listing behavior through template tests.
- Placeholder scan: Each edit has exact paths, content, commands, and expected results.
- Type consistency: Tests use `readRepositorySeedContents`, existing `RepositorySeedContent.attachments`, and existing attachment `originalName` paths produced by nested `files/` directories.
