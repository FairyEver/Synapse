# API 密钥表资源弹窗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 Dashboard 的“密钥的表资源”弹窗改为范围选项 + 表目录/已选资源双栏布局，同时保留现有保存接口、游标分页和跨页选择。

**Architecture:** 继续由 `CloudKeyResourcesDialog` 持有 `mode`、`selected`、`cursor`、`history` 本地状态和现有 React Query 请求。新增仅限本组件的过滤与可见结果批量选择状态；列表项和已选摘要使用 HeroUI `Checkbox`、`Input`、`Button`、`Chip` 组合，不改 `cloudTableApi` 或共享弹窗原语。

**Tech Stack:** React 19、TypeScript、HeroUI v3、TanStack Query、Vitest/jsdom、Tailwind CSS 4。

**Spec:** `docs/superpowers/specs/2026-11-07-api-key-table-resources-dialog-design.md`

## Global Constraints

- 不改变 `cloudTableApi.resources` 的请求形状：`{ mode, tableIds }`。
- `selected` 集合必须保留当前页之外的 ID，并能在当前结果为空时继续移除。
- 不新增依赖，不修改请求层和共享 HeroUI 组件。
- Dashboard 保持浅色主题，使用语义 token 和现有 HeroUI v3 API。

## Review Focus

- 搜索后全选只影响当前可见结果，不清除其它页已选 ID；由 `cloud-key-resources.test.tsx` 覆盖。
- 当前查询为空时仍能渲染并移除不可见已选 ID；由现有回归测试扩展覆盖。
- 切换 `all_owned` 后保存必须传空 `tableIds`，切回 `selected` 后保留本地选择；新增测试覆盖。
- 320px 与 390px 弹窗主体可滚动、底部操作可见、页面无横向溢出；由 Dashboard 浏览器测试或组件布局断言覆盖。
- 保存期间所有选择和关闭操作受控，成功后仍失效 API 密钥列表并关闭；由 mutation 测试覆盖。

### Task 1: 重组 CloudKeyResourcesDialog

**Files:**
- Modify: `dashboard/src/features/cloud-tables/cloud-key-resources.tsx`

**Interfaces:**
- Consumes: `cloudTableApi.list`, `cloudTableApi.resources`, `CloudKeyResources`, `CloudModal`、现有 Dashboard API key 类型。
- Produces: 相同的 `CloudKeyResourcesDialog` props 和相同的保存请求。

- [ ] **Step 1: Add filtered-visible selection helpers**

在组件内增加受控 `query` 状态和 `visibleTables` 派生值；增加只对 `visibleTables` 执行的 `toggleVisible`，使用 `Set` 更新 `selected`，不改 `cursor`、`history` 或接口。

- [ ] **Step 2: Replace the single-column body**

将资源范围改为两个可选卡片；`selected` 模式下渲染搜索框、当前页表目录、当前结果全选、上一页/下一页和右侧已选资源摘要；`all_owned` 模式仅保留范围说明。已选项名称优先从所有已加载页面的缓存快照读取，找不到时显示原始 ID。

- [ ] **Step 3: Preserve mutation and loading/error semantics**

继续使用现有 mutation 形状、成功失效 `dashboard-api-keys`、失败 toast；查询加载/错误状态放在表目录区域，保存 pending 时禁用修改和关闭相关操作。

- [ ] **Step 4: Run typecheck and UI boundary checks**

Run: `pnpm --filter @synapse/dashboard tsc` and `pnpm --filter @synapse/dashboard check:ui`

Expected: both commands pass.

### Task 2: Extend dialog interaction tests

**Files:**
- Modify: `dashboard/src/features/cloud-tables/cloud-key-resources.test.tsx`

**Interfaces:**
- Consumes: `CloudKeyResourcesDialog` public props and `cloudTableApi` mocks.
- Produces: regression coverage for selection, filtering, range switching, and save payloads.

- [ ] **Step 1: Cover current-result bulk selection**

Render multiple pages, filter to a subset, invoke the current-result toggle, move pages, and assert the save payload retains selections from both pages.

- [ ] **Step 2: Cover all-owned payload and selected-mode restoration**

Switch to `自己的全部表`, save and assert `{ mode: 'all_owned', tableIds: [] }`; switch back before saving and assert the previously selected IDs remain.

- [ ] **Step 3: Cover unavailable selected IDs in the summary**

Keep the existing regression that removes an ID absent from the current query and assert the remaining cross-page ID is sent.

- [ ] **Step 4: Run focused tests**

Run: `pnpm --filter @synapse/dashboard test --run dashboard/src/features/cloud-tables/cloud-key-resources.test.tsx`

Expected: all dialog tests pass.

### Task 3: Update pending release notes and verify the diff

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add user-facing release note**

Describe the clearer table-resource selection layout, search/bulk selection, and retained cross-page selections without implementation paths.

- [ ] **Step 2: Run the full minimum verification**

Run: `pnpm --filter @synapse/dashboard test --run`, `pnpm --filter @synapse/dashboard tsc`, and `pnpm --filter @synapse/dashboard check:ui`.

Expected: all commands pass; inspect `git diff` and ensure unrelated existing worktree changes are not staged.

- [ ] **Step 3: Commit only this task's files**

Use a Chinese commit message describing the table-resource dialog redesign and preserved cross-page selection behavior. Do not stage unrelated worktree changes.
