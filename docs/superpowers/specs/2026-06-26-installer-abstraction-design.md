# Skill and Rule Installer Abstraction Design

## Context

Synapse currently installs Skill and Rule resources from the resource repository or Content Store through UI flows that are still coupled to repository content metadata. The install flow already has important behavior that must be preserved: editor selection, global or project targets, variable substitution, editor-specific Rule forms, Skill overwrite and conflict confirmation, backup and restore, audit boundaries, and install-status refresh.

The goal is to turn Skill installation and Rule installation into two reusable installer apps:

- Skill Installer starts from a standard local Skill directory when opened directly.
- Rule Installer starts from a Rule name and body string when opened directly.
- Existing repository and Content Store install actions use these installers instead of presenting editor choices directly.

This is an abstraction of existing install capability, not a new install behavior.

## Decisions

- Add two launchable system apps: `Skill 安装器` and `Rule 安装器`.
- Keep them as separate apps in product surfaces, while sharing installer flow code and main-process install core.
- Resource repository install buttons become single `安装` buttons. They no longer show editor lists in a dropdown.
- When an installer is opened with an existing source, it skips source input and starts at editor selection.
- When an installer is opened directly from the launcher, it first collects its source.
- Skill directory installation is normalized, not byte-for-byte copied.
- Rule installer input is a plain Rule body, not a frontmatter document.
- Existing name validation rules remain authoritative.

## User Flows

### Standalone Skill Installer

```text
Skill 安装器
  Step 0: 选择 Skill 目录
    - 目录根部必须包含 SKILL.md
    - 读取 name / description
    - 校验附件、安全限制和大小限制
  Step 1: 选择编辑器
  Step 2: 选择全局 / 项目
  Step 3: 安装
  Success: 停留在成功状态，可继续安装下一个 Skill
```

The selected directory must be a standard Skill directory. The installer must not scan a parent directory and ask the user to choose among multiple child Skills.

### Standalone Rule Installer

```text
Rule 安装器
  Step 0: 输入 name + Rule 正文
    - name 必填
    - 正文必填
    - name 使用现有 Rule name 校验
  Step 1: 选择编辑器
  Step 2: 选择全局 / 项目
  Step 3: 安装
  Success: 停留在成功状态，可继续安装下一条 Rule
```

The Rule body is treated as content only. The installer should not parse user input as frontmatter.

### Embedded Installers

```text
资源仓库 / Content Store / future caller
  点击安装
    ↓
  打开对应 installer modal
    ↓
  调用方已传 source，跳过源输入
    ↓
  直接进入选择编辑器
```

On successful modal installation:

- Resource repository closes the modal and refreshes install status.
- Content Store records completion and moves to its completed state.

## Installer Source Model

Introduce installer-owned source types so the UI flow no longer depends directly on repository content.

```text
InstallerSource
  ├─ kind: "skill" | "rule"
  ├─ origin: "repository" | "prepared" | "local-directory" | "inline"
  ├─ sourceIdentity
  ├─ name
  ├─ title?
  ├─ description?
  └─ content data
```

### Skill Source

```text
SkillInstallerSource
  ├─ kind: "skill"
  ├─ origin
  ├─ sourceIdentity
  ├─ name
  ├─ title?
  ├─ description
  ├─ mainContent
  └─ files or main-process source handle
```

`sourceIdentity` replaces the assumption that every installable thing has a repository `contentId`. For repository content, `sourceIdentity` equals `contentId`.

### Rule Source

```text
RuleInstallerSource
  ├─ kind: "rule"
  ├─ origin
  ├─ sourceIdentity
  ├─ name
  └─ body
```

`sourceIdentity` is required by editor strategies that write sections or track replacement.

Use these deterministic identities:

```text
repository:
  sourceIdentity = contentId

prepared:
  sourceIdentity = contentId

local-directory Skill:
  sourceIdentity = "local-skill:" + sha256(realpath(sourceDirectoryPath))

inline Rule:
  sourceIdentity = "inline-rule:" + sha256(normalizedName + "\0" + body)
```

The identity must never expose the raw local path.

## Name Rules

Reuse existing validation and normalization functions. Do not duplicate regex rules in installer-specific code.

Skill name:

```text
normalizeSkillNameInput()
validateSkillNameInput()
```

Rules:

- Maximum 64 characters.
- Lowercase letters, digits, and hyphens only.
- Must start and end with a letter or digit.
- Must not be a Windows reserved name.
- Dot is not allowed.

Rule name:

```text
normalizeContentNameInput()
validateContentNameInput()
```

Rules:

- Maximum 64 characters.
- Lowercase letters, digits, hyphens, and dots only.
- Must start and end with a letter or digit.
- Must not be a Windows reserved name.
- Dot is allowed.

For local Skill directory installation:

```text
读取 SKILL.md frontmatter name
  ├─ 合法：使用该 name
  ├─ 缺失 / 非法：从源目录 basename 生成候选
  └─ 仍不合法：要求用户填写 name
```

## Skill Directory Behavior

The new Skill Installer must keep existing normalized install behavior:

```text
读取本地 Skill 源目录
  - 必须根目录存在 SKILL.md
  - 跳过隐藏文件 / 隐藏目录
  - 跳过符号链接
  - 跳过 .synapse.json
  - 限制深度、目录数、文件数、单文件大小、总大小
  - 拦截敏感文件，例如 .pem / .key / id_rsa
  - 附件路径做 Windows 安全归一化
```

Install output remains normalized:

```text
写入目标 Skill 目录
  - 重新生成 SKILL.md
  - 写入 .synapse.json
  - 复制收集后的附件
```

Existing behavior only preserves Synapse-supported Skill frontmatter fields. Extra frontmatter fields should not be preserved in the first version.

```text
目标 SKILL.md
  ---
  name: final-skill-name
  description: ...
  ---

  body...
```

## Rule Body Behavior

Rule installer input is the Rule body.

```text
Rule body
  ↓
变量替换
  ↓
editor prepareRuleFileContent()
  ↓
写入目标
```

Editor-specific frontmatter remains an install-target concern:

- Claude Code, Cursor, and Windsurf can generate frontmatter from install form values.
- Codex, Hermes, and Antigravity can write sections using stable source identity.
- The installer itself should not parse the body as frontmatter.

## Main Process Architecture

Keep existing install behavior by extracting shared core instead of rewriting the flow.

```text
Renderer installer
  ↓
installer IPC
  ↓
installer main service
  ├─ resolve source
  ├─ validate source
  ├─ build install source
  └─ call editor install core
```

Recommended main-process split:

```text
installer-source-service
  - read local Skill directory
  - require root SKILL.md for installer use
  - parse Skill name / description
  - collect attachments
  - construct sourceIdentity
  - accept inline Rule input
  - resolve repository and prepared sources

editor-install-core
  - resolve editor target
  - check editor write permission
  - apply variable substitutions
  - call prepareRuleFileContent
  - call prepareSkillDirectory
  - handle overwrite confirmation
  - handle Skill conflict replacement
  - backup and restore
  - record audit and install result
```

Existing `content-install-service.installToEditor()` should become a compatibility caller of the new shared install core. New installer services should call the same core.

## Renderer Architecture

Use two independent apps with shared flow components.

```text
desktop/src/modules/installers/
  shared/
    installer-source-types.ts
    use-installer-flow.ts
    installer-editor-step.tsx
    installer-target-step.tsx
    installer-confirm-footer.tsx
    installer-result-state.tsx

  skill/
    app-definition.ts
    app-manifest.ts
    index.tsx
    skill-installer-modal.tsx
    skill-source-picker.tsx

  rule/
    app-definition.ts
    app-manifest.ts
    index.tsx
    rule-installer-modal.tsx
    rule-source-form.tsx
```

The shared installer flow should reuse existing components where possible:

- `EditorWriteTargetSelector`
- `VariableSubstitutionDialog`
- `VariableSaveConfirmationDialog`
- editor-specific Rule install forms from the generated renderer registry

UI should follow existing system app style:

- No marketing copy.
- No custom colors or ornamental styling.
- Standalone apps use a focused single-task working area.
- Modal mode shows the install flow only.

## Existing Entry Points

### Resource Repository

```text
ContentActionSplitButton
  Before:
    [安装 ▾] lists editors

  After:
    [安装] opens installer modal
```

Mapping:

```text
item.type === "skill" → SkillInstallerModal(repository source)
item.type === "rule"  → RuleInstallerModal(repository source)
item.type === "prompt" → unchanged
```

Other actions such as download, copy, copy icon prompt, and prompt run remain outside this change.

### Content Store

Content Store keeps its authentication and package preparation states, then delegates the installation step.

```text
Content Store
  loading / unauthenticated / error / completed
  ↓ ready
Installer flow with prepared source
```

After successful install:

```text
recordContentStoreInstallComplete()
mark completed
```

## Tests

Main-process tests:

- Repository Skill install behavior remains unchanged.
- Repository Rule install behavior remains unchanged.
- Prepared Skill install behavior remains unchanged.
- Prepared Rule install behavior remains unchanged.
- Local Skill directory installs successfully when root `SKILL.md` exists.
- Local Skill directory without root `SKILL.md` fails.
- Local Skill directory still applies existing attachment and sensitive-file limits.
- Inline Rule rejects invalid name.
- Inline Rule rejects empty body.
- Inline Rule passes expected body and `sourceIdentity` to editor strategy.
- Skill overwrite confirmation, conflict replacement, backup, and restore still work.

Renderer tests:

- Resource repository install button no longer opens an editor dropdown.
- Skill install button opens Skill Installer modal.
- Rule install button opens Rule Installer modal.
- Embedded installer with source starts at editor selection.
- Standalone Skill Installer starts at directory selection.
- Standalone Rule Installer starts at name and body input.
- Modal install success closes the modal and calls refresh callback.
- Standalone install success stays in the app success state.

Registry tests:

- `Skill 安装器` and `Rule 安装器` are registered system apps.
- Both apps appear in launchable app lists.

## Release Notes

Implementation should update `RELEASE_NOTES_PENDING.md` because this changes user-visible installation workflows.

## Non-Goals

- Do not preserve arbitrary Skill frontmatter fields in the first version.
- Do not support choosing a parent directory containing multiple Skill directories.
- Do not parse standalone Rule body input as frontmatter.
- Do not add new editor-specific install semantics.
- Do not rewrite unrelated resource repository actions.
