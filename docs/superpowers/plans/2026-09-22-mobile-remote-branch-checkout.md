# 手机端终端 · 迁出远端分支 · 实施计划

> 权威设计见 `docs/superpowers/specs/2026-09-22-mobile-remote-branch-checkout-design.md`。
> **决策、非目标、验收基线都以它为准**，本文件只回答「分几步做、每步改哪、怎么验」。
> 每个阶段结束都要能单独验证。阶段完成就提交，只提交本阶段的文件。
> 文档里的行号是写它的那天（2026-09-22）核过的，实施时会漂移 —— **先核对再动手**。

## 总览

| 阶段 | 内容 | 主要文件 |
|---|---|---|
| 0 | 开工前核对 | — |
| 1 | 协议：三个新动作、`remote`/`localBranch`、`remoteBranches`、`localBranchName` | `shared/src/` |
| 2 | 电脑端：按目录跑 git 的那一层 | `electron/services/terminal-git/` |
| 3 | 电脑端：mobile-gateway 分派与结果信封 | `electron/services/mobile-gateway/` |
| 4 | 手机端：协议镜像 + `TerminalGitFlow` | `LiveProtocol.swift`、`Features/Terminal/Git/` |
| 5 | 手机端：面板那一行、远端列表页、填本地名那一页 | `Features/Terminal/Git/` |
| 6 | 夹具、UI 走查、改掉旧说法、发布说明 | `SynapseMobile/scripts/`、`docs/` |

**阶段 1 必须最先。** 阶段 2、3 都依赖它，阶段 4 依赖 3。阶段 2 与 3 之间没有依赖，可以换序。

---

## 升级顺序（贯穿全程的硬约束）

新的 `action` 值会被**三道**校验拦：服务端与电脑端都用同一份 `isMobileGitAction`。其中
**服务端那一道不是丢弃，是 `socket.close(1003, "invalid_message")`**（`mobile-live.gateway.ts:260-263`）
—— 用户看到的是终端掉线，几秒后自动重连。

所以真正上线时：**服务端 → 桌面端 → 手机端，一步都不能颠倒**
（与 `docs/superpowers/plans/2026-09-21-mobile-terminal-git.md` 的「升级顺序」一节同一条）。
阶段 1 改完 `shared/` 之后，**把它单独部署一次**再往下走。

---

## 阶段 0 · 开工前的核对

- [ ] 读设计文档 §2「现状」，逐条在代码里核对。**§2.2、§2.3、§2.5 是决定方案形态的，必须亲自确认。**
- [ ] `pnpm --filter @synapse/desktop run check:hard-constraints` 先跑一遍，确认基线是绿的。
- [ ] 确认 Terminal MCP 工具数量基线（`pnpm --filter @synapse/desktop run check:terminal-runtime`），收尾时要还是它。
- [ ] 确认这四件事**一件都不做**：不注册 MCP capability/tool、不注册 System App/Dock/Workflow Node/
      Automation Action/Deep Link、不碰 `app.git.*` 既有 IPC 面、不产生「代码仓库」条目。
- [ ] 确认 `MOBILE_PROTOCOL_VERSION` 还是 `1`，本轮的改动**一个字都不动它**。
- [ ] 确认失败弹窗挂在哪：`TerminalGitPanel.swift:35` 的 `TerminalGitFailureAlert` 挂在**面板**上
      —— 这一条决定了填本地名必须是一页而不是一张表（设计文档 §4.3）。

---

## 阶段 1 · 协议（shared）

### 产物

`shared/src/mobile-live.ts`：

- `MobileGitAction` 加三个值：

```ts
export type MobileGitAction =
  | "status" | "branches" | "checkout" | "createBranch"
  | "commit" | "push" | "sync" | "merge"
  | "remoteBranches" | "fetchRemotes" | "checkoutRemote"
```

- intent 信封（`MobileIntent` 的 git 分支，现约 `:1037-1049`）加两个字段：

```ts
  /** checkoutRemote 的对象：远端名（`origin`）。远端名本身可以含 `/`。 */
  readonly remote?: string
  /** checkoutRemote 的另一个本地名。缺席＝与远端分支同名。 */
  readonly localBranch?: string
```

- 结果信封的 `git`（现约 `:1108-1115`）加一块，并把 `needsDecision` 的取值放开：

```ts
  readonly git?: {
    /** `branches` 的回答。只给名字与是否当前，手机端不需要更多。 */
    readonly branches?: readonly MobileGitBranch[]
    /** `remoteBranches` 的回答。平铺 + 已排序；分组是手机端的事。 */
    readonly remoteBranches?: readonly MobileGitRemoteBranch[]
    readonly conflict?: MobileGitConflict
    /**
     * 要用户先给个东西，值说明是哪样东西：
     * `dirty` = 选一个走法（三选一）；`localBranchName` = 填一个名字（推一页）。
     */
    readonly needsDecision?: "dirty" | "localBranchName"
  }
```

- 新类型，放在 `MobileGitBranch` 旁边：

```ts
/**
 * 一条远端分支。
 *
 * 分成两段而不是拼好的 `origin/dev`：手机端要靠 `remote` 分组，而拿了拼字符串再拆回来
 * 是个必然会写错的一步。拼给人看的那一份由手机端拼（`qualifiedName`）。
 */
export interface MobileGitRemoteBranch {
  readonly remote: string
  readonly name: string
}
```

- 三处校验跟着改：
  - `isMobileGitAction`（`:1492`）：加上三个新值。
  - `isMobileIntent`（`:1360` 起）：`remote` 与 `localBranch` 用 `boundedString(..., maxGitRefNameLength)` 校验。
  - `isMobileIntentGitResult`（`:1460`）：
    - `remoteBranches` 走 `boundedArray(..., maxGitBranches)` + 每一项 `isMobileGitRemoteBranch`；
    - `needsDecision` 从 `!== "dirty"` 改成 `!== "dirty" && !== "localBranchName"`；
    - 那段「三个字段各自独立」的注释改成**四个**，并把 `localBranchName` 的语义写进去。
  - 新增 `isMobileGitRemoteBranch`：两个字段都 `boundedString(..., maxGitRefNameLength)`。

### 关键约束

- **复用 `maxGitBranches`（512），不新造常量。** 远端列表与本地列表是同一类东西、走同一条
  套接字，上界没理由不同；产生端的截断由阶段 3 做（设计文档 §5.2）。
- **`MOBILE_PROTOCOL_VERSION` 不动。** 它是严格相等校验，动一下手机与电脑之间所有帧全废。
- 校验只用文件里已有的 `boundedString` / `boundedArray` 那一套，不引入新写法。
- **字段一旦定下来，阶段 2/3/4 都只是镜像。** 如果到阶段 4 才发现要改字段，回到这里改，
  连测试一起改，不要只改手机端那一份。

### 涉及文件

- `shared/src/mobile-live.ts`
- `shared/src/mobile-live.test.ts`（现成的 git 用例块在 `:1026-1053`）
- `shared/src/mobile-live-constants.cjs`（只在注释里说明 `maxGitBranches` 同时管两个列表 —— 值不改）

### 验证

新增测试（都进 `mobile-live.test.ts` 那个 `describe` 里，命名照现有 `isMobileIntent(...)` 的写法）：

```ts
it("接受三个新动作", () => {
  const base = { v: MOBILE_PROTOCOL_VERSION, intentId: "i1", kind: "git", sessionId: "sess-1" }
  expect(isMobileIntent({ ...base, action: "remoteBranches" })).toBe(true)
  expect(isMobileIntent({ ...base, action: "fetchRemotes" })).toBe(true)
  expect(isMobileIntent({ ...base, action: "checkoutRemote", remote: "origin", branch: "dev" })).toBe(true)
  expect(isMobileIntent({
    ...base, action: "checkoutRemote", remote: "origin", branch: "dev", localBranch: "dev-copy",
  })).toBe(true)
})

it("拒绝越界的远端名与本地名", () => {
  const base = { v: MOBILE_PROTOCOL_VERSION, intentId: "i1", kind: "git", sessionId: "sess-1" }
  expect(isMobileIntent({ ...base, action: "checkoutRemote", branch: "dev", remote: "x".repeat(256) })).toBe(false)
  expect(isMobileIntent({
    ...base, action: "checkoutRemote", remote: "origin", branch: "dev", localBranch: "x".repeat(256),
  })).toBe(false)
})

it("远端分支列表：接受 {remote,name}，拒绝超量与非字符串", () => {
  const ok = { git: { remoteBranches: [{ remote: "origin", name: "dev" }] } }
  expect(isMobileIntentGitResult(ok)).toBe(true)
  expect(isMobileIntentGitResult({ git: { remoteBranches: [{ remote: "origin" }] } })).toBe(false)
  expect(isMobileIntentGitResult({
    git: { remoteBranches: Array.from({ length: 513 }, (_, i) => ({ remote: "origin", name: `b${i}` })) },
  })).toBe(false)
})

it("needsDecision 认两个值，其余拒掉", () => {
  expect(isMobileIntentGitResult({ git: { needsDecision: "localBranchName" } })).toBe(true)
  expect(isMobileIntentGitResult({ git: { needsDecision: "somethingElse" } })).toBe(false)
})
```

`isMobileIntentGitResult` 是模块私有函数 —— 若没导出就**导出它**（同文件内的测试要用），
不要为了测试把它复制一份。

```bash
pnpm --filter @synapse/shared run test
```

---

## 阶段 2 · 电脑端：按目录跑 git 的那一层

### 产物

`desktop/electron/services/terminal-git/terminal-git-types.ts`：

```ts
/**
 * 一条远端分支。远端与分支分成两段：`refs/remotes/<remote>/<name>` 里的 `<remote>`
 * 本身可以含 `/`（`team/fork`），所以拆开这件事只能由**按 `git remote` 最长前缀匹配**
 * 的那一处做，下游拿到的就是两段明确的值。
 */
export type TerminalGitRemoteBranch = {
  readonly remote: string
  readonly name: string
}
```

并把 `TerminalGitFailure.needsDecision` 放宽：

```ts
  /**
   * 要用户先给个东西。
   * `dirty` = 有未提交改动，先选一个走法；`localBranchName` = 迁出时同名本地分支不能直接用，要另一个名字。
   */
  readonly needsDecision?: "dirty" | "localBranchName"
```

`terminal-git-status.ts` 新增 `listRemoteBranches`，并加进 `TerminalGitStatusReader` 的导出面：

```ts
  /**
   * 列远端分支。**只读本地缓存的 `refs/remotes`，一行网络命令都不跑**
   * （设计文档决策二）。要最新的话由 `fetchRemotes` 负责，那是另一个动作。
   */
  async function listRemoteBranches(cwd: string): Promise<readonly TerminalGitRemoteBranch[]> {
    const [remotes, refs] = await Promise.all([
      deps.commandRunner.run({
        cwd,
        args: ["remote"],
        operation: "terminal-git.remote-branch.remotes",
        repoPath: cwd,
      }),
      deps.commandRunner.run({
        cwd,
        args: ["for-each-ref", "--format=%(refname:strip=2)%00%(symref)", "refs/remotes"],
        operation: "terminal-git.remote-branch.list",
        repoPath: cwd,
      }),
    ])
    // 最长前缀优先：`team/fork` 必须先于 `team` 命中，否则 `team/fork/x` 会被拆成
    // remote=`team`、name=`fork/x`。规则与桌面端 `git-branch-service.ts:213` 逐字一致。
    const remoteNames = remotes.stdout.split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
      .sort((left, right) => right.length - left.length)
    const branches: TerminalGitRemoteBranch[] = []
    for (const line of refs.stdout.split(/\r?\n/)) {
      const [fullName = "", symbolicTarget = ""] = line.split("\0")
      // 符号引用（`origin/HEAD -> origin/main`）与 `*/HEAD` 都不是一条分支。
      if (!fullName || symbolicTarget || fullName.endsWith("/HEAD")) continue
      const remote = remoteNames.find((candidate) => fullName.startsWith(`${candidate}/`))
      if (!remote) continue
      const name = fullName.slice(remote.length + 1)
      if (!name) continue
      branches.push({ remote, name })
    }
    return branches.sort((left, right) =>
      left.remote === right.remote
        ? left.name.localeCompare(right.name)
        : left.remote.localeCompare(right.remote))
  }
```

`terminal-git-workflow.ts` 新增两个动作，并加进 `TerminalGitWorkflow` 的类型：

```ts
  /**
   * 同步远端引用。**只 fetch，不碰本地分支、不 merge、不 push** —— 它服务的是
   * 「远端分支列表要最新的」这一件事，与「同步」（拉+推）不是同一件事。
   *
   * 无远端时 `fetch --all --prune` 退出码 0、不报错（实测），所以这里不预先拦。
   */
  async function fetchRemotes(input: { readonly cwd: string }): Promise<TerminalGitOutcome<TerminalGitSnapshot>> {
    const required = await requireRepository(input.cwd)
    if ("rejected" in required) return required.rejected
    await run({
      cwd: input.cwd,
      args: ["fetch", "--all", "--prune"],
      operation: "terminal-git.remote-branch.fetch",
      timeoutMs: TERMINAL_GIT_REMOTE_TIMEOUT_MS,
    })
    return success(await deps.status.getSnapshot(input.cwd))
  }

  /**
   * 迁出一条远端分支：建一条跟踪它的本地分支并切过去，或者切到已有的同名分支。
   *
   * 与 `checkout` 的三条同款规矩：**已经在这条分支上就什么都不做**（带 `-f` 的一条会
   * 把改动丢掉却什么也没换到）、**脏工作区不替用户决定**、**丢弃只丢已跟踪文件的修改**。
   */
  async function checkoutRemote(input: {
    readonly cwd: string
    readonly remote: string
    readonly branch: string
    /** 用户点名的另一个本地名；缺席＝与远端分支同名。 */
    readonly localBranch?: string
    readonly discardChanges?: boolean
  }): Promise<TerminalGitOutcome<TerminalGitSnapshot>> {
    const required = await requireRepository(input.cwd)
    if ("rejected" in required) return required.rejected
    const { snapshot } = required

    const remote = input.remote.trim()
    if (!remote) return failure("没有指定远端。")
    const remotes = await deps.commandRunner.run({
      cwd: input.cwd,
      args: ["remote"],
      operation: "terminal-git.checkout-remote.remotes",
      repoPath: input.cwd,
    })
    if (!remotes.stdout.split(/\r?\n/).map((value) => value.trim()).includes(remote)) {
      return failure(`远端不存在：${remote}。`)
    }

    const branch = await deps.validateBranchName(input.cwd, input.branch)
    if (!branch) return failure(`分支名称不合法：${input.branch}`)
    const remoteBranch = `${remote}/${branch}`
    const remoteRef = await deps.commandRunner.run({
      cwd: input.cwd,
      args: ["rev-parse", "--verify", "--quiet", `refs/remotes/${remoteBranch}`],
      acceptedExitCodes: [0, 1],
      operation: "terminal-git.checkout-remote.verify",
      repoPath: input.cwd,
    })
    if (!remoteRef.stdout.trim()) return failure(`远端分支不存在：${remoteBranch}。下拉刷新之后再试。`)

    /*
     * 这一步是「要哪个本地名」的全部。回 `localBranchName` 就是请手机推一页让用户填一个，
     * 而不是报一个错 —— 它不是失败，是一个问题（设计文档决策四）。
     */
    const wanted = input.localBranch === undefined ? branch : input.localBranch.trim()
    const wantedName = await deps.validateBranchName(input.cwd, wanted)
    if (!wantedName) return failure(`分支名称不合法：${wanted}`, { needsDecision: "localBranchName" })
    const localRef = await deps.commandRunner.run({
      cwd: input.cwd,
      args: ["rev-parse", "--verify", "--quiet", `refs/heads/${wantedName}`],
      acceptedExitCodes: [0, 1],
      operation: "terminal-git.checkout-remote.local",
      repoPath: input.cwd,
    })
    const localExists = Boolean(localRef.stdout.trim())
    if (input.localBranch !== undefined) {
      // 用户点名的那个名字必须是一条**新**分支：重名就再问一个。
      if (localExists) {
        return failure(`本地已有 ${wantedName}，换一个名字。`, { needsDecision: "localBranchName" })
      }
    } else if (localExists) {
      // 同名分支已存在：只有它跟踪的正是这条远端分支时，才可以「就是它」。
      const upstream = await deps.commandRunner.run({
        cwd: input.cwd,
        args: ["for-each-ref", "--format=%(upstream:short)", `refs/heads/${wantedName}`],
        operation: "terminal-git.checkout-remote.upstream",
        repoPath: input.cwd,
      })
      const tracking = upstream.stdout.trim()
      if (tracking !== remoteBranch) {
        return failure(
          tracking ? `本地已有 ${wantedName}，它跟踪的是 ${tracking}。` : `本地已有 ${wantedName}，它没有上游。`,
          { needsDecision: "localBranchName" },
        )
      }
    }

    // 已经在这条分支上：什么都不做，也不许走丢弃那条路（同 `checkout:89`）。
    if (localExists && wantedName === snapshot.branch) {
      return success(snapshot, `已经在 ${wantedName} 上，没有做任何操作。`)
    }

    if (!input.discardChanges) {
      const dirty = dirtyDecision(snapshot)
      if (dirty) return dirty
    }

    await run({
      cwd: input.cwd,
      // 新建那条必须显式 `--track`：绝不能依赖 DWIM（设计文档 §2.3 那个陷阱）。
      // 丢弃那条不带 `--no-overwrite-ignore` —— 与既有 `checkout -f` 逐字一致。
      args: localExists
        ? (input.discardChanges
            ? ["checkout", "-f", wantedName]
            : ["checkout", "--no-overwrite-ignore", wantedName])
        : (input.discardChanges
            ? ["checkout", "-f", "--no-overwrite-ignore", "-b", wantedName, "--track", remoteBranch]
            : ["checkout", "--no-overwrite-ignore", "-b", wantedName, "--track", remoteBranch]),
      operation: localExists ? "terminal-git.checkout-remote.switch" : "terminal-git.checkout-remote.create",
    })
    /*
     * 成功那句话由**电脑**说：它才解析得出最终用的是哪个本地名（可能不是手机猜的那个）。
     * 手机那侧的 success 文案只是兜底（`finish` 用 `message ?? success`）。
     */
    return success(
      await deps.status.getSnapshot(input.cwd),
      localExists ? `已切换到 ${wantedName}。` : `已迁出 ${remoteBranch} 到 ${wantedName}。`,
    )
  }
```

`terminal-git-service.ts` 把四个新面接出去（`listRemoteBranches` 走 status reader，另两个走 workflow）。

### 关键约束

- **`listRemoteBranches` 里一条网络命令都不许有。** 打开列表是纯读缓存（设计文档决策二）。
- 远端名匹配**必须最长前缀优先**，否则含 `/` 的远端名会被拆错。
- 远端名与分支名各自都过一遍校验：远端名要在 `git remote` 里，分支名要过 `check-ref-format`。
- 新建本地分支**必须显式 `--track`**，这是设计文档 §2.3 那个静默分叉陷阱的唯一防线。
- `needsDecision: "localBranchName"` 走 `failure(...)` 的第二个参数（`terminal-git-types.ts:94`
  的 `extra`），不要新开一个结果形状。

### 涉及文件

- `desktop/electron/services/terminal-git/terminal-git-types.ts`
- `desktop/electron/services/terminal-git/terminal-git-status.ts`
- `desktop/electron/services/terminal-git/terminal-git-workflow.ts`
- `desktop/electron/services/terminal-git/terminal-git-service.ts`
- `desktop/electron/services/terminal-git/__tests__/terminal-git-service.test.ts`

### 验证

用例跑**真实的 git**（`mkdtemp` + `git init` + 一个裸远端），不 mock —— 沿用该文件现有的
`createRepository` / `createBareRemote` / `recordingRunner` 三个夹具。夹具部分：

```ts
/** 一个有远端的仓库：`main` 跟踪 `origin/main`；`origin/only-remote` 只有远端有。 */
async function createRepositoryWithRemote(): Promise<{ repo: string; remoteUrl: string }> {
  const bare = await createBareRemote()
  const repo = await createRepository()
  git(repo, ["remote", "add", "origin", bare])
  git(repo, ["push", "-q", "-u", "origin", "main"])
  // 远端有、本地没有：建一条、推上去、删掉本地那条（`refs/remotes/origin/only-remote` 留下）。
  git(repo, ["checkout", "-qb", "only-remote"])
  await writeFile(path.join(repo, "remote.txt"), "from remote\n", "utf8")
  git(repo, ["add", "-A"])
  git(repo, ["commit", "-qm", "remote only"])
  git(repo, ["push", "-q", "-u", "origin", "only-remote"])
  git(repo, ["checkout", "-q", "main"])
  git(repo, ["branch", "-D", "only-remote"])
  return { repo, remoteUrl: bare }
}
```

要断言的行为（每条一个 `it`，中文命名照该文件现有风格）：

1. 列远端分支：`main` 与 `only-remote` 都在，`remote` 都是 `origin`，`name` 是短名，**没有 `HEAD`**。
2. 排序：远端名升序、组内分支名升序。
3. **最长前缀**：同时挂 `team` 与 `team/fork` 两个远端指向同一个裸仓库，两个都 fetch →
   `refs/remotes/team/main` 与 `refs/remotes/team/fork/main` 都在，且后者的拆法是
   `remote="team/fork"`、`name="main"`。**不这样摆就测不出最长前缀** —— 只有 `team/fork`
   一个远端时，随便哪种匹配都能对上。
4. 迁出只有远端有的那条：本地出现同名分支，**上游正是 `origin/only-remote`**，工作区里
   有远端那个文件（`remote.txt`）—— 这一条同时钉住「不是从当前 HEAD 起的」。
5. 迁出已存在且跟踪该远端的同名分支（先在 `main` 上，点 `origin/main`）→ 切到 `main`，**不新建**。
6. 已经在 `main` 上时迁出 `origin/main` → `ok: true`，`message` 是「已经在 main 上，没有做任何操作。」，
   且**没有跑任何 checkout 命令**（用 `recordingRunner().commands` 断言）。
7. 同名本地分支存在但没上游（`git branch taken`）→ 迁出 `origin/taken` 回
   `ok: false` + `needsDecision: "localBranchName"`，工作区不变。
8. 点名一个已被占用的 `localBranch` → 同样回 `localBranchName` + 「换一个名字」。
9. 点名一个非法 `localBranch`（`"a b"`）→ 回 `localBranchName` + 「分支名称不合法」。
10. 脏工作区 → 回 `needsDecision: "dirty"`，**一行 checkout 都没跑**。
11. 脏工作区 + `discardChanges: true` → 改动没了、分支建好并跟踪，**未跟踪文件还在**。
12. 远端名不存在（`remote: "nope"`）→ 失败，且消息里点名那个远端。
13. `fetchRemotes` 之后 `refs/remotes` 里有新推上去的分支（先 `git push` 一条再调它）。
14. 无远端时 `fetchRemotes` 不报错（`ok: true`）。

```bash
pnpm --filter @synapse/shared run build
pnpm --filter @synapse/desktop exec vitest run electron/services/terminal-git
```

---

## 阶段 3 · 电脑端：mobile-gateway 分派

### 产物

`desktop/electron/services/mobile-gateway/git-intent.ts`：

- `MobileGitIntentRequest` 加两个字段：

```ts
  /** checkoutRemote 的远端名。远端名本身可以含 `/`。 */
  readonly remote?: string
  /** checkoutRemote 的另一个本地名；缺席＝与远端分支同名。 */
  readonly localBranch?: string
```

- 参数核对多一个 `remote`：

```ts
  /**
   * 只有 `checkoutRemote` 要远端名。它与 `branch` 一样是「缺了就走不下去」的那一类，
   * 所以走同一个 `required`（先核参数、再碰仓库，与 `branch` 那条同一条理由）。
   */
  function needsRemote(action: MobileGitAction): boolean {
    return action === "checkoutRemote"
  }
```

  在 `needsBranch` 旁边：

```ts
    const branch = needsBranch(action) ? required(request.branch, "要操作的分支") : ""
    const remote = needsRemote(action) ? required(request.remote, "远端") : ""
```

- 鉴权那一行加 `remoteBranches`（它是**读**）：

```ts
    if (action === "status" || action === "branches" || action === "remoteBranches") {
      await deps.authorize("terminal.state.read", sessionResource(request.sessionId))
    } else {
      await deps.authorize("terminal.git.manage", sessionResource(request.sessionId))
    }
```

- 三个新 case：

```ts
      case "remoteBranches": {
        const branches = await deps.terminalGit.listRemoteBranches(cwd)
        /*
         * 超过上界就**在产生端截断**：校验器（`isMobileIntentGitResult`）那边是
         * `boundedArray(..., maxGitBranches)`，超了整条结果被判非法、结果被丢，
         * 手机上表现为「电脑一直没有回答」—— 比少列几条糟得多。
         * 截了一条就要说一句：不说的截断等于骗人。
         */
        const listed = branches.slice(0, MOBILE_FRAME_LIMITS.maxGitBranches)
        return {
          outcome: "accepted",
          git: { remoteBranches: listed.map(toWireRemoteBranch) },
          ...(branches.length > listed.length
            ? { message: `远端分支过多，只列出了前 ${MOBILE_FRAME_LIMITS.maxGitBranches} 条。` }
            : {}),
        }
      }

      case "fetchRemotes":
        return fromOutcome(await deps.terminalGit.fetchRemotes({ cwd }), true)

      case "checkoutRemote":
        return fromOutcome(await deps.terminalGit.checkoutRemote({
          cwd,
          remote,
          branch,
          ...(request.localBranch === undefined ? {} : { localBranch: request.localBranch }),
          ...(request.discardChanges === true ? { discardChanges: true } : {}),
        }), true)
```

- `fromOutcome` 把 `needsDecision` **原样透传**，并把新取值翻成一个手机能分辨的 code：

```ts
  if (outcome.needsDecision) git.needsDecision = outcome.needsDecision
  ...
    code: outcome.needsDecision === "dirty"
      ? "dirty_working_tree"
      : outcome.needsDecision === "localBranchName"
        ? "local_branch_conflict"
        : outcome.conflict ? "merge_conflict" : "git_failed",
```

- 新增线上映射（挨着 `toWireBranch`）：

```ts
/** 远端分支名两段都是 ref 名，按同一个上界收。 */
function toWireRemoteBranch(branch: {
  readonly remote: string
  readonly name: string
}): MobileGitRemoteBranch {
  return {
    remote: clamp(branch.remote, MOBILE_FRAME_LIMITS.maxGitRefNameLength),
    name: clamp(branch.name, MOBILE_FRAME_LIMITS.maxGitRefNameLength),
  }
}
```

- `MobileGitIntentOutcome["git"]` 的类型加上 `remoteBranches`（它是 `NonNullable<MobileIntentResult["git"]>`，所以阶段 1 改完自动就有 —— 核对一下即可）。

`desktop/electron/services/mobile-gateway/intent-executor.ts:580-590` —— **本阶段最容易漏的一格**：
那一段是**逐字段显式挑过去**的，新字段不加在这儿就是静默丢失。

```ts
          ...(intent.remote === undefined ? {} : { remote: intent.remote }),
          ...(intent.localBranch === undefined ? {} : { localBranch: intent.localBranch }),
```

### 关键约束

- 新动作**不新增权限名**：读的走 `terminal.state.read`，联网与写的走 `terminal.git.manage`。
- `needsDecision` 必须**透传原值**，不能像现在这样写死 `"dirty"` —— 手机靠它分「弹三选一」与
  「推一页填名字」。
- 截断只发生在产生端；校验器那边不动（它是第二道守卫）。
- 不碰 `app.git.*` IPC 面，不碰「代码仓库」注册表。

### 涉及文件

- `desktop/electron/services/mobile-gateway/git-intent.ts`
- `desktop/electron/services/mobile-gateway/intent-executor.ts`
- `desktop/electron/services/mobile-gateway/__tests__/`（现有 `git-intent` 用例文件里补；没有就照同目录其它 intent 用例的形状新建）

### 验证

- `remoteBranches` 走 `terminal.state.read`、另两个走 `terminal.git.manage`（用假的 `authorize` 记账断言）。
- `checkoutRemote` 缺 `remote` → `invalid_argument`，且**一行 git 都没跑**。
- `remoteBranches` 超过 512 条 → 结果里恰好 512 条、且带那句说明。
- `needsDecision: "localBranchName"` → `outcome: "rejected"` + `code: "local_branch_conflict"`
  + `git.needsDecision === "localBranchName"`（**不是** `"dirty"`）。
- `intent-executor` 那一段：发一个带 `remote`/`localBranch` 的 intent，断言 `runGitIntent`
  收到的参数里有这两个值（**漏加 spread 的那一格只有这条能抓到**）。

```bash
pnpm --filter @synapse/shared run build
pnpm --filter @synapse/desktop exec vitest run electron/services/mobile-gateway
pnpm --filter @synapse/desktop run typecheck
```

---

## 阶段 4 · 手机端：协议镜像 + `TerminalGitFlow`

### 产物

`SynapseMobile/SynapseMobile/Core/Protocol/LiveProtocol.swift`：

- `MobileIntentRequest`（`:860` 附近）加两个字段：

```swift
    /// `checkoutRemote` 的远端名。远端名本身可以含 `/`。
    var remote: String?
    /// `checkoutRemote` 的另一个本地名；缺席＝与远端分支同名。
    var localBranch: String?
```

- `MobileIntentGitResult`（`:484`）加一块、放宽一处（都是 `let`，**三处构造点要一起改**）：

```swift
    /// `remoteBranches` 的回答：平铺 + 已按「远端名 → 分支名」排序。
    let remoteBranches: [MobileGitRemoteBranch]?
    /// 要用户先给个东西：`dirty` = 选一个走法；`localBranchName` = 填一个名字。
    let needsDecision: String?
```

- 新类型（挨着 `MobileGitBranch`）：

```swift
/// 一条远端分支。
///
/// 与电脑端分成两段而不是拼好的 `origin/dev`：分组要靠 `remote`，而拿拼字符串再拆回来
/// 是个必然会写错的一步。给人看的那一份由 `qualifiedName` 拼。
struct MobileGitRemoteBranch: Decodable, Equatable, Identifiable {
    let remote: String
    let name: String

    var qualifiedName: String { "\(remote)/\(name)" }
    var id: String { qualifiedName }
}
```

`Features/Terminal/Git/TerminalGitPresentation.swift` 加两个纯函数：

```swift
    // MARK: - 远端分支的分组与搜索

    /// 按远端切段。**不重排**：顺序由电脑给（远端名 → 分支名），手机只负责切开 ——
    /// 手机再排一次就是第二份排序规则，两份迟早会分叉。
    static func remoteBranchGroups(_ branches: [MobileGitRemoteBranch]) -> [TerminalGitRemoteBranchGroup] {
        var groups: [TerminalGitRemoteBranchGroup] = []
        for branch in branches {
            if let last = groups.indices.last, groups[last].remote == branch.remote {
                groups[last].branches.append(branch)
            } else {
                groups.append(TerminalGitRemoteBranchGroup(remote: branch.remote, branches: [branch]))
            }
        }
        return groups
    }

    /// 名字命中的远端分支。空查询就是全部。
    ///
    /// 匹配**限定名**：用户打 `origin/dev` 或 `dev` 都能命中 —— 远端列表里那一行写的就是
    /// 限定名，他照着屏幕打什么就该中什么。
    static func matchingRemoteBranches(_ branches: [MobileGitRemoteBranch], query: String) -> [MobileGitRemoteBranch] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return branches }
        return branches.filter { $0.qualifiedName.localizedCaseInsensitiveContains(trimmed) }
    }
```

同一个文件里加上这个小组件类型：

```swift
/// 远端列表里的一段：一个远端，和它下面那几条。
struct TerminalGitRemoteBranchGroup: Identifiable, Equatable {
    let remote: String
    var branches: [MobileGitRemoteBranch]

    var id: String { remote }
}
```

`Features/Terminal/Git/TerminalGitFlow.swift`：

- `Route` 加两页：

```swift
        /// 远端分支列表。
        case remoteBranches
        /// 同名本地分支不能直接用，要另一个名字。
        case remoteLocalName
```

- `TerminalGitPendingSwitch` 加一条，且**这一次「丢弃」成立**：

```swift
    /// 迁出这条远端分支（`localBranch` 缺席＝建同名分支）。
    case checkoutRemote(remote: String, branch: String, localBranch: String?)
```

  `id` 加一支 `"checkoutRemote:\(remote)/\(branch):\(localBranch ?? "")"`；
  `canDiscardChanges` 改成对 `.checkout` 与 `.checkoutRemote` 都返回 `true`
  （理由见设计文档决策五：git 有 `checkout -f -b --track` 这条原语，而同一个分支
  从「分支」行进来有三个选项、从远端列表进来只有两个，说不通）。

- 新状态：

```swift
    // MARK: 远端分支

    var remoteBranches: [MobileGitRemoteBranch] = []
    var remoteBranchQuery = ""
    var isLoadingRemoteBranches = false
    /// 重名时要另一个本地名：这一页为什么在问（电脑原话）与用户打的字。
    /// 名字存在 flow 上而不是视图里 —— 失败之后这一页要留着，字也要留着。
    var localNamePrompt: TerminalGitLocalNamePrompt?
```

  以及那个小结构（放在 flow 文件里，与它的持有者同文件）：

```swift
/// 填另一个本地名那一页要的全部东西。
struct TerminalGitLocalNamePrompt: Identifiable, Equatable {
    let remote: String
    let branch: String
    /// **电脑给的原话**：这一页为什么在问。不改写、不翻译。
    let message: String
    /// 用户打的字。默认空 —— 不做任何猜测。
    var name: String = ""

    var qualifiedName: String { "\(remote)/\(branch)" }
    var id: String { qualifiedName }
}
```

- 三个方法：

```swift
    /// 列远端分支。**只读电脑缓存的 `refs/remotes`**，不联网（设计文档决策二）。
    ///
    /// 成功且带 `message` 时用提示条说一句 —— 那是「只列出了前 512 条」这类
    /// 「成了但有话说」，吞掉它等于让用户以为列表是全部。
    func loadRemoteBranches(on desk: TerminalGitDesk) async {
        guard !isLoadingRemoteBranches else { return }
        isLoadingRemoteBranches = true
        defer { isLoadingRemoteBranches = false }
        let result = await desk.send(.git("remoteBranches", sessionId: sessionId), AppConfiguration.gitLocalTimeout)
        guard let result else {
            failure = TerminalGitFailure(title: "读取远端分支失败", message: Self.unansweredRetryable)
            return
        }
        guard result.isAccepted, let list = result.git?.remoteBranches else {
            failure = TerminalGitFailure(
                title: "读取远端分支失败",
                message: result.message ?? "电脑没有完成这个操作。"
            )
            return
        }
        remoteBranches = list
        if let message = result.message { desk.notice(message, .info, "git.remoteBranches.truncated") }
    }

    /// 下拉刷新：**先获取、再重取**（设计文档决策二）。
    ///
    /// 获取失败就**不重取**：列表留在原地，用户可以继续拿旧的挑，比变成一个空列表有用。
    func refreshRemoteBranches(on desk: TerminalGitDesk) async {
        let fetched = await desk.send(.git("fetchRemotes", sessionId: sessionId), AppConfiguration.gitRemoteTimeout)
        guard let fetched else {
            failure = TerminalGitFailure(title: "获取远端分支失败", message: Self.unansweredRetryable)
            return
        }
        guard fetched.isAccepted else {
            failure = TerminalGitFailure(
                title: "获取远端分支失败",
                message: fetched.message ?? "电脑没有完成这个操作。"
            )
            return
        }
        await loadRemoteBranches(on: desk)
    }

    /// 迁出。`localBranch` 缺席＝建同名分支；电脑要另一个名字时推一页让用户填。
    ///
    /// **不走远端超时**：从头到尾一条网络命令都没有（建 tracking 分支、切分支都是本地的），
    /// 慢不到推 / 同步那个量级去。
    func checkoutRemote(_ remote: String, branch: String, localBranch: String? = nil, on desk: TerminalGitDesk) async {
        await perform(
            title: "迁出远端分支失败",
            success: "已迁出 \(remote)/\(branch)",
            id: "git.checkoutRemote",
            pending: .checkoutRemote(remote: remote, branch: branch, localBranch: localBranch),
            on: desk
        ) {
            .git("checkoutRemote", sessionId: sessionId, remote: remote, branch: branch, localBranch: localBranch)
        }
    }
```

- `MobileIntentRequest.git(...)` 那个便利构造器加两个参数（`remote`、`localBranch`）。

- 回答分路。`send` 里现在是 `if result.git?.needsDecision == "dirty", let pending` —— 改成认两个值。**两种都回 `.decided`**（电脑问了一件事、界面已经摆出来，都不是失败）：

```swift
        if let decision = result.git?.needsDecision, let pending {
            switch decision {
            case "dirty":
                self.decision = pending
                return .decided
            case "localBranchName":
                // 不是失败，是一个问题。拿不到那条 pending 就当作普通拒绝往下走 ——
                // 这条回答只可能来自 checkoutRemote。
                guard case .checkoutRemote(let remote, let branch, _) = pending else { break }
                let sameTarget = localNamePrompt?.qualifiedName == "\(remote)/\(branch)"
                localNamePrompt = TerminalGitLocalNamePrompt(
                    remote: remote,
                    branch: branch,
                    // 电脑这次的原话优先；它没说话才沿用上一次那句（同一页接着问，理由没变）。
                    message: result.message ?? localNamePrompt?.message ?? "本地已有同名分支，另起一个本地名。",
                    // 同一个目标的第二次问：用户刚打的字留着 —— 他正要改它。
                    // 换了目标就是全新的一页，字不该带过来。
                    name: sameTarget ? (localNamePrompt?.name ?? "") : ""
                )
                // **已经在那一页上就不再推一页。** 第二次问（用户填的名字也被占了）
                // 是同一页上的一次失败，再推一次会叠出两层一模一样的页，返回要点两下。
                if path.last != .remoteLocalName { path.append(.remoteLocalName) }
                return .decided
            default:
                break
            }
        }
```

- `discardChanges(_:on:)` 现在 `guard case .checkout(let branch) = pending` —— 加一支
  `.checkoutRemote`，发带 `discardChanges: true` 的 `checkoutRemote`。

- `carryOut` 加一支 `.checkoutRemote`（提交成功后接着迁出）。

- `prepare()` 要把四个新状态清掉（`remoteBranches`、`remoteBranchQuery`、
  `isLoadingRemoteBranches`、`localNamePrompt`）。

- **顺手改掉那句不成立的注释**：`loadBranches` 上面写的「远端的新分支由『同步』带回来」
  （`TerminalGitFlow.swift:191`）与 `TerminalGitBranchList.swift:15` 同一句，都改成
  「只列本地分支；远端分支走『迁出远端分支』那一页」——「同步带回来」是错的（设计文档 §2.2）。

### 关键约束

- **`localNamePrompt.name` 存在 flow 上。** 失败之后这一页要留着、用户打的字也要留着
  （设计文档 §4.3），存在视图的 `@State` 里会随页面重建丢掉。
- **超时那句话只给这三个新动作。** 既有动作的「电脑一直没有回答。」不动 —— 只给它们翻译成
  可照做的一句（设计文档 §5.1）：

```swift
    /// 电脑没回答时，这一组动作要说成可照做的一句 —— 新动作在**旧电脑端**上会被静默丢弃，
    /// 而「升级电脑端」正是用户能做的那件事。既有动作不受影响（它们的电脑端一定认识）。
    static let unansweredRetryable = "电脑端没有回答。如果电脑上的 Synapse 不是最新版，先升级它再试。"
```

  `perform(...)` 要能带这句话进去：加一个 `unanswered: String = "电脑一直没有回答。"` 参数，
  由 `finish` 的 `.unanswered` 分支用它。
- **`needsDecision` 要认两个值。** 写死 `== "dirty"` 的话「要名字」会被当成普通拒绝，
  用户看到的是一句错而不是一页输入框。
- 本地名仍只做「非空」检查，合法性交给电脑（与新建分支同一口径）。

### 涉及文件

- `SynapseMobile/SynapseMobile/Core/Protocol/LiveProtocol.swift`
- `SynapseMobile/SynapseMobile/Features/Terminal/Git/TerminalGitFlow.swift`
- `SynapseMobile/SynapseMobile/Features/Terminal/Git/TerminalGitPresentation.swift`
- `SynapseMobile/SynapseMobile/Features/Terminal/Git/TerminalGitBranchList.swift`（只改那句注释）
- `SynapseMobile/SynapseMobileTests/TerminalGitFlowTests.swift`
- `SynapseMobile/SynapseMobileTests/TerminalGitPresentationTests.swift`

### 验证

`TerminalGitFlowTests` 里的 `FakeDesk` 与 `dirty()` / `conflict()` 两个夹具要跟着
`MobileIntentGitResult` 的新字段改（**三处构造点**：`:72`、`:76`、`:343`）——
每个都补 `remoteBranches: nil`。新增用例：

1. `loadRemoteBranches` 发的是一个 `remoteBranches` intent，且列表落进 `flow.remoteBranches`。
2. `refreshRemoteBranches` 发**两个** intent 且顺序是 `fetchRemotes` → `remoteBranches`。
3. fetch 被拒时**不发第二个** intent，且弹出「获取远端分支失败」+ 电脑原文。
4. 加载成功且 `message` 非空 → 多一条提示条，文字就是那句。
5. `checkoutRemote` 发一个 intent，带 `remote` 与 `branch`，**不带 `localBranch`**（第一次不带）。
6. 电脑回 `needsDecision: "localBranchName"` + 原话 → `flow.path == [.remoteLocalName]`，
   `localNamePrompt?.message` 是那句原话，**`flow.failure == nil`**（不是错误）。
7. 在那一页填名字再 `checkoutRemote(..., localBranch:)` → intent 里带上 `localBranch`。
8. 失败时（电脑回普通拒绝）→ `flow.failure?.title == "迁出远端分支失败"`，
   **`flow.path` 不变**（那一页留着）、**`localNamePrompt?.name` 还是用户打的字**。
8b. **第二次也被占**（填了名字又被回 `localBranchName`）→ `flow.path` **仍然只有一页**
   （`path.last == .remoteLocalName` 且长度不变，不叠第二页）、名字还是刚打的那个、
   `localNamePrompt?.message` 换成了电脑这一次的原话。
9. 电脑回 `needsDecision: "dirty"` → `flow.decision == .checkoutRemote(...)`，没推页。
10. `.checkoutRemote` 允许「丢弃」：`TerminalGitDirtyChoice.allowed(for: .checkoutRemote(...))`
    是三项，且丢弃那条发的是带 `discardChanges: true` 的 `checkoutRemote`。
11. 「提交并迁出」：`choose(.commit, from: .checkoutRemote(...))` → 进提交页；提交成功后
    接着发出 `checkoutRemote`（顺序：`commit` → `checkoutRemote`）。
12. 超时（`answers` 用空）→ `failure?.message` 是那句「电脑端没有回答……」，**不是**
    「电脑一直没有回答。」。既有动作（例如 `checkout`）超时仍是原来那句。

`TerminalGitPresentationTests` 新增：分组切开不重排、空列表给空数组、搜索匹配限定名
（`origin/dev` 与 `dev` 都命中、`ORIGIN/DEV` 也命中）、搜索是空查询时返回全部。

```bash
xcodebuild test -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileTests -parallel-testing-enabled NO
```

---

## 阶段 5 · 手机端：面板那一行、远端列表页、填本地名那一页

### 产物

`Features/Terminal/Git/TerminalGitPanel.swift`：

- 「操作」段在「合并分支」下面加一行（与它同构，没有 detail）：

```swift
                TerminalGitActionRow(
                    title: "迁出远端分支",
                    enabled: !flow.isBusy,
                    identifier: "git-panel-remote-branches"
                ) {
                    flow.path.append(.remoteBranches)
                }
```

- `destination(_:)` 加两支：

```swift
        case .remoteBranches:
            TerminalGitRemoteBranchList(flow: flow, desk: desk)
        case .remoteLocalName:
            TerminalGitLocalName(flow: flow, desk: desk)
```

新文件 `Features/Terminal/Git/TerminalGitRemoteBranchList.swift` —— 形状照
`TerminalGitBranchList` 抄（`.searchable` 常显、`ContentUnavailableView` 空态、`List` +
`.insetGrouped`）：

```swift
/// 远端分支列表，带搜索。
///
/// **只读电脑缓存的 `refs/remotes`**：打开这一页不联网，要最新的就下拉
/// （下拉＝先 `fetch --all --prune`，再重取这张列表）。
struct TerminalGitRemoteBranchList: View {
    @Bindable var flow: TerminalGitFlow
    let desk: TerminalGitDesk

    var body: some View {
        List {
            if flow.isLoadingRemoteBranches, flow.remoteBranches.isEmpty {
                HStack { Spacer(); ProgressView(); Spacer() }
            } else if groups.isEmpty {
                emptyState
            } else {
                ForEach(groups) { group in
                    Section("\(group.remote) · \(group.branches.count)") {
                        ForEach(group.branches) { branch in
                            row(branch)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        // `displayMode: .always`：这一页是推进来的，默认 placement 在推进来的页上不给搜索框
        // —— 与本地分支列表同一个理由（用户硬要求：选分支的地方一定要有搜索框）。
        .searchable(
            text: $flow.remoteBranchQuery,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: "搜索分支"
        )
        .navigationTitle("远端分支")
        .navigationBarTitleDisplayMode(.inline)
        // 下拉 = 先获取、再重取（电脑那边是两条命令，手机这边是两次往返）。
        .refreshable { await flow.refreshRemoteBranches(on: desk) }
        .task { await flow.loadRemoteBranches(on: desk) }
    }
```

  行是限定名，空态两种（「没有匹配的分支」/「还没有远端分支」，标识符都用
  `git-remote-branches-empty`），行标识符 `git-remote-branch-\(branch.qualifiedName)`。

新文件 `Features/Terminal/Git/TerminalGitLocalName.swift`：

```swift
/// 同名本地分支不能直接用时，要另一个本地名。
///
/// **推成一页而不是弹一张表**：失败弹窗挂在面板上，表开着的时候弹窗会被它挡住
/// —— 那正是「点了没反应」。推成一页，弹窗就浮在这一页之上。
struct TerminalGitLocalName: View {
    @Bindable var flow: TerminalGitFlow
    let desk: TerminalGitDesk

    var body: some View {
        List {
            Section {
                // **电脑的原话**：这一页为什么在问。不改写、不翻译。
                Text(flow.localNamePrompt?.message ?? "")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("git-remote-local-name-reason")
            }
            Section("另一个本地名") {
                TextField("feature/xxx", text: nameBinding)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("git-remote-local-name")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("迁出远端分支")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("迁出") { submit() }
                    .disabled(trimmedName.isEmpty)
                    .accessibilityIdentifier("git-remote-local-name-confirm")
            }
            ToolbarItem(placement: .cancellationAction) {
                Button("返回") {
                    Haptics.select()
                    flow.cancelLocalName()
                }
                .accessibilityIdentifier("git-remote-local-name-cancel")
            }
        }
    }
}
```

  `nameBinding` 写回 `flow.localNamePrompt?.name`；`submit()` 调
  `flow.checkoutRemote(prompt.remote, branch: prompt.branch, localBranch: trimmedName, on: desk)`。
  `flow.cancelLocalName()`：清 `localNamePrompt` 并 `path.removeLast()`。

`TerminalGitDirtySheet.swift`：`.checkoutRemote` 要跟着换说法（**丢弃这一次成立**）：

- `TerminalGitDirtyChoice.title(for:)` 的 `.commit` 分支加 `case .checkoutRemote: return "提交并迁出"`。
- `decisionMessage(for:)` 加 `case .checkoutRemote(let remote, let branch, _): return "要迁出 \(remote)/\(branch)，先处理这些改动。"`。
- 二次确认那颗按钮的字现在写死「丢弃并切换」（`:96`）—— 抽成静态函数按 pending 换说法
  （`.checkoutRemote` → 「丢弃并迁出」，其余 → 「丢弃并切换」），`discardMessage(for:)` 同理加一支。

### 关键约束

- **标识符一个都不能重**：面板新行用 `git-panel-remote-branches`（既有 UI 测试会按
  `identifier BEGINSWITH 'git-panel-'` 数行数的那一条要跟着改，见阶段 6）。
- **列表顺序不在手机端重排**：分组只切段，顺序吃电脑给的（`remoteBranchGroups`）。
- 远端列表**不打勾**：远端列表里没有「当前分支」这个概念（设计文档决策七）。
- 输入框那一页**不自己做「非空」以外的校验**。
- 失败时那一页**不许被关掉**：失败只写 `flow.failure`，不动 `path`、不动 `localNamePrompt`。

### 涉及文件

- `SynapseMobile/SynapseMobile/Features/Terminal/Git/TerminalGitPanel.swift`
- `SynapseMobile/SynapseMobile/Features/Terminal/Git/TerminalGitRemoteBranchList.swift`（新）
- `SynapseMobile/SynapseMobile/Features/Terminal/Git/TerminalGitLocalName.swift`（新）
- `SynapseMobile/SynapseMobile/Features/Terminal/Git/TerminalGitDirtySheet.swift`

### 验证

模拟器手点（先照阶段 6 建好夹具、或在任一带远端的仓库里）：

1. 面板「操作」段多出第五行「迁出远端分支」，点开进列表。
2. 列表按远端分组，组头是「远端名 · 条数」；搜索框一进页面就在。
3. 打 `dev` 与 `origin/dev` 都能过滤；搜不到有空态。
4. 点一条只有远端有的分支 → 直接迁出，面板三行（分支/远端/同步）都更新。
5. 点当前分支跟踪的那条 → 提示「已经在这条分支上」，工作区不变。
6. 点一条本地同名但跟踪别的远端的分支 → 进「迁出远端分支」那一页，正文是电脑原话，输入框空、迁出不可点。
7. 在那一页填一个已被占用的名字 → 弹失败框；关掉之后**这一页还在、名字还在**，改一个能成功。
8. 有改动时点一条远端分支 → 三选一里恰好三项：提交并迁出 / 丢弃改动并迁出 / 取消。
9. 下拉 → 另一台机器刚推的分支出现在列表里。

```bash
xcodebuild build -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```

---

## 阶段 6 · 夹具、UI 走查、改掉旧说法、发布说明

### 产物

`SynapseMobile/scripts/make-git-acceptance-fixture.sh` 加第三个仓库 `remote/`
（现有两个仓库都没有远端，验不了这一轮）：

```bash
# --- C: 有远端（远端分支列表、迁出）---
# 裸远端放在 ROOT 外面一点：它自身不是一个「让手机 cd 进去」的仓库。
git init -q --bare -b main "$ROOT/remote-origin.git"
git_init "$ROOT/remote"                       # 已在 main 上，有一个初始提交
git -C "$ROOT/remote" remote add origin "$ROOT/remote-origin.git"
git -C "$ROOT/remote" push -q -u origin main

# 远端有、本地没有：推上去，再把本地那条删掉（refs/remotes 留下来）。
git -C "$ROOT/remote" checkout -qb only-on-remote
printf '只在远端\n' > "$ROOT/remote/remote-file.txt"
git -C "$ROOT/remote" add -A && git -C "$ROOT/remote" commit -qm "只在远端有的提交"
git -C "$ROOT/remote" push -q -u origin only-on-remote
git -C "$ROOT/remote" checkout -q main
git -C "$ROOT/remote" branch -D only-on-remote

# 同名本地分支存在、但**没有上游**：点 origin/taken 应当推「填名字」那一页。
git -C "$ROOT/remote" branch taken
git -C "$ROOT/remote" push -q origin taken:refs/heads/taken
```

  收尾的 `echo` 三行都补上 `remote` 那一行。

`SynapseMobile/SynapseMobileUITests/TerminalGitUITests.swift` 加一个用例
`testRemoteBranchListAndCheckout`（照该文件既有形状：`cd` 到 `remote` 仓库 → `openGitPanel` →
点那一行 → 断言分组头与两条分支在同一屏 → 搜索 → 点 `origin/only-on-remote` 迁出 →
断言面板的「分支」行变成 `only-on-remote`）。

**既有断言一条都不用改**：该文件里没有任何按 `git-panel-` 计数的断言（已核），
只有按标识符点名的那几个，新行不影响它们。同目录 `TerminalFlowUITests` 里那条数
`identifier BEGINSWITH 'toolbar-'` 的与这一轮无关。

`docs/superpowers/specs/2026-09-21-mobile-terminal-git-design.md` —— **改掉两处被本轮推翻的说法**：

- §4.4（`:331`）的「**只列本地分支。** 远端的新分支由「同步」带回来，本轮不做「检出远程分支」。」
  → 「只列本地分支（远端分支走『迁出远端分支』那一页，见
  `2026-09-22-mobile-remote-branch-checkout-design.md`）。」
- §6（`:432`）的「**不做远程分支检出。** 分支列表只列本地分支。」→ 划掉这一条，指向本轮文档。

`RELEASE_NOTES_PENDING.md`：这是用户可感知的变化（手机端多了一个入口，能迁出远端分支），
按「得到什么、什么变了」写。

### 关键约束

- **夹具是有状态的**，每次跑走查前重建（脚本自己的注释已写明）。
- UI 走查用例默认跳过（`SYNAPSE_GIT_ACCEPTANCE != 1` 时 skip），不要在 CI 里变红。
- 改旧文档只改那两处说法，**不改上一轮的决策与验收基线** —— 它们仍然有效。

### 验证

```bash
SynapseMobile/scripts/make-git-acceptance-fixture.sh
git -C /tmp/synapse-git-acceptance/remote for-each-ref --format='%(refname:short)' refs/heads refs/remotes
# 期望：本地只有 main 与 taken；refs/remotes 里有 origin/main、origin/only-on-remote、origin/taken

SYNAPSE_GIT_ACCEPTANCE=1 SYNAPSE_TEST_EMAIL=... SYNAPSE_TEST_PASSWORD=... \
xcodebuild test -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileUITests/TerminalGitUITests -parallel-testing-enabled NO
```

---

## 完成标准

- 设计文档 §8 的 30 条逐条走过（不是「测试全绿」，是逐条走过）。
- 新增的测试都能在**坏的时候变红**。至少对着这四条各反证一次：
  - 把 `--track` 去掉 → 阶段 2 第 4 条红（这正是 §2.3 那个陷阱）；
  - 把 `needsDecision` 写死 `"dirty"` → 阶段 4 第 6 条红；
  - 把 `intent-executor` 里那两行 spread 拿掉 → 阶段 3 最后一条红；
  - 把截断去掉 → 阶段 1/3 的超量用例红。
- 两处不成立的旧说法已改（`TerminalGitBranchList.swift:15`、`TerminalGitFlow.swift:191`），
  上一轮设计文档的 §4.4 与 §6 已改。
- `pnpm --filter @synapse/shared run test`、`pnpm --filter @synapse/desktop run test`、
  `pnpm --filter @synapse/desktop run typecheck`、`SynapseMobileTests` 全绿。
- `RELEASE_NOTES_PENDING.md` 已更新。

## 提交切分

| 提交 | 内容 |
|---|---|
| 1 | 阶段 0+1：`shared` 的协议（**单独部署一次服务端**，再往下走） |
| 2 | 阶段 2：`terminal-git` 的列 / fetch / 迁出 |
| 3 | 阶段 3：mobile-gateway 的分派与结果信封 |
| 4 | 阶段 4：手机端协议镜像与 flow（含 UI 单测） |
| 5 | 阶段 5：面板那一行与两张新页 |
| 6 | 阶段 6：夹具、UI 走查、旧说法、发布说明 |

提交信息用中文说清做了什么与关键行为变化。只提交本阶段的文件，不要 `git add -A`。

## 装机与上线

- 手机端装机：`pnpm mobile:install`（手机连数据线并解锁）。
- **上线顺序不可颠倒**：服务端 → 桌面端 → 手机端（理由见「升级顺序」那一节）。
