# Skill Uninstaller Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the approved desktop PNG into the Skill Uninstaller capability package and use it as that system app's independent icon.

**Architecture:** Keep the image owned by `desktop/app-capabilities/skill-uninstaller/renderer/` and import it directly from the uninstaller manifest. The shared system-app registry remains unchanged; a registry test prevents future accidental reuse of the installer icon.

**Tech Stack:** TypeScript 6, Vite asset imports, Vitest, PNG.

## Global Constraints

- Move `/Users/liyang/Desktop/skill卸载器.png`; do not leave a desktop copy.
- Store it at `desktop/app-capabilities/skill-uninstaller/renderer/assets/icon.png`.
- Do not modify the Skill Installer icon or any other app icon.
- Do not edit the PNG contents, dimensions, or colors.
- Do not add dependencies or start a dev server.

---

## File Structure

- Create by moving: `desktop/app-capabilities/skill-uninstaller/renderer/assets/icon.png` — Skill Uninstaller-owned icon asset.
- Modify: `desktop/app-capabilities/skill-uninstaller/renderer/app-manifest.ts` — import the capability-local icon.
- Modify: `desktop/src/modules/apps/__tests__/registry.test.ts` — assert installer and uninstaller icons differ.
- Modify: `RELEASE_NOTES_PENDING.md` — record the user-visible icon change.

### Task 1: Use The Independent Skill Uninstaller Icon

**Files:**
- Create by moving: `desktop/app-capabilities/skill-uninstaller/renderer/assets/icon.png`
- Modify: `desktop/app-capabilities/skill-uninstaller/renderer/app-manifest.ts`
- Modify: `desktop/src/modules/apps/__tests__/registry.test.ts`
- Modify: `RELEASE_NOTES_PENDING.md`

**Interfaces:**
- Consumes: Vite PNG imports and `getSystemAppManifest(appId)`.
- Produces: `skillUninstallerAppManifest.icon` backed by the capability-local PNG.

- [ ] **Step 1: Write the failing registry test**

Add this case to `desktop/src/modules/apps/__tests__/registry.test.ts`:

```ts
it("uses a distinct icon for the Skill uninstaller", () => {
  expect(getSystemAppManifest("skill-uninstaller").icon)
    .not.toBe(getSystemAppManifest("skill-installer").icon)
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/apps/__tests__/registry.test.ts
```

Expected: FAIL because both manifests currently import `src/modules/installers/assets/icon.png`.

- [ ] **Step 3: Move the PNG into the capability package**

Create the destination directory and move the exact source file:

```bash
mkdir -p desktop/app-capabilities/skill-uninstaller/renderer/assets
mv /Users/liyang/Desktop/skill卸载器.png \
  desktop/app-capabilities/skill-uninstaller/renderer/assets/icon.png
```

Verify the moved file without transforming it:

```bash
file desktop/app-capabilities/skill-uninstaller/renderer/assets/icon.png
```

Expected: `PNG image data, 256 x 256, 8-bit/color RGBA, non-interlaced`.

- [ ] **Step 4: Point the manifest at the local asset**

Replace the icon import in `desktop/app-capabilities/skill-uninstaller/renderer/app-manifest.ts` with:

```ts
import icon from "./assets/icon.png"
```

Keep the manifest object unchanged.

- [ ] **Step 5: Add the release note**

Add one concise bullet under the current release notes section in `RELEASE_NOTES_PENDING.md`:

```markdown
- Skill 卸载器现在使用独立图标，与 Skill 安装器更容易区分。
```

- [ ] **Step 6: Run focused verification and verify GREEN**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  src/modules/apps/__tests__/registry.test.ts \
  src/modules/apps/__tests__/system-app-window-app.test.tsx \
  src/modules/apps/__tests__/system-app-content-launcher.test.tsx
pnpm --filter @synapse/desktop run typecheck
git diff --check
test ! -e /Users/liyang/Desktop/skill卸载器.png
test -f desktop/app-capabilities/skill-uninstaller/renderer/assets/icon.png
```

Expected: all commands exit 0, the desktop source is absent, and the repository asset exists.

- [ ] **Step 7: Commit**

```bash
git add \
  desktop/app-capabilities/skill-uninstaller/renderer/assets/icon.png \
  desktop/app-capabilities/skill-uninstaller/renderer/app-manifest.ts \
  desktop/src/modules/apps/__tests__/registry.test.ts \
  RELEASE_NOTES_PENDING.md
git commit -m "feat: add skill uninstaller icon"
```
