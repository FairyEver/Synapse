# Skill Repository Redesign

Date: 2026-07-01

## Summary

Replace the old cloud Content Store product model with a focused cloud Skill Repository system.

The old Content Store treated Skill, Rule, and Prompt as store items with drafts, published versions, packages, and marketplace-style administration. The new model treats each cloud Skill as a lightweight repository, similar to a simplified GitHub repository:

- one Skill repository has one current file tree;
- `SKILL.md` is the root entry file;
- visibility is `private` or `public`;
- public means immediately accessible, installable, and forkable;
- fork copies the current file tree into the current user's private repository;
- install means installing the current file tree to a local editor.

V1 intentionally does not implement team collaboration, review, releases, history, rollback, pull requests, issues, comments, ratings, tags, or prompt/rule cloud sharing.

## Context

The current implementation already has an end-to-end Content Store:

- server-side content items, drafts, versions, packages, install sessions, install records, and admin moderation;
- dashboard pages for store list, personal content, editor, detail, and admin moderation;
- desktop upload from local Skill scan to Content Store draft;
- desktop deep-link install window for Content Store packages.

That implementation works, but its product model is now too heavy and no longer matches actual usage. Team usage has shown that cloud sharing is valuable for Skills, while Prompt and Rule cloud sharing are not valuable enough to keep in the cloud store. Rules and Prompts can continue to exist in the local Resource Repository, but the cloud repository system should focus on Skills.

The current desktop main Resource Repository remains a local Rule/Skill/Prompt manager. The new cloud Skill Repository should not turn Desktop into a full cloud repository manager. Desktop should stay a bridge for local editor installation and local Skill upload. Web/Dashboard should own cloud repository management.

## Goals

- Make cloud Skill sharing feel like a simplified GitHub repository model.
- Remove Prompt and Rule from the cloud store surface.
- Remove publish, review, release, version history, rollback, and install-specific version selection from the cloud Skill product.
- Support public consumption: any signed-in user can browse, install, and fork public Skills.
- Support private personal cloud repositories without team editing.
- Support local-first authoring: users usually create a Skill on disk with an Agent, then upload it through MCP or Desktop.
- Support light web editing for existing repository files.
- Reuse the Drive Finder and Code Renderer interaction model where it fits, without coupling Skill repositories to Drive storage or Drive permissions.
- Keep stable identity separate from URL names and local install directory names.

## Non-Goals

- No cloud Prompt repository.
- No cloud Rule repository.
- No team membership or shared editing.
- No comments, reviews, ratings, stars, tags, categories, leaderboards, or marketplace promotion in V1.
- No release objects, commit history, diff viewer, rollback, or install pinned version.
- No cloud-from-scratch Skill creation in V1.
- No empty folders in Skill repositories.
- No reuse of Drive Storage for Skill repository files.
- No Git implementation or local git clone semantics.

## Product Model

The new product is **Skill Repository**.

A repository is identified to users as:

```text
ownerHandle/repoName
```

It contains:

- stable `repoId`;
- owner user;
- `repoName`, a URL-safe machine name;
- `title`, a user-facing display title;
- optional `description`;
- `visibility`, either `private` or `public`;
- current file tree;
- required root `SKILL.md`;
- optional fork source.

There is no draft/publish split. Saving a repository file updates the current file tree. Installing a repository installs the current file tree.

## Visibility

Visibility is simple:

- `private`: only the owner can view, edit, install, and manage the repository.
- `public`: any signed-in user can view, install, and fork the repository.

Public visibility is immediate. There is no submit-for-review or publish approval flow.

Admin can still hide or remove abusive public repositories, but admin moderation is not part of normal publishing.

## Identity And Naming

Use four separate identities:

```text
repoId: stable database identity
handle: user URL identity
repoName: repository URL and default install name
title: display title
```

### User Handle

Add a nullable `User.handle`.

Rules:

- global unique;
- lower-case letters, digits, and hyphen only;
- max 64 characters;
- starts and ends with a letter or digit;
- no dots;
- reserved route names are denied;
- not auto-derived from email or display name;
- required only when a flow needs a public URL or public identity.

Existing users are not forced to set a handle immediately.

When a user action needs a handle:

- UI flow sends the user to the Dashboard personal profile settings page;
- MCP/API returns a structured `USER_HANDLE_REQUIRED` error and tells the Agent that the user must manually set a username in the console.

Agents and MCP tools must not silently generate, set, or change a user's handle.

### Handle Rename

Users can change handle.

On rename:

- old handle is stored in `UserHandleRedirect`;
- old handle is not released to other users;
- old public URLs redirect to the current handle;
- internal data keeps using stable user id and repo id.

This prevents old links from breaking and avoids link hijacking.

### Repository Name

`repoName` should reuse the current Skill machine-name rule:

- lower-case letters, digits, and hyphen;
- max 64 characters;
- starts and ends with a letter or digit;
- no dots;
- rejects Windows reserved names such as `con`, `aux`, `nul`, `com1`, and `lpt1`.

Each owner has unique active repository names:

```text
unique(ownerUserId, repoName)
```

Different users can use the same repository name.

### Repository Rename

Owners can rename a repository.

On rename:

- old `(ownerUserId, repoName)` is stored in `SkillRepositoryNameRedirect`;
- old name is not released under that owner;
- old `handle/oldName` URLs redirect to `handle/newName`;
- existing local install folders are not renamed automatically;
- future installs default to the new `repoName`.

### Local Install Directory Name

Default local install directory name is the current `repoName`.

Local installation and update identity must use stable `repoId`, not directory name. Existing installer behavior already checks `.synapse.json` for stable content id. The new Skill Repository should continue this pattern.

Installed `SKILL.md` frontmatter can use the final local directory basename as `name`, preserving editor compatibility.

## Fork

V1 fork is a simple copy:

- only public repositories can be forked;
- fork creates a new private repository owned by the current user;
- it copies the current file tree;
- it records `forkedFromRepositoryId`;
- default `repoName` matches the source repo name;
- if the current user already has that name, the user must choose another name;
- source repository updates do not sync into forks;
- no pull request, merge, or upstream sync behavior.

Fork source must use stable repo id, not `owner/name` strings.

## Local-First Upload

The expected authoring flow is:

1. User asks an Agent to create or update a local Skill directory.
2. Agent calls Synapse MCP to import that local Skill directory into cloud Skill Repository.
3. Synapse uploads the file tree and returns repository URLs.
4. User optionally opens the web management page for light editing.

Cloud V1 does not need a "new empty Skill" flow.

## Upload Conflict Rules

MCP and Desktop upload must not treat same name as an automatic update.

Update can be inferred only from stable identity:

- explicit `repositoryId` parameter; or
- local `.synapse.json` that contains the cloud repository id.

If neither exists and the current user already has the same `repoName`, return a structured conflict such as `SKILL_REPOSITORY_NAME_CONFLICT`.

The conflict response should tell the Agent:

- a repository with this name already exists;
- to update it, first confirm the target repository id and pass it explicitly;
- to create a different repository, choose another repository name.

This prevents accidentally overwriting a different Skill that happens to have the same name.

## Local `.synapse.json`

After successful initial upload, Synapse may write `.synapse.json` into the local Skill directory.

The write must use the existing local file permission and audit boundary. It must not bypass local file write protections.

New shape:

```json
{
  "id": "repo-id",
  "kind": "cloud-skill-repository",
  "owner": "liyang",
  "name": "apifox-cli"
}
```

Compatibility:

- existing `{ "id": "...", "repositoryVersion": "..." }` remains readable for old local Resource Repository installs;
- new Skill Repository code should treat `kind: "cloud-skill-repository"` as a cloud repo identity;
- install/update matching should prefer stable id and not rely on current `owner/name`.

## Web And Desktop Ownership

Dashboard/Web is the management surface:

- repository pages;
- My Skills;
- Explore public repositories;
- file browse/edit;
- settings;
- visibility;
- fork;
- install session creation.

Desktop is the local bridge:

- upload local Skill directory to cloud;
- install cloud Skill into local editors;
- open web management pages in the user's browser.

Desktop does not implement a full cloud repository manager.

## Web UI

The repository page should feel like a simplified GitHub repository page and reuse Drive Finder interaction ideas.

Top area:

```text
owner / repoName    private/public    Install    Fork    Settings
```

Owner sees management actions. Non-owner sees view/install/fork for public repositories.

The root view opens the repository file browser. The root should naturally emphasize `SKILL.md`, because that is the repository entry file.

### File Browser

Do not make a one-off Content Store file editor. Instead, extract a reusable file browser layer from Drive Browser concepts:

```text
dashboard/src/features/file-browser/
  finder/
  renderers/
    code-renderer.tsx
    renderer-shell.tsx
    renderer-toolbar-context.tsx
```

Drive and Skill Repository can each adapt their own snapshot DTO into this shared browser layer.

Skill browser behavior:

- breadcrumbs from repository root and path segments;
- folder rows are virtual, derived from file paths;
- no empty folders;
- file rows show name, size, and updated time;
- click a folder to list its derived children;
- click a file to open Code renderer;
- text files can be edited;
- binary files can be downloaded or replaced, but not edited inline;
- `SKILL.md` cannot be deleted.

V1 Skill browser should not enable:

- MDXeditor rich editing;
- markdown annotation comments;
- Drive image import;
- version history dialog;
- Drive share state;
- Drive site publishing;
- Drive public asset actions.

### Editing

V1 editing is intentionally light:

- edit existing text files in Code renderer;
- save one file;
- reload one file;
- show dirty/synced state;
- handle save conflict with reload/download-local-version options;
- upload/replace files;
- rename non-`SKILL.md` files;
- delete non-`SKILL.md` files.

The Code renderer can be reused after extracting Drive-specific DTO names and actions. The useful existing contract is:

- current file identity;
- preview text;
- edit capability;
- `reload`;
- `saveText`;
- saving/reloading state.

### Repository Settings

Settings should handle:

- `title`;
- `description`;
- `repoName`;
- visibility;
- delete repository;
- fork source display.

Changing from private to public requires a user handle. If the handle is missing, route the user to personal profile settings.

## UI And UX Requirements

Skill Repository is a product workspace, not a marketplace landing page. The interface should feel like Synapse's existing precision workbench: compact, calm, familiar, and built for repeated management work.

### Existing UI Patterns To Reuse

Use existing dashboard and component vocabulary first:

- `Header` and `Main` for authenticated dashboard pages;
- `ServerDataTable` for My Skills and Explore list views;
- shadcn/Radix primitives from `dashboard/src/components/ui/`;
- token classes from the existing Tailwind and OKLCH theme;
- `RelativeTime`, `Badge`, `Button`, `Input`, `Select`, `Switch`, `Dialog`, `AlertDialog`, and `ScrollArea` where they already match the job;
- Drive Browser Finder layout and Code Renderer interaction model after extracting Drive-specific naming.

Do not extend the old Content Store editor as the new long-term UI. The old draft/publish/editor shape exists for a heavier store model and should be replaced by repository pages, repository settings, and the shared file browser.

### Surfaces And Layout

Repository pages should be dense and operational:

- top header shows `owner / repoName`, visibility, and primary actions;
- root content opens directly into the file browser;
- file browser uses one stable bordered/ringed work surface, not a card grid;
- file rows use table/list affordances with icon, name, size, and updated time;
- settings use a plain form layout with aligned labels and controls;
- avoid nested cards, decorative side stripes, large shadows, gradients, glow, and over-rounded containers.

Use borders, rings, separators, muted surfaces, selected rows, and focus states for hierarchy. Do not combine decorative shadow, border, and background on the same resting surface.

When rounded elements are nested closely, keep the radius visually concentric. If a page needs a new container shape, choose from existing `rounded-md` or `rounded-lg` patterns before adding anything else.

### Typography And Copy

Use fixed product typography:

- no viewport-scaled headings;
- page headings stay around the existing `text-lg font-semibold` dashboard pattern;
- repository title or path text must truncate safely instead of overflowing;
- short headings can use `text-balance`;
- descriptions and empty/error copy can use `text-pretty`;
- dynamic counts and install numbers use `tabular-nums`;
- numeric table columns are right-aligned.

Copy should be short and operational. Avoid feature-introduction paragraphs such as "This page lets you..." and avoid implementation explanations. Preferred labels are direct actions: `安装`, `Fork`, `保存`, `重新加载`, `上传文件`, `重命名`, `删除`.

### Actions And State

Use familiar control placement:

- primary repository action is `安装`;
- owner-only management actions are grouped separately from visitor actions;
- destructive actions use existing destructive variants and confirmation flows;
- visibility changes show clear private/public state;
- missing handle flows use an inline actionable state and route to profile settings;
- file save state uses `已同步`, `未保存`, saving, reload, conflict, and error states from the Code Renderer pattern.

Every interactive control must have default, hover, focus, active, disabled, loading, and error behavior where applicable. Icon-only buttons need accessible labels and at least a 40px hit area, preferably through the shared button component rather than one-off padding.

### Motion And Performance

Motion is for state, not decoration:

- no page-load choreography;
- no decorative reveal sequences;
- keep interaction transitions around 150 to 250 ms;
- prefer interruptible CSS transitions for hover, focus, drawer, menu, and selected-state changes;
- do not use `transition: all`;
- use `will-change` only after a visible first-frame stutter is confirmed;
- respect reduced-motion behavior.

### Accessibility And Responsive Behavior

Skill Repository pages must work as product tools:

- keyboard users can navigate file rows, activate rows with Enter, and reach toolbar actions;
- selected rows expose state with `aria-current` or equivalent semantics;
- focus states are visible in light and dark themes;
- status and errors do not rely on color alone;
- the file browser and editor keep stable height and scroll regions in desktop layouts;
- mobile and narrow desktop widths collapse action groups without overlapping text;
- long owner handles, repository names, and file paths truncate or wrap in controlled regions.

### Visual Verification Targets

Implementation should include visual checks for:

- My Skills list;
- Explore list;
- owner repository page;
- public visitor repository page;
- repository settings;
- file browser folder view;
- Code Renderer file edit view;
- empty, loading, error, conflict, and missing-handle states;
- narrow viewport behavior.

These checks should verify that text does not overflow, controls stay aligned, table numeric columns remain right-aligned, and the UI does not introduce custom colors or one-off decorative styling.

## Server Data Model

Add new tables rather than extending old Content Store tables.

Suggested core tables:

```text
User.handle
UserHandleRedirect
SkillRepository
SkillRepositoryNameRedirect
SkillRepositoryFile
SkillRepositoryInstallEvent
```

### UserHandleRedirect

Fields:

```text
id
userId
oldHandle
createdAt
```

Constraints:

```text
unique(oldHandle)
```

### SkillRepository

Fields:

```text
id
ownerUserId
name
title
description
visibility
status
forkedFromRepositoryId
createdAt
updatedAt
lastSyncedAt
legacyContentStoreItemId
legacyInstallCount
```

Suggested enums:

```text
visibility: private | public
status: active | removed
```

Constraints:

```text
unique(ownerUserId, name)
index(visibility, status, updatedAt)
index(ownerUserId, updatedAt)
```

### SkillRepositoryNameRedirect

Fields:

```text
id
ownerUserId
oldName
repositoryId
createdAt
```

Constraints:

```text
unique(ownerUserId, oldName)
```

### SkillRepositoryFile

Fields:

```text
id
repositoryId
path
kind
mimeType
size
sha256
storageKey
textPreview
createdAt
updatedAt
```

Constraints:

```text
unique(repositoryId, lower(path))
index(repositoryId, path)
```

Rules:

- every active repository must contain root `SKILL.md`;
- `SKILL.md` must be non-empty text;
- path is relative;
- path cannot contain `..`;
- path cannot use Windows-hostile names or characters;
- path uniqueness is case-insensitive;
- database stores metadata and object references, not file bytes.

## Storage

Do not use Drive Storage for Skill Repository files. Skill Repository is not user Drive and should not consume Drive quota or inherit Drive sharing semantics.

Use the existing Content Store storage domain or rename that domain during implementation to reflect its new responsibility. If the storage domain meaning changes, update the repository rules and environment documentation in the same implementation.

Suggested object prefixes:

```text
skill-repositories/{repositoryId}/files/{fileId}/{sha256}
skill-repositories/{repositoryId}/exports/{exportId}.zip
```

Exports are installation artifacts only. They are not releases or versions.

## API

Representative server API:

```text
GET    /api/skill-repositories
GET    /api/skill-repositories/mine
POST   /api/skill-repositories/import
GET    /api/skill-repositories/:id
PATCH  /api/skill-repositories/:id
POST   /api/skill-repositories/:id/fork
POST   /api/skill-repositories/:id/install-sessions

GET    /api/skill-repositories/by-path/:handle/:name
GET    /api/skill-repositories/by-path/:handle/:name/browser
PATCH  /api/skill-repositories/:id/files/content
POST   /api/skill-repositories/:id/files
PATCH  /api/skill-repositories/:id/files/rename
DELETE /api/skill-repositories/:id/files
```

Public browsing can use `handle/name`. Management and mutation should prefer stable `id`.

The import API receives a packaged file tree from Desktop, MCP, or another authenticated client. The server never reads the user's local `sourceDirectoryPath` directly.

## Browser Snapshot API

Skill Repository should expose a Skill-specific browser snapshot rather than reusing Drive DTOs directly.

The shape should be close enough to the extracted file browser UI contract:

```text
SkillRepositoryBrowserSnapshot
  repository
  current
  breadcrumbs
  children
  preview
  edit
```

`current` can represent either:

- a real file, addressed by path; or
- a virtual folder, addressed by path prefix.

Folders are derived from file paths and are not stored as rows.

## MCP

Add a new cloud Skill Repository MCP domain. Do not reuse `app_resource_repository_*`, because that name already means local Resource Repository.

Suggested tools:

```text
app_skill_repository_list
app_skill_repository_get
app_skill_repository_import_local
app_skill_repository_update_local
app_skill_repository_set_visibility
app_skill_repository_fork
app_skill_repository_open
```

`app_skill_repository_import_local`:

- accepts `sourceDirectoryPath`;
- optional `repositoryId`;
- optional `name`, `title`, `description`;
- optional `openInBrowser`;
- creates a private repository if no repo id exists;
- updates the target repository if repo id exists and owner matches;
- writes local `.synapse.json` after successful create/update when local permissions allow;
- returns repository id, current `owner/name`, management URL, and public URL if public.

MCP default behavior:

- do not open browser after upload unless `openInBrowser: true`;
- return structured errors;
- never set or change user handle automatically.

Important structured errors:

```text
USER_HANDLE_REQUIRED
SKILL_REPOSITORY_NAME_CONFLICT
SKILL_REPOSITORY_FORBIDDEN
SKILL_REPOSITORY_NOT_FOUND
SKILL_REPOSITORY_INVALID_SKILL
```

## Desktop

Desktop changes:

- rename the scan action from "publish to store" to "upload to cloud repository" or equivalent product copy;
- reuse the secure local Skill directory reader;
- upload through the cloud Skill Repository API;
- for user-initiated Desktop upload, open the system browser to the management page after success;
- for MCP upload, return URLs and only open browser when explicitly requested;
- keep Desktop out of cloud repository management UI.

Install flow:

- Web creates short install session;
- Web opens `synapse://skill-install?session=...`;
- Desktop resolves session;
- Desktop downloads current file tree export zip;
- Desktop verifies manifest, package hash, file hashes, safe paths, zip limits, and required `SKILL.md`;
- Desktop passes prepared source into the existing Skill installer flow.

The old `synapse://content-install?session=...` can remain for compatibility during migration.

## Migration

Old Content Store should not be the long-term model. Migration can happen after the new module is stable.

Migration rules:

- migrate only old Skill items;
- ignore Prompt and Rule for cloud Skill Repository;
- use only latest version/current content;
- do not migrate version history, draft state, or packages;
- public old Skill becomes public repository;
- private old Skill becomes private repository;
- title and description become repository metadata;
- repository name is generated from old Skill metadata or `SKILL.md` frontmatter;
- name conflicts append a short safe suffix;
- `copiedFrom` becomes `forkedFromRepositoryId` when the old source maps to a migrated repository;
- install count can become `legacyInstallCount`.

Old Content Store routes can redirect or show compatibility messages for a limited migration period.

## Permissions And Safety

- Owner can read, edit, delete, rename, and change visibility of private or public repositories they own.
- Any signed-in user can read, install, and fork public active repositories.
- Removed repositories are hidden from public surfaces.
- Admin can remove or restore public repositories.
- MCP mutations require authenticated account state.
- Local `.synapse.json` writes must pass existing local file permission and audit checks.
- Object storage cleanup must handle replaced/deleted files without silently losing metadata if object deletion fails.
- File paths must be validated on both client and server.
- Install export zip must be validated on Desktop exactly like a privileged install artifact.

## Testing

Server tests:

- handle set, uniqueness, rename redirect, old handle reservation;
- repo name uniqueness, rename redirect, old name reservation;
- public/private read permissions;
- owner-only mutation;
- fork source and copied file tree;
- import requires non-empty root `SKILL.md`;
- path validation and case-insensitive path uniqueness;
- size and file count limits;
- same-name import conflict without repo id;
- repo id update with owner check;
- install session and export zip content;
- old Content Store Skill migration.

Dashboard tests:

- personal profile handle form;
- missing handle when making repository public;
- My Skills and Explore list;
- repo owner vs visitor actions;
- Finder virtual folders;
- Code renderer save/reload/conflict;
- upload/replace/rename/delete file;
- `SKILL.md` delete blocked;
- settings rename and visibility changes.

Desktop/MCP tests:

- MCP import local first creates private repo;
- MCP update local uses `.synapse.json` repo id;
- MCP explicit `repositoryId` updates the target repo;
- MCP same-name conflict without repo id;
- MCP default no browser open;
- MCP `openInBrowser: true` opens browser;
- successful upload writes `.synapse.json` with permission/audit;
- `synapse://skill-install` deep link resolves and installs current repo content;
- old `synapse://content-install` remains compatible during migration.

## Implementation Phases

### Phase 1: Core Cloud Repository

- Add user handle and handle redirects.
- Add Skill Repository tables and storage service.
- Add local Skill import API.
- Add MCP import/list/get/open basics.
- Write `.synapse.json` after import.
- Keep all repositories private initially.

### Phase 2: Web Management

- Add My Skills.
- Add repository page.
- Extract shared file browser pieces from Drive Browser.
- Add Skill browser adapter.
- Add Code renderer editing for Skill files.
- Add repository settings.

### Phase 3: Public Consumption

- Add public visibility.
- Add Explore.
- Add fork.
- Add install sessions.
- Add `synapse://skill-install` Desktop flow.

### Phase 4: Migration And Cleanup

- Migrate old Content Store Skills.
- Keep compatibility redirects or messages for old routes.
- Remove or hide old cloud Prompt/Rule store surfaces.
- Update built-in `synapse-skill` MCP documentation.
- Update AGENTS storage-domain notes if the Content Store storage domain is renamed or its stable responsibility changes.

## Open Decisions Resolved In This Brainstorm

- Cloud store supports only Skill.
- Public means immediate availability, no review or publishing workflow.
- V1 has no history, release, rollback, or install-specific versions.
- User handle is required for public identity and can be changed with redirect.
- Repository name can be changed with redirect.
- Fork copies current files into a private repository.
- Desktop is a bridge, Web is management.
- Web editing is light and uses a Drive Finder/Code Renderer-style interaction.
- No empty folders.
- No cloud-from-scratch Skill creation in V1.
- MCP import local is the primary creation path.
- Same-name upload does not auto-update without stable repo id.
- Successful upload may write `.synapse.json`.
- MCP upload does not open browser unless requested.
