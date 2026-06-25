# IDE Management Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework IDE 管理 so Header remains page navigation, the sidebar remains the selected IDE object list, and the content page places IDE title, filters, and batch actions in a clear right-side toolbar.

**Architecture:** Keep `SystemAppWindowShell` as the only App-level page navigation for `内容 / 目录`. Refactor `EditorScanModule` by extracting small render helpers for the content toolbar and content page shell, without changing scan data, directory data, or Electron bridge contracts. Strengthen the existing editor-scan tests to lock the page hierarchy.

**Tech Stack:** React 19, TypeScript, shadcn/ui Tabs and Button, lucide-react icons, Vitest with jsdom.

---

### Task 1: Lock the Page Hierarchy With Tests

**Files:**
- Modify: `desktop/src/modules/editor-scan/__tests__/editor-scan-module-state.test.tsx`

- [ ] **Step 1: Update the existing shell mock to expose page-level tabs**

Replace the `SystemAppWindowShell` mock with this structure so tests can distinguish Header tabs from page content:

```tsx
vi.mock("@/modules/apps/components/system-app-window-shell", () => ({
  SystemAppWindowShell: ({
    tabs,
    value,
    onValueChange,
    actions,
    children,
  }: {
    readonly tabs: readonly { readonly id: string; readonly label: string }[]
    readonly value: string
    readonly onValueChange: (value: string) => void
    readonly actions?: ReactNode
    readonly children: ReactNode
  }) => (
    <div>
      <nav aria-label="应用页面">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={value === tab.id}
            data-app-tab={tab.id}
            onClick={() => onValueChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        {actions}
      </nav>
      {children}
    </div>
  ),
}))
```

- [ ] **Step 2: Add hierarchy assertions for the content view**

Add this test after `keeps Skill and Rule filters inside the content view`:

```tsx
it("keeps content filters in the selected IDE content toolbar", async () => {
  await renderEditorScanModule(roots)

  const contentPanel = document.querySelector("[data-editor-scan-content-panel]")
  const contentToolbar = document.querySelector("[data-editor-scan-content-toolbar]")

  expect(contentPanel?.textContent).toContain("Cursor")
  expect(contentToolbar?.textContent).toContain("Skill")
  expect(contentToolbar?.textContent).toContain("Rule")
  expect(contentToolbar?.textContent).toContain("全局")
  expect(contentToolbar?.textContent).toContain("项目")
})
```

- [ ] **Step 3: Add hierarchy assertions for the directory view**

Add this test after `hides content filters in the directory view`:

```tsx
it("keeps directory view focused on the selected IDE", async () => {
  await renderEditorScanModule(roots)

  await act(async () => {
    buttonByText("目录")?.click()
    await Promise.resolve()
  })

  const contentPanel = document.querySelector("[data-editor-scan-content-panel]")

  expect(contentPanel?.textContent).toContain("Cursor")
  expect(contentPanel?.textContent).toContain("全局规则")
  expect(contentPanel?.textContent).not.toContain("Skill")
  expect(contentPanel?.textContent).not.toContain("Rule")
})
```

- [ ] **Step 4: Run the focused test and verify it fails before implementation**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/editor-scan/__tests__/editor-scan-module-state.test.tsx
```

Expected: FAIL because `data-editor-scan-content-panel` and `data-editor-scan-content-toolbar` do not exist yet.

### Task 2: Refactor the IDE Management Content Layout

**Files:**
- Modify: `desktop/src/modules/editor-scan/index.tsx`

- [ ] **Step 1: Add a focused content toolbar helper**

Inside `EditorScanModule`, add a `contentToolbar` JSX constant near `headerActions`. It should render the selected IDE title in the first row, batch actions on the right only when skills are selected, and the `Skill / Rule` plus `全局 / 项目` filters in a second row.

```tsx
const contentToolbar = (
  <div data-editor-scan-content-toolbar className="flex shrink-0 flex-col gap-2 px-2 py-2.5">
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-semibold">
        {globalResult?.editorLabel ?? "IDE"}
      </h2>
      {contentTab === "skill" && selectedSkills.length > 0 ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">已选 {selectedSkills.length} 个</span>
          <Button variant="outline" size="sm" onClick={clearSkillSelection}>
            <X data-icon="inline-start" />
            取消选择
          </Button>
          <Button variant="outline" size="sm" onClick={() => setBulkCopyOpen(true)}>
            <Copy data-icon="inline-start" />
            复制到...
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setBulkTrashOpen(true)}>
            <Trash2 data-icon="inline-start" />
            移到废纸篓
          </Button>
        </div>
      ) : null}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Tabs
        value={contentTab}
        onValueChange={(v) => setContentTab(v as ContentTab)}
      >
        <TabsList>
          <TabsTrigger value="skill">Skill</TabsTrigger>
          <TabsTrigger value="rule">Rule</TabsTrigger>
        </TabsList>
      </Tabs>
      <Tabs
        value={scopeTab}
        onValueChange={(v) => setScopeTab(v as ScopeTab)}
      >
        <TabsList>
          <TabsTrigger value="global">全局</TabsTrigger>
          <TabsTrigger value="project">项目</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  </div>
)
```

- [ ] **Step 2: Replace the current content page header block**

In the `appViewTab === "content"` branch, replace the existing top flex wrapper with:

```tsx
<div data-editor-scan-content-panel className="flex h-full flex-col">
  {contentToolbar}
  <div className="min-h-0 flex-1 px-2 pb-2 pt-0">
    {renderContent()}
  </div>
</div>
```

- [ ] **Step 3: Add a directory panel marker**

In the `appViewTab !== "content"` branch, wrap `EditorDirectoriesView` with the same panel marker:

```tsx
<div data-editor-scan-content-panel className="h-full min-h-0">
  <EditorDirectoriesView selectedEditorId={selectedEditorId} />
</div>
```

- [ ] **Step 4: Keep visual rules intact**

Confirm the implementation uses only existing shadcn components and Tailwind token/layout classes. Do not add inline styles, custom colors, CSS modules, new dependencies, or explanatory UI copy.

### Task 3: Verify and Commit the Implementation

**Files:**
- Modify: `desktop/src/modules/editor-scan/__tests__/editor-scan-module-state.test.tsx`
- Modify: `desktop/src/modules/editor-scan/index.tsx`
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add one user-facing bullet under the pending release notes:

```markdown
- 调整了 IDE 管理的页面层级：顶部只负责“内容 / 目录”切换，编辑器选择和内容筛选各归其位，减少误读。
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/editor-scan/__tests__/editor-scan-module-state.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run typecheck if the focused tests pass**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit the implementation**

Run:

```bash
git add desktop/src/modules/editor-scan/index.tsx desktop/src/modules/editor-scan/__tests__/editor-scan-module-state.test.tsx RELEASE_NOTES_PENDING.md
git commit -m "fix: clarify IDE management layout hierarchy"
```

Expected: commit succeeds with only the implementation and release note files staged.
