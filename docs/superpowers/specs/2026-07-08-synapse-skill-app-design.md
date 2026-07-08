# Synapse Skill App Design

Date: 2026-07-08

## Goal

Move `Synapse Skill` out of Resource Repository built-in content and make it a first-class system App. Remove the general built-in Resource Repository concept. The only preserved built-in Skill is `Synapse Skill`, and it no longer appears as a Resource Repository item.

The App should be a small, mature installation surface: it shows global editor install status for `Synapse Skill` and provides one primary install action that enters the existing Skill installer flow.

## Product Boundaries

- `Synapse Skill` is a system-owned capability package, not a Rule / Skill / Prompt record.
- It is not listed in Resource Repository, cannot be edited there, cannot be favorited, cannot be published, and cannot be deleted as repository content.
- The App only handles `Synapse Skill`. It is not a generic Skill authoring or Skill repository UI.
- The App checks global editor status only. Project-scope installation remains available inside the shared installer flow after the user clicks install.
- Other existing built-in templates under `desktop/resources/templates/` are removed. This includes test rules, test prompts, test skills, and `bark-notification`.

## Package Location

`Synapse Skill` should live inside its own App Capability package:

```text
desktop/app-capabilities/synapse-skill/
  shared/
    capability.ts
    package.ts
  main/
    service.ts
    ipc.ts
    prepared-source-provider.ts
  renderer/
    app-definition.ts
    app-manifest.ts
    index.tsx
  skill-package/
    SKILL.md
    app/index.md
    app/api-reference.md
    automation/index.md
    automation/api-reference.md
    content/index.md
    content/api-reference.md
    database/index.md
    database/api-reference.md
    drive/index.md
    drive/api-reference.md
    model-price/index.md
    model-price/api-reference.md
    repository/index.md
    repository/api-reference.md
    skill-repository/index.md
    skill-repository/api-reference.md
    variable/index.md
    variable/api-reference.md
    workflow/index.md
    workflow/api-reference.md
```

`skill-package/` is a real installable Skill directory. It should not use Resource Repository template files such as `meta.json`, `content.md`, or a template-only `files/` attachment wrapper. The main file is `SKILL.md`; domain guides are installed as normal sibling directories such as `database/index.md`.

The package root is intentionally colocated with the App because this Skill is the App's only business object. Future Synapse-owned installable packages can follow the same capability-package pattern instead of reintroducing Resource Repository built-ins.

## Stable Identity

Use a stable system identity independent of the app install path:

```ts
sourceIdentity: "synapse-skill"
name: "synapse-skill"
title: "Synapse Skill"
```

The installed `.synapse.json` file must continue to store:

```json
{ "id": "synapse-skill" }
```

Do not prepare this package through the local-directory installer path, because local-directory identity is path-based. The system package needs a stable content identity so status detection, replacement, and update checks remain reliable across app upgrades and installation locations.

## Main Process Design

Add `SynapseSkillService` under `desktop/app-capabilities/synapse-skill/main/service.ts`.

Responsibilities:

- Resolve the package directory:
  - development: `path.join(app.getAppPath(), "app-capabilities/synapse-skill/skill-package")`
  - packaged: `path.join(process.resourcesPath, "synapse-skill")`
- Read and validate the package with the existing Skill source reader.
- Return a `SynapseSkillInstallerSource` suitable for `SharedInstallerFlow`.
- Provide global install status input for renderer use.

Add `prepared-source-provider.ts` implementing `PreparedContentInstallSourceProvider`.

Responsibilities:

- Expose `hasPreparedSource(sourceId, contentId)` for `synapse-skill`.
- Implement `readPreparedSkill`, `copyPreparedSkillAttachment`, `beginPreparedInstall`, `endPreparedInstall`, and `markPreparedInstalled`.
- Keep prepared source IDs opaque to renderer.
- Use the stable content id `synapse-skill`, not a filesystem-derived id.

Register this provider through `editorInstallService.addPreparedSourceProvider(...)`, matching the existing prepared package pattern used by Skill Repository installs.

## IPC And Renderer Source Flow

Add a focused IPC surface for the App:

```ts
prepareInstallSource(): Promise<SynapseSkillInstallerSource>
```

The renderer never receives the package directory path. It only receives an installer source with:

- `kind: "skill"`
- `origin: "prepared"`
- `sourceIdentity: "synapse-skill"`
- `name: "synapse-skill"`
- `title: "Synapse Skill"`
- `preparedSourceId`
- `mainContent` for placeholder detection and preview paths already used by installer flow

The install button calls `prepareInstallSource()`, then passes the returned source into `SharedInstallerFlow`.

## Editor And Agent Registry Reuse

Editor list data must come from the existing centralized editor adapter registry:

- Renderer calls the existing `getEditorAdapters()` path through `useEditorAdaptersForContentType({ contentType: "skill" })`.
- The App filters to adapters that support Skill and global install.
- The App must not hard-code editor names, paths, or agent/editor lists.

The existing adapter registry remains the single place that knows:

- supported content types
- editor labels and ordering
- global/project support
- path resolution rules
- conflict detection

## Global Install Status

On App open, resolve global status for `Synapse Skill`.

Preferred implementation:

- Add a small hook in the App that calls existing install-status IPC with:
  - `contentType: "skill"`
  - `contentId: "synapse-skill"`
  - `contentName: "synapse-skill"`
  - `title: "Synapse Skill"`
  - `projects: []`
- Display only `scope === "global"` entries.

If implementation needs to avoid a full editor scan, add a main-process helper that uses the same adapter registry and target resolution logic for global scope only. It must still share adapter data and not duplicate editor path rules.

Status labels:

- `installed`: 已安装
- `needs_update`: 需更新
- `not_installed`: 未安装
- `conflict`: 冲突
- `external_same_name`: 外部同名
- `unavailable`: 不可用
- `unsupported`: 不支持

`needs_update` can remain conservative in the first implementation if repository-version comparison is not meaningful for the system package. The design should leave room for package version or content hash later.

## UI Design

The App is a restrained system tool surface.

Layout:

- Use `SystemAppWindowShell`.
- Main content is centered with a practical width, around `max-w-3xl`.
- Use one top-level panel or unframed section, not nested cards.
- Show editor rows first, then the primary install action.

Editor row content:

- Editor icon.
- Editor label.
- Global status badge.
- Target path when useful and safe to show.
- Short unavailable/conflict message when present.

Actions:

- Primary button: `安装 Synapse Skill`.
- Secondary small action: `刷新`, if status loading failed or the user wants to recheck.

Install interaction:

1. User opens App.
2. App loads editor adapters and global install status.
3. User clicks `安装 Synapse Skill`.
4. App prepares the system package source.
5. App renders `SharedInstallerFlow` with that source already selected.
6. User chooses editor and scope in the existing installer flow.
7. On install success, show `安装完成`, refresh global status, and keep the user in the App.

No feature-introduction paragraph is needed. Empty/error/loading copy should be short and operational.

## Resource Repository Removal

Remove the built-in content concept from Resource Repository:

- Stop merging `builtinContentService.listContent(...)` into `contentService.listContent(...)`.
- Remove built-in id parsing from normal content read/detail/install/download paths.
- Remove the `内置资源` category from content category stats and filters.
- Remove readonly behavior that exists only for built-in Resource Repository content.
- Delete the old template directories under `desktop/resources/templates/`.
- Delete or rewrite tests that assert Resource Repository built-in items exist.

Keep unrelated `builtin` terminology that belongs to other domains, such as Automation built-in triggers/executors, Agent personas, model price presets, or runtime assets.

## Packaging

Update `desktop/package.json` extra resources:

```json
{
  "from": "app-capabilities/synapse-skill/skill-package",
  "to": "synapse-skill"
}
```

Remove the old `resources/templates` extra resource once no runtime code depends on it.

Update packaged asar verification to check:

- `resources/synapse-skill/SKILL.md`
- representative required domain files such as `resources/synapse-skill/database/index.md`

The packaged app must fail verification if the system Skill package is missing.

## Documentation And Long-Term Rules

Update `AGENTS.md` so future MCP capability changes point to:

```text
desktop/app-capabilities/synapse-skill/skill-package/
```

instead of:

```text
desktop/resources/templates/skills/synapse-skill/
```

The rule should say: changing Synapse MCP capabilities requires updating the Synapse Skill package domain guide and API reference.

Do not preserve a generic "built-in resource template" workflow in repository rules after implementation.

## Error Handling

- Missing package directory: App shows a short error and disables install.
- Invalid Skill package: main service throws a sanitized error; renderer shows `读取 Synapse Skill 失败`.
- No supported editors: show an empty state with `未检测到可安装的编辑器`.
- Editor status load failure: show error with `刷新`.
- Install failure: rely on `SharedInstallerFlow` error handling and existing editor write audit.
- Conflict/overwrite: rely on existing installer confirmation dialogs.

## Testing

Focused tests:

- `SynapseSkillService` reads package metadata and returns stable `sourceIdentity: "synapse-skill"`.
- Prepared source provider returns a `SynapseContentDetail<"skill">` with expected attachments.
- Prepared source provider copies nested attachment paths.
- App renderer displays global editor rows from adapter data.
- App renderer starts `SharedInstallerFlow` only after `prepareInstallSource()` succeeds.
- Resource Repository no longer lists built-in content or `内置资源` category.
- Packaged asar verification requires `resources/synapse-skill/SKILL.md`.

Verification commands:

```bash
pnpm --filter @synapse/desktop test -- synapse-skill
pnpm --filter @synapse/desktop test -- repository-template-service content-service content-categories
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:packaged-asar
```

## Non-Goals

- No automatic direct install to a default editor.
- No project-scope status dashboard on the App home screen.
- No Skill editing, publishing, favorites, category management, or history UI.
- No reintroduction of generic Resource Repository built-in templates.
- No custom editor list separate from the existing adapter registry.
