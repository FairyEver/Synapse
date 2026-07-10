# Skill ENV Configuration And Authoring Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace one-shot Skill body substitutions with a file-based `.env.example`/`.env` protocol, let users scan and update affected installed Skills after a secret value changes, and add an in-app Skill authoring guide with two copyable Agent prompts.

**Architecture:** Add a pure Dotenv document layer, extend Skill source inspection and installation so `.env` is materialized in the atomic staging directory, and add an ephemeral main-process binding scanner that discovers current files from trusted editor roots without storing installation records. Secrets remains the only owner of secret values; the renderer receives scan status and opaque result ids, never the values used for queue updates. Updates execute as an in-memory serial queue, one Skill at a time, with per-item conflict/failure results and no persistent queue records. The resource repository renders one bundled Markdown guide and locally parses two controlled prompt blocks for copy actions.

**Tech Stack:** Electron 41, Node.js runtime APIs, Vite 8 raw imports, React 19, TypeScript 6, zod, shadcn/ui, Tailwind CSS 4, Vitest.

## Global Constraints

- Do not add a dependency.
- Do not persist Skill installation instances, binding paths, scan results, or secret-to-Skill relationships.
- `.env.example` is publishable Skill source; `.env` is local runtime configuration and must not enter Resource Repository content.
- Synapse identifies associations only by the `.env` key name, matched case-insensitively while preserving file casing.
- Secret names are immutable after creation; values and descriptions remain editable.
- Skill `.env` values must never appear in renderer scan payloads, UI text, logs, audits, diagnostics, backups, or errors.
- The renderer submits `scanSessionId` plus result ids; the main process revalidates paths, hashes, key uniqueness, and symlinks before writing.
- Scan only supported editor global Skill roots and configured-project Skill roots; never scan the full disk.
- Do not follow a Skill directory or `.env` symlink outside a trusted root.
- Use existing permission guards, audits, and atomic file replacement for external writes.
- Rule `${{ NAME }}` behavior remains unchanged.
- Legacy Skill `${{ NAME }}` substitution remains temporarily supported and is labeled non-synchronizable.
- UI uses existing shadcn components, `SystemAppWindowShell`, `SystemAppTopBarActionButton`, `DialogFrame`, `MarkdownViewer`, and theme tokens. No custom colors, CSS modules, inline styles, nested cards, gradients, glow, or marketing copy.
- Do not start a dev server for verification.
- Update `AGENTS.md`, the Synapse Skill Secrets guide/API reference, and `RELEASE_NOTES_PENDING.md` in the same implementation.

---

## File Structure

Create:

- `desktop/electron/services/skill-env/dotenv-document.ts`: parse, validate, patch, serialize, and merge Dotenv documents without losing unrelated formatting.
- `desktop/electron/services/skill-env/__tests__/dotenv-document.test.ts`: format, duplicate-key, CRLF, multiline, patch, and merge coverage.
- `desktop/electron/services/skill-env/skill-env-source-service.ts`: inspect `.env.example` across repository, prepared, and local Skill sources.
- `desktop/electron/services/skill-env/__tests__/skill-env-source-service.test.ts`: source-origin inspection coverage.
- `desktop/electron/services/skill-env/skill-env-materializer.ts`: generate or merge `.env` inside an install staging directory.
- `desktop/electron/services/skill-env/__tests__/skill-env-materializer.test.ts`: fresh install and update merge coverage.
- `desktop/electron/services/editor-scan-roots.ts`: shared trusted global/project Skill-root enumeration.
- `desktop/app-capabilities/secrets/main/skill-env-binding-service.ts`: ephemeral scan sessions and revalidated serial queue updates.
- `desktop/app-capabilities/secrets/main/__tests__/skill-env-binding-service.test.ts`: discovery, security, conflict, expiry, and redaction coverage.
- `desktop/app-capabilities/secrets/renderer/skill-env-update-dialog.tsx`: selection and per-item result UI.
- `desktop/src/modules/content/components/skill-env-values-dialog.tsx`: install-time values form for `.env.example` declarations.
- `desktop/src/modules/resource-repository/docs/skill-authoring-guide.md`: bundled guide and the two canonical prompts.
- `desktop/src/modules/resource-repository/skill-authoring-guide.ts`: strict prompt-block parser.
- `desktop/src/modules/resource-repository/skill-authoring-guide-dialog.tsx`: guide modal and copy actions.
- `desktop/src/modules/resource-repository/__tests__/skill-authoring-guide.test.tsx`: parser, rendering, and clipboard coverage.

Modify:

- `desktop/src/types/installers.ts`: installer inspection and `skillEnvValues` contracts.
- `desktop/src/types/editor.ts`: install-core `skillEnvValues` field.
- `desktop/src/lib/content-attachments.ts`: reserve root `.env` and allow the explicit `.env.example` source path.
- `desktop/electron/services/content-skill-source-service.ts`: include `.env.example`, reject root `.env`, and keep other hidden files excluded.
- `desktop/electron/services/content-write-service.ts`: reject root `.env` in Resource Repository Skill payloads.
- `desktop/electron/services/installer-source-service.ts`: read local text attachments for inspection.
- `desktop/electron/services/editor-install-service.ts`: inspect sources and extend prepared-source provider text reads.
- `desktop/electron/services/skill-repository-install-service.ts`: read prepared `.env.example` as text.
- `desktop/app-capabilities/synapse-skill/main/service.ts`: read prepared `.env.example` as text.
- `desktop/app-capabilities/synapse-skill/main/prepared-source-provider.ts`: expose the new provider method.
- `desktop/electron/services/editor-install-core.ts`: materialize `.env` after staging Skill contents.
- `desktop/electron/modules/installers/ipc.ts`: inspection channel and install schemas.
- `desktop/electron/modules/content/ipc.ts`: keep direct install schema aligned.
- `desktop/src/app-shell/installers.ts`: renderer inspection helper.
- `desktop/src/modules/installers/shared/shared-installer-flow.tsx`: separate sustainable ENV declarations from legacy body substitutions.
- `desktop/src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx`: ENV, legacy, mixed-mode, defaults, and project-warning tests.
- `desktop/electron/services/editor-scan-service.ts`: consume shared trusted-root enumeration.
- `desktop/app-capabilities/secrets/shared/schema.ts`: immutable-name update schema and scan/apply schemas.
- `desktop/app-capabilities/secrets/main/service.ts`: delegate scan/apply while keeping secret values internal.
- `desktop/app-capabilities/secrets/main/ipc.ts`: scan/apply IPC methods with external-file security dependencies.
- `desktop/electron/bootstrap/descriptors.ts`: construct the binding service inside `core.secrets`.
- `desktop/electron/bootstrap/__tests__/registry.test.ts`: dependency expectation if descriptor dependencies change.
- `desktop/app-capabilities/secrets/main/__tests__/service.test.ts`: immutable name and private-value delegation tests.
- `desktop/app-capabilities/secrets/main/__tests__/ipc.test.ts`: channels, schemas, and security delegation tests.
- `desktop/app-capabilities/secrets/main/dispatcher.ts`: remove rename support from MCP update input behavior.
- `desktop/app-capabilities/secrets/main/__tests__/dispatcher.test.ts`: immutable-name MCP coverage.
- `desktop/app-capabilities/secrets/renderer/index.tsx`: trigger scans, add manual scan action, make name read-only, and gate delete.
- `desktop/app-capabilities/secrets/renderer/__tests__/secrets-app.test.tsx`: scan/update/delete/immutable-name UI coverage.
- `desktop/src/modules/resource-repository/index.tsx`: Skill-only top-bar action and guide dialog state.
- `desktop/src/modules/resource-repository/__tests__/resource-repository.test.tsx`: action visibility across tabs.
- `desktop/electron/preload.ts`: generated scan/apply/inspection bridge methods.
- `desktop/src/types/bridge.ts`: generated bridge contracts.
- `desktop/electron/generated/ipc-channels.generated.ts`: generated channels.
- `desktop/app-capabilities/synapse-skill/skill-package/secrets/index.md`: ENV association and desktop confirmation guidance.
- `desktop/app-capabilities/synapse-skill/skill-package/secrets/api-reference.md`: immutable name and MCP non-propagation behavior.
- `AGENTS.md`: stable Skill ENV protocol and security boundary.
- `RELEASE_NOTES_PENDING.md`: user-facing release note.

---

### Task 1: Dotenv Document Engine

**Files:**
- Create: `desktop/electron/services/skill-env/dotenv-document.ts`
- Create: `desktop/electron/services/skill-env/__tests__/dotenv-document.test.ts`

**Interfaces:**
- Produces `parseDotenvDocument(content: string): DotenvDocument`.
- Produces `patchDotenvValues(content: string, values: Readonly<Record<string, string>>): string`.
- Produces `createDotenvFromExample(example: string, values: Readonly<Record<string, string>>): string`.
- Produces `mergeDotenvExample(existing: string, example: string, values: Readonly<Record<string, string>>): string`.
- `DotenvDocument.entries` contains unique case-insensitive names, decoded values, line numbers, and raw value spans.

- [ ] **Step 1: Write failing parser and patch tests**

Create `desktop/electron/services/skill-env/__tests__/dotenv-document.test.ts` with explicit cases:

```ts
import { describe, expect, it } from "vitest"
import {
  createDotenvFromExample,
  mergeDotenvExample,
  parseDotenvDocument,
  patchDotenvValues,
} from "../dotenv-document"

describe("dotenv document", () => {
  it("parses comments, export, quoted multiline values, and CRLF", () => {
    const input = "# config\r\nexport TOKEN='old'\r\nMULTI=\"a\r\nb\"\r\n"
    const parsed = parseDotenvDocument(input)
    expect(parsed.newline).toBe("\r\n")
    expect(parsed.entries.map((entry) => [entry.name, entry.value, entry.line])).toEqual([
      ["TOKEN", "old", 2],
      ["MULTI", "a\nb", 3],
    ])
  })

  it("rejects duplicate names case-insensitively", () => {
    expect(() => parseDotenvDocument("TOKEN=one\ntoken=two\n"))
      .toThrow("配置键重复：token")
  })

  it("patches only the selected raw value", () => {
    const input = "# keep\nTOKEN = old # keep comment\nOTHER='same'\n"
    const next = patchDotenvValues(input, { token: "new value" })
    expect(next).toBe("# keep\nTOKEN = \"new value\" # keep comment\nOTHER='same'\n")
  })

  it("creates and merges without deleting user keys", () => {
    expect(createDotenvFromExample("TOKEN=\nURL=https://example.com\n", { TOKEN: "secret" }))
      .toBe("TOKEN=\"secret\"\nURL=https://example.com\n")
    expect(mergeDotenvExample("TOKEN=old\nCUSTOM=yes\n", "TOKEN=\nNEW_KEY=default\n", {}))
      .toBe("TOKEN=old\nCUSTOM=yes\nNEW_KEY=default\n")
  })
})
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/skill-env/__tests__/dotenv-document.test.ts
```

Expected: FAIL because `../dotenv-document` does not exist.

- [ ] **Step 3: Implement the document model and span-safe writer**

Create `desktop/electron/services/skill-env/dotenv-document.ts` with these exported contracts:

```ts
export type DotenvEntry = {
  readonly name: string
  readonly value: string
  readonly line: number
  readonly valueStart: number
  readonly valueEnd: number
}

export type DotenvDocument = {
  readonly content: string
  readonly newline: "\n" | "\r\n"
  readonly entries: readonly DotenvEntry[]
}

export function parseDotenvDocument(content: string): DotenvDocument
export function patchDotenvValues(
  content: string,
  values: Readonly<Record<string, string>>,
): string
export function createDotenvFromExample(
  example: string,
  values: Readonly<Record<string, string>>,
): string
export function mergeDotenvExample(
  existing: string,
  example: string,
  values: Readonly<Record<string, string>>,
): string
```

Implementation rules:

```ts
const DOTENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

function normalizedName(name: string): string {
  return name.toLowerCase()
}

function serializeDotenvValue(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n")
  return `"${normalized.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}
```

Use a character scanner to record the exact raw value span. It must treat a matching `'`, `"`, or backtick as a quoted value that may cross lines; unquoted values end before an inline comment; `export` is ignored only as a declaration prefix. Validate decoded values with Node's `parseEnv` from `node:util`, reject NUL bytes and unterminated quotes, and apply replacements from highest `valueStart` to lowest so earlier spans do not shift. `mergeDotenvExample` appends only example keys absent from existing content and keeps the existing newline style.

- [ ] **Step 4: Run parser tests and typecheck the file**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/skill-env/__tests__/dotenv-document.test.ts
pnpm --filter @synapse/desktop exec tsc -p tsconfig.electron.json --noEmit --pretty false
```

Expected: tests PASS; TypeScript exits 0.

- [ ] **Step 5: Commit the document engine**

```bash
git add desktop/electron/services/skill-env/dotenv-document.ts desktop/electron/services/skill-env/__tests__/dotenv-document.test.ts
git commit -m "feat: add skill dotenv document engine"
```

---

### Task 2: Skill Source ENV Policy And Inspection

**Files:**
- Create: `desktop/electron/services/skill-env/skill-env-source-service.ts`
- Create: `desktop/electron/services/skill-env/__tests__/skill-env-source-service.test.ts`
- Modify: `desktop/src/types/installers.ts`
- Modify: `desktop/src/lib/content-attachments.ts`
- Modify: `desktop/electron/services/content-skill-source-service.ts`
- Modify: `desktop/electron/services/content-write-service.ts`
- Modify: `desktop/electron/services/installer-source-service.ts`
- Modify: `desktop/electron/services/editor-install-service.ts`
- Modify: `desktop/electron/services/skill-repository-install-service.ts`
- Modify: `desktop/app-capabilities/synapse-skill/main/service.ts`
- Modify: `desktop/app-capabilities/synapse-skill/main/prepared-source-provider.ts`
- Test: `desktop/electron/services/__tests__/installer-source-service.test.ts`
- Test: `desktop/electron/services/__tests__/content-write-service.test.ts`
- Test: `desktop/electron/services/__tests__/editor-install-service-prepared-source.test.ts`

**Interfaces:**
- Produces `SKILL_ENV_EXAMPLE_PATH = ".env.example"` and `SKILL_RUNTIME_ENV_PATH = ".env"`.
- Produces `SynapseSkillEnvDeclaration` and `SynapseSkillEnvInspectionResult` in `desktop/src/types/installers.ts`.
- Extends prepared/local source providers with `read*SkillAttachmentText(...): Promise<string | null>`.
- Produces `SkillEnvSourceService.inspect(source): Promise<SynapseSkillEnvInspectionResult>`.

- [ ] **Step 1: Write failing source-policy tests**

Add tests that create a temporary Skill directory containing `SKILL.md` plus `.env.example` and assert the draft includes `.env.example`. Add a second fixture containing root `.env` and assert `readSkillDraftFromDirectory` rejects it with:

```text
Skill 源目录不能包含 .env，请只提交 .env.example。
```

Add a `content-write-service` test with a Skill file payload named `.env` and assert create/update rejects before `attachmentsPoolService.writeAttachments` runs.

- [ ] **Step 2: Run source-policy tests and confirm failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/installer-source-service.test.ts electron/services/__tests__/content-write-service.test.ts
```

Expected: FAIL because hidden files are currently skipped and `.env` is not reserved.

- [ ] **Step 3: Add shared source contracts and attachment policy**

Add to `desktop/src/types/installers.ts`:

```ts
export type SynapseSkillEnvDeclaration = {
  name: string
  defaultValue: string
}

export type SynapseSkillEnvInspectionResult = {
  declarations: SynapseSkillEnvDeclaration[]
  legacyPlaceholders: string[]
}
```

Add to `desktop/src/lib/content-attachments.ts`:

```ts
const SKILL_ENV_EXAMPLE_PATH = ".env.example"
const SKILL_RUNTIME_ENV_PATH = ".env"

function assertNoRuntimeSkillEnvPath(originalNames: readonly string[]): void {
  if (originalNames.some((name) => normalizeContentAttachmentPath(name) === SKILL_RUNTIME_ENV_PATH)) {
    throw new Error("Skill 源目录不能包含 .env，请只提交 .env.example。")
  }
}
```

Export all three symbols. Call `assertNoRuntimeSkillEnvPath` from `resolveAttachmentRecords` before writing attachments. In `collectSkillFiles`, allow root `.env.example`, reject root `.env`, and continue skipping every other name beginning with `.`.

- [ ] **Step 4: Add text-attachment reads for all source origins**

Add these methods with identical null semantics:

```ts
readLocalSkillAttachmentText(
  source: SynapseSkillInstallerSource,
  relativePath: string,
): Promise<string | null>

readPreparedSkillAttachmentText(
  sourceId: string,
  contentId: string,
  relativePath: string,
): Promise<string | null>
```

Local sources read `stored.draft.files` and decode UTF-8 bytes. Prepared Skill Repository sources read the validated materialized package path. Synapse Skill sources read from `packageRoot`. Composite and unavailable prepared providers forward or reject consistently. Repository sources use `contentService.getAttachmentFile("skill", id, latestHistoryDirname, relativePath)` and return text content only.

- [ ] **Step 5: Implement source inspection**

Create `skill-env-source-service.ts` with:

```ts
export type SkillEnvSourceReader = {
  readMainContent(source: SynapseSkillInstallerSource): Promise<string>
  readTextAttachment(
    source: SynapseSkillInstallerSource,
    relativePath: string,
  ): Promise<string | null>
}

export class SkillEnvSourceService {
  constructor(private readonly reader: SkillEnvSourceReader) {}

  async inspect(source: SynapseSkillInstallerSource): Promise<SynapseSkillEnvInspectionResult> {
    const [mainContent, example] = await Promise.all([
      this.reader.readMainContent(source),
      this.reader.readTextAttachment(source, SKILL_ENV_EXAMPLE_PATH),
    ])
    const legacyPlaceholders = detectPlaceholders(mainContent, { includeCodeBlocks: true })
    const declarations = example === null
      ? []
      : parseDotenvDocument(example).entries.map(({ name, value }) => ({ name, defaultValue: value }))
    return { declarations, legacyPlaceholders }
  }
}
```

Wire one instance into `EditorInstallService.inspectSkillEnvSource(source)` using the source-origin readers above.

- [ ] **Step 6: Run source and provider tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/skill-env/__tests__/skill-env-source-service.test.ts electron/services/__tests__/installer-source-service.test.ts electron/services/__tests__/content-write-service.test.ts electron/services/__tests__/editor-install-service-prepared-source.test.ts app-capabilities/synapse-skill/main/__tests__/service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit source inspection**

```bash
git add desktop/src/types/installers.ts desktop/src/lib/content-attachments.ts desktop/electron/services/content-skill-source-service.ts desktop/electron/services/content-write-service.ts desktop/electron/services/installer-source-service.ts desktop/electron/services/editor-install-service.ts desktop/electron/services/skill-repository-install-service.ts desktop/app-capabilities/synapse-skill/main/service.ts desktop/app-capabilities/synapse-skill/main/prepared-source-provider.ts desktop/electron/services/skill-env/skill-env-source-service.ts desktop/electron/services/skill-env/__tests__/skill-env-source-service.test.ts desktop/electron/services/__tests__/installer-source-service.test.ts desktop/electron/services/__tests__/content-write-service.test.ts desktop/electron/services/__tests__/editor-install-service-prepared-source.test.ts
git commit -m "feat: inspect skill env declarations"
```

---

### Task 3: Installer ENV Confirmation Flow

**Files:**
- Create: `desktop/src/modules/content/components/skill-env-values-dialog.tsx`
- Modify: `desktop/src/types/installers.ts`
- Modify: `desktop/src/app-shell/installers.ts`
- Modify: `desktop/electron/modules/installers/ipc.ts`
- Modify: `desktop/src/modules/installers/shared/shared-installer-flow.tsx`
- Modify: `desktop/src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx`

**Interfaces:**
- Adds `inspectSkillEnvSource(source)` to the installers bridge.
- Adds `skillEnvValues?: Record<string, string>` to single and batch install payloads.
- `SkillEnvValuesDialog` consumes declarations, Secrets safe views, resolved initial values, and returns the confirmed map.

- [ ] **Step 1: Write failing shared installer tests**

Add `inspectSkillEnvSource` to the installer mock and cover:

```ts
mocks.inspectSkillEnvSource.mockResolvedValue({
  declarations: [
    { name: "GITEE_TOKEN", defaultValue: "" },
    { name: "API_BASE_URL", defaultValue: "https://example.com" },
  ],
  legacyPlaceholders: [],
})
```

Assertions:

```ts
expect(document.body.textContent).toContain("Skill 配置")
expect(inputByLabel("GITEE_TOKEN").value).toBe("saved-token")
expect(inputByLabel("API_BASE_URL").value).toBe("https://example.com")
expect(mocks.installSourceToEditor).toHaveBeenCalledWith(expect.objectContaining({
  skillEnvValues: {
    GITEE_TOKEN: "saved-token",
    API_BASE_URL: "https://example.com",
  },
}))
```

Add mixed-mode coverage where `legacyPlaceholders` contains `INLINE_TOKEN`; assert the legacy dialog labels it `安装后无法同步` and the payload contains both `skillEnvValues` and `variableSubstitutions`. Add a project-scope test asserting the confirmation text contains `请确认 .env 不会被提交到 Git。`.

- [ ] **Step 2: Run renderer test and confirm failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx
```

Expected: FAIL because inspection and the ENV dialog do not exist.

- [ ] **Step 3: Add IPC and bridge contracts**

Add `inspectSkillEnvSource` to `installersIpcModule`:

```ts
inspectSkillEnvSource: {
  kind: "invoke",
  channel: "synapse:installers:inspect-skill-env-source",
  request: skillInstallerSourceSchema,
  response: z.object({
    declarations: z.array(z.object({ name: z.string(), defaultValue: z.string() })),
    legacyPlaceholders: z.array(z.string()),
  }).strict(),
  handler: (_ctx, source) => editorInstallService.inspectSkillEnvSource(source),
},
```

Expose it from `desktop/src/app-shell/installers.ts`. Add `skillEnvValues` to single/batch installer types and zod request schemas.

- [ ] **Step 4: Implement `SkillEnvValuesDialog`**

Use the existing `FormDialog`, `Input`, `Label`, `Separator`, and `Button`. Required copy:

```ts
title="Skill 配置"
description="这些值会写入 Skill 目录中的 .env。"
```

Each label is the raw key name in `font-mono`; the dialog returns every declaration, including empty values, because empty is a valid `.env` value. Do not show `${{ }}` notation.

- [ ] **Step 5: Split sustainable and legacy installer state**

In `SharedInstallerFlow`, use separate refs:

```ts
const pendingSkillEnvValuesRef = useRef<Record<string, string> | undefined>()
const pendingLegacySubstitutionsRef = useRef<Record<string, string> | undefined>()
```

For Skill sources, call `inspectSkillEnvSource`. Resolve each initial value with this precedence: current form value, same-name secret value, declaration default, empty string. Run the existing secret save confirmation against both confirmed maps without duplicating secret names. For Rules, keep the current body-placeholder path unchanged. Pass both maps to `installSourceToEditor`.

- [ ] **Step 6: Run installer tests and IPC code generation**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx electron/modules/installers/__tests__/ipc.test.ts
pnpm --filter @synapse/desktop run generate:ipc
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: tests PASS; generated preload, bridge, and channel files are current.

- [ ] **Step 7: Commit installer confirmation**

```bash
git add desktop/src/modules/content/components/skill-env-values-dialog.tsx desktop/src/types/installers.ts desktop/src/app-shell/installers.ts desktop/electron/modules/installers/ipc.ts desktop/src/modules/installers/shared/shared-installer-flow.tsx desktop/src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/electron/generated/ipc-channels.generated.ts
git commit -m "feat: add skill env install confirmation"
```

---

### Task 4: Atomic `.env` Materialization During Install

**Files:**
- Create: `desktop/electron/services/skill-env/skill-env-materializer.ts`
- Create: `desktop/electron/services/skill-env/__tests__/skill-env-materializer.test.ts`
- Modify: `desktop/src/types/editor.ts`
- Modify: `desktop/src/types/installers.ts`
- Modify: `desktop/electron/services/editor-install-core.ts`
- Modify: `desktop/electron/services/editor-install-service.ts`
- Modify: `desktop/electron/modules/content/ipc.ts`
- Modify: `desktop/electron/modules/installers/ipc.ts`
- Test: `desktop/electron/services/__tests__/editor-install-core-installer-source.test.ts`
- Test: `desktop/electron/services/__tests__/editor-install-service-batch.test.ts`

**Interfaces:**
- Produces `materializeSkillEnv(input): Promise<"created" | "merged" | "absent">`.
- Install payloads carry `skillEnvValues` through batch, service, and core layers.

- [ ] **Step 1: Write failing materializer tests**

Cover a fresh staging directory, an existing target `.env`, an example with a newly added key, and a target containing a user-only key. Assert exact bytes, including CRLF preservation. Add a core integration test that installs a Skill containing `.env.example` and verifies the final target contains both files while `SKILL.md` remains unsubstituted by `skillEnvValues`.

- [ ] **Step 2: Run focused tests and confirm failure**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/skill-env/__tests__/skill-env-materializer.test.ts electron/services/__tests__/editor-install-core-installer-source.test.ts
```

Expected: FAIL because `.env` is not materialized.

- [ ] **Step 3: Implement the materializer**

Create this public input contract:

```ts
export type MaterializeSkillEnvInput = {
  readonly stagingDirectoryPath: string
  readonly existingTargetDirectoryPath: string
  readonly values: Readonly<Record<string, string>>
}

export async function materializeSkillEnv(
  input: MaterializeSkillEnvInput,
): Promise<"created" | "merged" | "absent">
```

Behavior:

```ts
const stagedExamplePath = path.join(input.stagingDirectoryPath, SKILL_ENV_EXAMPLE_PATH)
const stagedEnvPath = path.join(input.stagingDirectoryPath, SKILL_RUNTIME_ENV_PATH)
const existingEnvPath = path.join(input.existingTargetDirectoryPath, SKILL_RUNTIME_ENV_PATH)
```

If `.env.example` is absent, return `absent`. If an existing `.env` is a symlink, throw `Skill .env 不能是符号链接。`. Otherwise create from the example or merge the existing file, then write the final document to `stagedEnvPath`. Never mutate the old target before the staging directory swap.

- [ ] **Step 4: Wire materialization after shared Skill directory preparation**

Add `skillEnvValues` to `SynapseInstallToEditorPayload`, `SynapseInstallSourceToEditorPayload`, and batch propagation. In `EditorInstallCore`, call:

```ts
await prepareSkillDirectory(prepareContext)
await materializeSkillEnv({
  stagingDirectoryPath,
  existingTargetDirectoryPath: target.targetPath,
  values: payload.skillEnvValues ?? {},
})
```

Keep `applyVariableSubstitutions` limited to `detail.content` and `payload.variableSubstitutions`; never pass `skillEnvValues` to it.

- [ ] **Step 5: Run install tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/skill-env/__tests__/skill-env-materializer.test.ts electron/services/__tests__/editor-install-core-installer-source.test.ts electron/services/__tests__/editor-install-service-batch.test.ts electron/services/__tests__/editor-install-service-prepared-source.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit atomic materialization**

```bash
git add desktop/electron/services/skill-env/skill-env-materializer.ts desktop/electron/services/skill-env/__tests__/skill-env-materializer.test.ts desktop/src/types/editor.ts desktop/src/types/installers.ts desktop/electron/services/editor-install-core.ts desktop/electron/services/editor-install-service.ts desktop/electron/modules/content/ipc.ts desktop/electron/modules/installers/ipc.ts desktop/electron/services/__tests__/editor-install-core-installer-source.test.ts desktop/electron/services/__tests__/editor-install-service-batch.test.ts
git commit -m "feat: materialize skill env files on install"
```

---

### Task 5: Trusted Binding Scan And Revalidated Queue Update

**Files:**
- Create: `desktop/electron/services/editor-scan-roots.ts`
- Create: `desktop/app-capabilities/secrets/main/skill-env-binding-service.ts`
- Create: `desktop/app-capabilities/secrets/main/__tests__/skill-env-binding-service.test.ts`
- Modify: `desktop/electron/services/editor-scan-service.ts`
- Modify: `desktop/app-capabilities/secrets/shared/schema.ts`
- Modify: `desktop/app-capabilities/secrets/main/service.ts`
- Modify: `desktop/app-capabilities/secrets/main/ipc.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/bootstrap/__tests__/registry.test.ts`
- Modify: `desktop/app-capabilities/secrets/main/__tests__/service.test.ts`
- Modify: `desktop/app-capabilities/secrets/main/__tests__/ipc.test.ts`

**Interfaces:**
- Produces `listTrustedSkillRoots(): Promise<TrustedSkillRoot[]>`.
- Produces `SkillEnvBindingService.scan(name, value, security)` and `.enqueue(input, value, security)`.
- Secrets IPC adds `scanSkillEnvBindings` and `queueSkillEnvBindings`.
- Queue execution is in-memory and serial: one Skill update at a time, ordered by `itemIds`; a conflict/failure is recorded and the next item continues. No persistent queue record is created.
- Scan sessions expire after exactly five minutes and live only in memory.

- [ ] **Step 1: Add failing schemas and service tests**

Define expected safe shapes in tests:

```ts
const scanResult = {
  scanSessionId: "scan-1",
  items: [{
    id: "item-1",
    skillName: "demo",
    editors: [{ id: "codex", label: "Codex" }],
    scope: "global",
    envPath: "/tmp/codex/demo/.env",
    status: "needs_update",
  }],
}
```

Test `needs_update`, `up_to_date`, `invalid`, `unwritable`, and `unsafe_link`; verify JSON never contains old or new values. Test forged ids, expiry at `300_000` ms, hash changes, duplicate keys, serial queue order, and a queue where the second item still succeeds after the first conflicts.

- [ ] **Step 2: Run service tests and confirm failure**

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/secrets/main/__tests__/skill-env-binding-service.test.ts app-capabilities/secrets/main/__tests__/service.test.ts
```

Expected: FAIL because scan contracts and service do not exist.

- [ ] **Step 3: Extract shared trusted-root enumeration**

Create:

```ts
export type TrustedSkillRoot = {
  readonly editors: readonly {
    readonly id: SynapseEditorId
    readonly label: string
  }[]
  readonly scope: "global" | "project"
  readonly projectId?: string
  readonly projectName?: string
  readonly path: string
}

export async function listTrustedSkillRoots(): Promise<TrustedSkillRoot[]>
```

Build it from each adapter's `globalSkillPaths` or `globalSkillsPath`, plus `configStore.load().global.projects` and `projectPaths(project.path).skillsPath`. Deduplicate by normalized path, scope, and project id; aggregate every editor using the same physical root into `editors` so one `.env` is never offered twice. Refactor `editor-scan-service.ts` to consume this helper instead of maintaining a second trusted-root implementation.

- [ ] **Step 4: Add zod scan/apply contracts**

In `desktop/app-capabilities/secrets/shared/schema.ts`, add:

```ts
export const skillEnvBindingStatusSchema = z.enum([
  "needs_update",
  "up_to_date",
  "invalid",
  "unwritable",
  "unsafe_link",
])

export const secretSkillEnvScanInputSchema = z.object({ name: secretNameSchema }).strict()
export const secretSkillEnvApplyInputSchema = z.object({
  name: secretNameSchema,
  scanSessionId: z.string().min(1),
  itemIds: z.array(z.string().min(1)),
}).strict()
```

Add result schemas with only ids, names, `editors: Array<{ id, label }>`, scope, path, status, and a short optional message. Apply result statuses are `updated`, `failed`, and `conflict`.

- [ ] **Step 5: Implement ephemeral discovery and updates**

The service constructor is:

```ts
export type SkillEnvBindingServiceDeps = {
  readonly listRoots: () => Promise<TrustedSkillRoot[]>
  readonly createId?: () => string
  readonly now?: () => number
  readonly logger: SkillEnvBindingLogger
}

export function createSkillEnvBindingService(deps: SkillEnvBindingServiceDeps)
```

Scanning reads only direct child directories containing a regular `SKILL.md` and root `.env`. Check `fs.read.outside-userdata` before reading each trusted root. Use `lstat` before `readFile`; return `unsafe_link` for an `.env` symlink. Parse with `parseDotenvDocument`, locate one case-insensitive key, compare internally, hash the full file with SHA-256, and store the root plus hash in a private session map. Prune every session older than `300_000` ms at the start of scan and apply calls.

Applying requires the same secret name, re-runs trusted-root containment checks, re-reads and re-hashes the file, rejects symlinks and duplicate keys, calls `patchDotenvValues`, checks `fs.write` permission, and writes through `replaceFileAtomically`. Audit metadata contains only secret name, editor ids, scope, Skill name, and outcome.

- [ ] **Step 6: Keep secret values inside `SecretsService`**

Extend `SecretsServiceDeps` with the binding service. Add:

```ts
async function scanSkillEnvBindings(input, security) {
  const secret = await requireByName(input.name)
  return deps.skillEnvBindings.scan(secret.name, secret.value, security)
}

async function queueSkillEnvBindings(input, security) {
  const secret = await requireByName(input.name)
  return deps.skillEnvBindings.enqueue(input, secret.value, security)
}
```

The IPC handlers resolve `core.permission-guard` and `core.audit-sink`, use actor `{ kind: "user" }`, and never accept a value from Renderer.

- [ ] **Step 7: Run service, IPC, registry, and editor-scan tests**

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/secrets/main/__tests__/skill-env-binding-service.test.ts app-capabilities/secrets/main/__tests__/service.test.ts app-capabilities/secrets/main/__tests__/ipc.test.ts electron/services/__tests__/editor-scan-service.test.ts electron/bootstrap/__tests__/registry.test.ts
pnpm --filter @synapse/desktop run generate:ipc
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: PASS and generated bridge files current.

- [ ] **Step 8: Commit binding scan and update**

```bash
git add desktop/electron/services/editor-scan-roots.ts desktop/electron/services/editor-scan-service.ts desktop/app-capabilities/secrets/shared/schema.ts desktop/app-capabilities/secrets/main/skill-env-binding-service.ts desktop/app-capabilities/secrets/main/__tests__/skill-env-binding-service.test.ts desktop/app-capabilities/secrets/main/service.ts desktop/app-capabilities/secrets/main/ipc.ts desktop/app-capabilities/secrets/main/__tests__/service.test.ts desktop/app-capabilities/secrets/main/__tests__/ipc.test.ts desktop/electron/bootstrap/descriptors.ts desktop/electron/bootstrap/__tests__/registry.test.ts desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/electron/generated/ipc-channels.generated.ts
git commit -m "feat: scan and update skill env bindings"
```

---

### Task 6: Secrets UI Integration And Immutable Names

**Files:**
- Create: `desktop/app-capabilities/secrets/renderer/skill-env-update-dialog.tsx`
- Modify: `desktop/app-capabilities/secrets/shared/schema.ts`
- Modify: `desktop/app-capabilities/secrets/main/service.ts`
- Modify: `desktop/app-capabilities/secrets/main/dispatcher.ts`
- Modify: `desktop/app-capabilities/secrets/renderer/index.tsx`
- Modify: `desktop/app-capabilities/secrets/main/__tests__/service.test.ts`
- Modify: `desktop/app-capabilities/secrets/main/__tests__/dispatcher.test.ts`
- Modify: `desktop/app-capabilities/secrets/renderer/__tests__/secrets-app.test.tsx`

**Interfaces:**
- Removes `newName` from `SecretUpdateInput`.
- `SkillEnvUpdateDialog` receives one safe scan result and calls `queueSkillEnvBindings` with selected ids; the service processes them serially and returns ordered per-item results.
- Create/value-update/manual-scan open the scan flow; description-only updates do not.

- [ ] **Step 1: Write failing immutable-name and scan UI tests**

Update service tests so `secretUpdateInputSchema` rejects `newName` and `SecretsService.update` preserves the original name. Renderer assertions:

```ts
expect(document.querySelector<HTMLInputElement>("#secret-name")?.readOnly).toBe(true)
expect(mocks.secrets.scanSkillEnvBindings).not.toHaveBeenCalled()
```

for description-only edit, and:

```ts
expect(mocks.secrets.scanSkillEnvBindings).toHaveBeenCalledWith({ name: "TOKEN" })
expect(document.body.textContent).toContain("更新 Skill 配置")
expect(mocks.secrets.queueSkillEnvBindings).toHaveBeenCalledWith({
  name: "TOKEN",
  scanSessionId: "scan-1",
  itemIds: ["item-1"],
})
```

for a value update. Add manual scan and delete-before-scan tests. A failed delete scan must keep the secret and display `扫描失败，请重试。`.

- [ ] **Step 2: Run Secrets tests and confirm failure**

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/secrets/main/__tests__/service.test.ts app-capabilities/secrets/main/__tests__/dispatcher.test.ts app-capabilities/secrets/renderer/__tests__/secrets-app.test.tsx
```

Expected: FAIL because rename is still supported and scan UI is absent.

- [ ] **Step 3: Remove rename behavior end to end**

Remove `newName` from the shared schema, service update logic, MCP dispatcher parsing, tests, and renderer submit payload. In edit mode render the name input with both `readOnly` and `aria-readonly="true"`; keep it visible so the stable association key remains clear.

- [ ] **Step 4: Implement the update dialog**

Use `DialogFrame`, `Table`, `Checkbox`, `Badge`, and existing Buttons. Columns are Skill, editor, scope, path, and status. Default selected ids are exactly items whose status is `needs_update`. Required labels:

```text
更新 Skill 配置
更新选中项
待更新
已是最新
格式错误
不可写
不安全路径
```

After apply, keep rows visible and map results to `已更新`, `更新失败`, or `文件已变化`. Do not render any old/new values.

- [ ] **Step 5: Trigger and recover scans from SecretsModule**

After successful create with a non-empty value or update with `updateValue === true`, call scan and open the dialog when items exist. Add a row action with `ScanSearch`, `aria-label="扫描关联 Skill：<name>"`, and tooltip `扫描关联 Skill`. Description-only saves close normally without scanning.

Before delete, scan first. The delete confirmation includes only `发现 N 个关联 Skill，删除密钥不会删除这些 .env 键。`; if zero, retain the current concise confirmation.

- [ ] **Step 6: Run Secrets UI and generated bridge tests**

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/secrets/main/__tests__/service.test.ts app-capabilities/secrets/main/__tests__/dispatcher.test.ts app-capabilities/secrets/renderer/__tests__/secrets-app.test.tsx
pnpm --filter @synapse/desktop run generate:ipc
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: PASS.

- [ ] **Step 7: Commit Secrets UI integration**

```bash
git add desktop/app-capabilities/secrets/shared/schema.ts desktop/app-capabilities/secrets/main/service.ts desktop/app-capabilities/secrets/main/dispatcher.ts desktop/app-capabilities/secrets/main/__tests__/service.test.ts desktop/app-capabilities/secrets/main/__tests__/dispatcher.test.ts desktop/app-capabilities/secrets/renderer/index.tsx desktop/app-capabilities/secrets/renderer/skill-env-update-dialog.tsx desktop/app-capabilities/secrets/renderer/__tests__/secrets-app.test.tsx desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/electron/generated/ipc-channels.generated.ts
git commit -m "feat: manage skill env updates from secrets"
```

---

### Task 7: Resource Repository Skill Authoring Guide

**Files:**
- Create: `desktop/src/modules/resource-repository/docs/skill-authoring-guide.md`
- Create: `desktop/src/modules/resource-repository/skill-authoring-guide.ts`
- Create: `desktop/src/modules/resource-repository/skill-authoring-guide-dialog.tsx`
- Create: `desktop/src/modules/resource-repository/__tests__/skill-authoring-guide.test.tsx`
- Modify: `desktop/src/modules/resource-repository/index.tsx`
- Modify: `desktop/src/modules/resource-repository/__tests__/resource-repository.test.tsx`

**Interfaces:**
- Produces `parseSkillAuthoringGuide(markdown): SkillAuthoringGuideSegment[]`.
- Supports exactly `upgrade-skill` and `create-skill` prompt block ids.
- `SkillAuthoringGuideDialog` renders ordinary segments with `MarkdownViewer` and prompt segments with adjacent copy buttons.

- [ ] **Step 1: Write failing parser and visibility tests**

Parser tests must assert two prompt segments preserve their exact text and reject missing, duplicate, or unknown ids. Resource repository tests must assert the `Skill 开发指南` action exists on `skill`, disappears on `rule` and `prompt`, and returns when switching back.

Clipboard test:

```ts
await clickButton("复制提示词", 0)
expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
  expect.stringContaining("请检查当前目录中的已有 Skill"),
)
expect(toast.success).toHaveBeenCalledWith("提示词已复制")
```

- [ ] **Step 2: Run guide tests and confirm failure**

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/resource-repository/__tests__/skill-authoring-guide.test.tsx src/modules/resource-repository/__tests__/resource-repository.test.tsx
```

Expected: FAIL because the guide files and action do not exist.

- [ ] **Step 3: Add the canonical Markdown guide**

Write the guide sections from the approved design in this order: directory structure, file responsibilities, Dotenv syntax, runtime loading, install/update behavior, project Git warning, old-Skill migration, new-Skill rules, upgrade prompt, create prompt. Use these complete prompt blocks as the canonical source:

```md
:::synapse-prompt id="upgrade-skill" title="修改现有 Skill"
请检查当前目录中的已有 Skill，并将它迁移到 Synapse Skill ENV 配置规范。直接修改文件并完成必要验证，不要只给建议。

要求：

1. 先阅读 SKILL.md、脚本、配置文件和现有测试，确认 Skill 的入口、运行时和当前配置来源。只修改完成迁移所需的文件，不做无关重构。
2. 查找 SKILL.md 或其他文件中的 `${{ NAME }}` 变量、硬编码 token、密码、API Key、地址及其他需要安装时配置的值。不要在回复、日志或最终总结中复述任何真实敏感值。
3. 在 Skill 根目录创建或完善 `.env.example`。使用标准 Dotenv `KEY=value` 格式；只写键名、必要注释和非敏感默认值，不写真实 token、密码、私钥或生产连接信息。
4. 让真正消费配置的脚本或程序从 Skill 根目录的 `.env` 读取值。路径必须根据脚本自身位置计算，不能依赖当前工作目录。
5. Node.js 20.12 及以上优先使用 `process.loadEnvFile()`；其他运行时优先复用项目已有的 Dotenv 能力。除非现有运行时没有可用方案，否则不要新增依赖。
6. 从 SKILL.md 和代码中移除真实敏感值，以及需要安装时写入正文的敏感占位符。SKILL.md 只说明如何调用脚本，不要求 Agent 读取、展示或复制 `.env`。
7. 如果当前源码中已经存在真实配置值，为保持本地运行可将它们迁移到本地 `.env`，但必须确保 `.env` 被 Git 忽略。不要创建包含真实值的 `.env.example`，不要把 `.env` 纳入提交或发布内容。
8. 如果无法确定某个配置值，不要编造。保留对应 `.env.example` 键为空，并让运行时在缺少必需键时返回包含键名的明确错误，但不得输出其他配置值。
9. 不要打印完整环境变量，不要把敏感值写入命令参数回显、日志、错误详情、缓存或生成文件。
10. 保持原有功能和入口兼容。运行现有测试；没有测试时执行最小可行验证，确认配置加载路径不依赖当前工作目录。
11. 完成后只总结修改的文件、声明的配置键名和验证结果，不展示任何配置值。
:::

:::synapse-prompt id="create-skill" title="创建新 Skill"
请在当前目录创建一个符合 Synapse Skill ENV 配置规范的新 Skill。直接创建完整文件并完成必要验证，不要只输出示例。

要求：

1. 先根据当前需求确定 Skill 的职责、触发场景、运行入口和最小文件结构。保持职责单一，不添加与需求无关的功能。
2. 创建规范的 SKILL.md 和必要的 scripts、references 或 assets。SKILL.md 应说明何时使用、如何调用以及必要限制，不写真实 token、密码、API Key、私钥或生产连接信息。
3. 只有 Skill 确实需要外部配置时才在根目录创建 `.env.example`。使用标准 Dotenv `KEY=value` 格式；键名应稳定、清晰，只包含必要注释和非敏感默认值。
4. 不要创建带真实值的可提交 `.env`。如果为了本地验证必须创建 `.env`，先确保它被 Git 忽略，并且不要在回复或最终总结中展示其内容。
5. 让消费配置的脚本从 Skill 根目录 `.env` 读取值。路径必须根据脚本自身位置计算，不能依赖当前工作目录。
6. Node.js 20.12 及以上优先使用 `process.loadEnvFile()`；其他运行时优先使用已有原生能力或项目现有依赖。没有明确必要时不要新增依赖。
7. 对必需配置进行启动前校验。缺失时可以报告键名和修复动作，但不得输出其他配置值。
8. 不要要求 Agent 读取、展示或复制 `.env`；不要打印完整环境变量；不要把敏感值写入命令参数回显、日志、错误详情、缓存或生成文件。
9. 添加适合该 Skill 的最小测试或验证，至少确认从非 Skill 工作目录启动时仍能正确定位 `.env`，并确认缺少必需键时安全失败。
10. 完成后总结目录结构、需要用户配置的键名和验证结果，不展示任何配置值。
:::
```

- [ ] **Step 4: Implement strict local parsing**

Use a line-oriented parser with this start grammar and exact closing marker:

```ts
const PROMPT_START = /^:::synapse-prompt id="(upgrade-skill|create-skill)" title="([^"]+)"$/
const PROMPT_END = ":::"
```

Return ordered union segments:

```ts
export type SkillAuthoringGuideSegment =
  | { readonly kind: "markdown"; readonly content: string }
  | {
      readonly kind: "prompt"
      readonly id: "upgrade-skill" | "create-skill"
      readonly title: string
      readonly content: string
    }
```

Require exactly one of each prompt id and non-empty content; throw `Skill 开发指南格式无效。` for every structural failure.

- [ ] **Step 5: Implement the modal with existing system components**

Import the guide using `./docs/skill-authoring-guide.md?raw`. Use:

```tsx
<DialogContent
  aria-describedby={undefined}
  className="max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-3xl"
  showCloseButton={false}
>
  <DialogFrame className="max-h-[calc(100vh-2rem)]">
    <DialogFrameHeader title="Skill 开发指南" />
    <DialogFrameBody>
      <ScrollArea className="h-full min-h-0">
        <div className="px-5 py-4" />
      </ScrollArea>
    </DialogFrameBody>
  </DialogFrame>
</DialogContent>
```

Each prompt segment renders a heading row with an outline `复制提示词` Button and a selectable `pre` using existing `bg-muted/40`, `border-border`, and typography utilities. Clipboard errors show `复制失败` and log only error name/message length.

- [ ] **Step 6: Add the Skill-only top-bar action**

Pass this action to `SystemAppWindowShell` only when `view === "skill"`:

```tsx
<SystemAppTopBarActionButton
  iconOnly
  type="button"
  aria-label="Skill 开发指南"
  tooltip="Skill 开发指南"
  onClick={() => setGuideOpen(true)}
>
  <BookOpen />
</SystemAppTopBarActionButton>
```

The shared shell automatically places it before the embedded “新窗口打开” button and in the standalone window actions slot.

- [ ] **Step 7: Run guide tests**

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/resource-repository/__tests__/skill-authoring-guide.test.tsx src/modules/resource-repository/__tests__/resource-repository.test.tsx src/modules/apps/components/__tests__/system-app-window-shell.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit the authoring guide**

```bash
git add desktop/src/modules/resource-repository/docs/skill-authoring-guide.md desktop/src/modules/resource-repository/skill-authoring-guide.ts desktop/src/modules/resource-repository/skill-authoring-guide-dialog.tsx desktop/src/modules/resource-repository/index.tsx desktop/src/modules/resource-repository/__tests__/skill-authoring-guide.test.tsx desktop/src/modules/resource-repository/__tests__/resource-repository.test.tsx
git commit -m "feat: add skill authoring guide"
```

---

### Task 8: Documentation, Release Notes, And Full Verification

**Files:**
- Modify: `desktop/app-capabilities/synapse-skill/skill-package/secrets/index.md`
- Modify: `desktop/app-capabilities/synapse-skill/skill-package/secrets/api-reference.md`
- Modify: `AGENTS.md`
- Modify: `RELEASE_NOTES_PENDING.md`
- Test: `desktop/app-capabilities/synapse-skill/main/__tests__/service.test.ts`
- Test: `desktop/tests/unit/api-mcp-capability-surface.test.ts`
- Test: `desktop/tests/unit/synapse-capabilities.test.ts`

**Interfaces:**
- No new MCP actions or tool names.
- Documents immutable names, file-based associations, and the fact that MCP value updates never silently rewrite installed files.

- [ ] **Step 1: Update stable project rules and Agent guidance**

Add a stable `Skill ENV 配置` boundary to `AGENTS.md`:

```md
- Skill 可持续配置使用根目录 `.env.example` 声明键，由安装器生成或合并本地 `.env`；不要把真实 `.env` 写入资源仓库，也不要继续把需要后续同步的值替换进 `SKILL.md`。
- 密钥名称与 `.env` 键名构成文件关联，名称创建后不可修改。密钥值变化后只能扫描受信任编辑器 Skill 目录，并由用户确认后进入内存串行队列；不得保存安装实例或静默改写。
```

Update the Synapse Skill Secrets guide/API reference to state:

- names are immutable;
- the desktop app can scan `.env` associations;
- MCP create/update/upsert changes only the secret store;
- MCP does not trigger file writes;
- `app_secrets_item_update` no longer accepts `newName`.

- [ ] **Step 2: Add release-note copy**

Add one user-facing bullet to `RELEASE_NOTES_PENDING.md`:

```md
- Skill 现在可以用 `.env.example` 声明安装配置；密钥变更后可扫描受影响的已安装 Skill，并确认后按队列逐项更新。资源仓库新增 Skill 开发指南和两段可复制的本地 Agent 提示词。
```

- [ ] **Step 3: Run all focused suites**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/skill-env app-capabilities/secrets src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx src/modules/resource-repository electron/services/__tests__/editor-install-core-installer-source.test.ts electron/services/__tests__/editor-install-service-batch.test.ts electron/services/__tests__/editor-scan-service.test.ts electron/services/__tests__/content-write-service.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run repository-required verification**

```bash
pnpm --filter @synapse/desktop run generate:ipc
pnpm --filter @synapse/desktop run check:ipc-codegen
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run test:ci
git diff --check
```

Expected: every command exits 0; `git diff --check` prints nothing.

- [ ] **Step 5: Perform a sensitive-data regression scan**

Run:

```bash
rg -n "skillEnvValues|scanSkillEnvBindings|queueSkillEnvBindings" desktop/app-capabilities/secrets desktop/electron/services desktop/src/modules/installers
rg -n "newName" desktop/app-capabilities/secrets desktop/app-capabilities/synapse-skill/skill-package/secrets
```

Expected: `skillEnvValues` appears only in install contracts and staging materialization; scan/apply renderer payloads contain ids and names but no values; `newName` has no matches in the Secrets domain or its bundled guide.

- [ ] **Step 6: Commit docs and final verification changes**

```bash
git add AGENTS.md RELEASE_NOTES_PENDING.md desktop/app-capabilities/synapse-skill/skill-package/secrets desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/electron/generated/ipc-channels.generated.ts
git commit -m "docs: document skill env configuration"
```

- [ ] **Step 7: Confirm the worktree is clean**

```bash
git status --short
```

Expected: no output.
