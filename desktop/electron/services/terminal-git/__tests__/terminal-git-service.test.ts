import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createGitClientCommandRunner, type GitClientCommandRunner } from "../../git-client/git-command-runner"
import { createTerminalGitService, type TerminalGitService } from "../terminal-git-service"

const temporaryDirectories: string[] = []

/**
 * 这些用例跑**真实的 git**（`mkdtemp` + `git init`），不 mock 命令 ——
 * 这一层要证明的正是「按目录跑 git 真的跑得动」，mock 掉就什么都没证明。
 */

const GIT_ENV: NodeJS.ProcessEnv = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV },
    stdio: ["ignore", "pipe", "ignore"],
  })
}

/** 有 MERGE_HEAD 才算「合并还在进行中」；没有的时候 git 退出码是 1，不是错误。 */
function mergeInProgress(cwd: string): boolean {
  try {
    return git(cwd, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).trim() !== ""
  } catch {
    return false
  }
}

async function createRepository(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-terminal-git-"))
  temporaryDirectories.push(dir)
  git(dir, ["init", "-b", "main"])
  git(dir, ["config", "user.email", "terminal-git@example.com"])
  git(dir, ["config", "user.name", "Terminal Git"])
  await writeFile(path.join(dir, "a.txt"), "base\n", "utf8")
  git(dir, ["add", "-A"])
  git(dir, ["commit", "-m", "init"])
  return dir
}

async function createBareRemote(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-terminal-git-remote-"))
  temporaryDirectories.push(dir)
  git(dir, ["init", "--bare", "-b", "main"])
  return dir
}

/** 只包一层用来记命令，执行本身还是真的。 */
function recordingRunner(): { runner: GitClientCommandRunner; commands: string[] } {
  const inner = createGitClientCommandRunner()
  const commands: string[] = []
  return {
    commands,
    runner: {
      async run(input) {
        commands.push([input.args[0], ...input.args.slice(1)].join(" "))
        return inner.run(input)
      },
    } as GitClientCommandRunner,
  }
}

function serviceWith(runner: GitClientCommandRunner): TerminalGitService {
  return createTerminalGitService({ commandRunner: runner })
}

/**
 * 这个服务只吃路径；`repositories.json` 是「代码仓库」注册表的账本，这里不许有它的份。
 *
 * 快照必须在**任何用例跑之前**取 —— 放在最后一个 describe 的 `beforeAll` 里就等于在动作
 * 做完之后才记基准，那条断言永远是绿的。
 */
const repositoriesJsonBefore = new Map<string, string | null>()

beforeAll(() => {
  const candidates = [
    path.join(os.homedir(), "Library", "Application Support", "Synapse", "git-client", "repositories.json"),
    path.join(os.homedir(), "Library", "Application Support", "Electron", "git-client", "repositories.json"),
  ]
  for (const candidate of candidates) {
    repositoriesJsonBefore.set(candidate, existsSync(candidate) ? readFileSync(candidate, "utf8") : null)
  }
})

afterAll(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })))
})

describe("TerminalGitService · 读状态与分支", () => {
  it("reads a snapshot out of a real repository", async () => {
    const repo = await createRepository()
    const service = serviceWith(recordingRunner().runner)

    await expect(service.getSnapshot(repo)).resolves.toMatchObject({
      cwd: repo,
      isRepository: true,
      branch: "main",
      upstream: null,
      ahead: 0,
      behind: 0,
      changeCount: 0,
      hasConflicts: false,
    })
  })

  it("answers 「不是仓库」 instead of failing for a plain directory", async () => {
    const plain = await mkdtemp(path.join(os.tmpdir(), "synapse-terminal-plain-"))
    temporaryDirectories.push(plain)
    const service = serviceWith(recordingRunner().runner)
    await expect(service.getSnapshot(plain)).resolves.toMatchObject({
      isRepository: false,
      branch: null,
      changeCount: 0,
    })
  })

  it("reports the same thing from a subdirectory as from the root", async () => {
    const repo = await createRepository()
    const sub = path.join(repo, "nested", "deeper")
    await mkdir(sub, { recursive: true })
    const service = serviceWith(recordingRunner().runner)

    const root = await service.getSnapshot(repo)
    const nested = await service.getSnapshot(sub)
    expect({ ...nested, cwd: root.cwd }).toEqual(root)
  })

  it("reports the detached short sha and lists branches with the current one marked", async () => {
    const repo = await createRepository()
    git(repo, ["checkout", "-b", "feature"])
    const head = git(repo, ["rev-parse", "--short", "HEAD"]).trim()
    git(repo, ["checkout", "--detach"])
    const service = serviceWith(recordingRunner().runner)

    await expect(service.getSnapshot(repo)).resolves.toMatchObject({
      branch: null,
      detachedSha: head,
    })
    await expect(service.listBranches(repo)).resolves.toEqual([
      { name: "feature", current: false },
      { name: "main", current: false },
    ])
  })
})

describe("TerminalGitService · 拒绝面", () => {
  it("refuses every write action outside a repository without running a write command", async () => {
    const plain = await mkdtemp(path.join(os.tmpdir(), "synapse-terminal-plain-write-"))
    temporaryDirectories.push(plain)
    const actions = [
      { name: "checkout", run: (service: TerminalGitService) => service.checkout({ cwd: plain, branch: "main" }) },
      { name: "createBranch", run: (service: TerminalGitService) => service.createBranch({ cwd: plain, branch: "x" }) },
      { name: "commit", run: (service: TerminalGitService) => service.commit({ cwd: plain, message: "x" }) },
      { name: "push", run: (service: TerminalGitService) => service.push({ cwd: plain }) },
      { name: "sync", run: (service: TerminalGitService) => service.sync({ cwd: plain }) },
      { name: "merge", run: (service: TerminalGitService) => service.merge({ cwd: plain, direction: "intoCurrent", branch: "x" }) },
    ]
    for (const action of actions) {
      const recording = recordingRunner()
      const outcome = await action.run(serviceWith(recording.runner))
      expect(outcome, action.name).toMatchObject({ ok: false, message: "这个目录不是 Git 仓库。" })
      // 只跑了那句「这是不是仓库」的只读判断，一个写命令都没有。
      expect(recording.commands, action.name).toEqual(["rev-parse --show-toplevel"])
    }
  })

  it("refuses illegal branch names without running a git command", async () => {
    const repo = await createRepository()
    for (const branch of ["../x", "a b", "-x", ""]) {
      for (const run of [
        (service: TerminalGitService) => service.checkout({ cwd: repo, branch }),
        (service: TerminalGitService) => service.createBranch({ cwd: repo, branch }),
      ]) {
        const recording = recordingRunner()
        expect(await run(serviceWith(recording.runner)), `${branch} / ${recording.commands[0] ?? ""}`)
          .toMatchObject({ ok: false })
        // 只跑了那句只读判断、取一次快照、以及 `check-ref-format`（那正是 git 的规则）；
        // 没有 checkout / commit / add 之类会动仓库的命令。空串在本地就被挡住了。
        const expected = [
          "rev-parse --show-toplevel",
          "status --porcelain=v2 -z --branch --untracked-files=all",
          ...(branch ? [`check-ref-format --branch ${branch}`] : []),
        ]
        expect(recording.commands, branch).toEqual(expected)
      }
    }
    expect(git(repo, ["branch", "--format=%(refname:short)"]).trim()).toBe("main")
  })
})

describe("TerminalGitService · 切分支与提交", () => {
  it("switches branches and creates one from a chosen start point", async () => {
    const repo = await createRepository()
    const service = serviceWith(recordingRunner().runner)

    await expect(service.createBranch({ cwd: repo, branch: "feature" })).resolves.toMatchObject({
      ok: true,
      value: { branch: "feature" },
    })
    await expect(service.checkout({ cwd: repo, branch: "main" })).resolves.toMatchObject({
      ok: true,
      value: { branch: "main" },
    })
    await expect(service.createBranch({ cwd: repo, branch: "from-main", fromBranch: "main" })).resolves.toMatchObject({
      ok: true,
      value: { branch: "from-main" },
    })
  })

  it("does nothing at all when asked to switch to the branch it is already on", async () => {
    const repo = await createRepository()
    await writeFile(path.join(repo, "a.txt"), "changed\n", "utf8")
    const recording = recordingRunner()
    const service = serviceWith(recording.runner)

    // 「丢弃改动并切换」到自己这条分支：如果真跑了 `checkout -f`，用户的改动就白丢了。
    await expect(service.checkout({ cwd: repo, branch: "main", discardChanges: true }))
      .resolves.toMatchObject({ ok: true })
    expect(recording.commands).toEqual([
      "rev-parse --show-toplevel",
      "status --porcelain=v2 -z --branch --untracked-files=all",
      "check-ref-format --branch main",
    ])
    expect(await readFile(path.join(repo, "a.txt"), "utf8")).toBe("changed\n")
  })

  it("asks the user to decide instead of touching a dirty working tree", async () => {
    const repo = await createRepository()
    git(repo, ["branch", "other"])
    await writeFile(path.join(repo, "a.txt"), "dirty\n", "utf8")
    const service = serviceWith(recordingRunner().runner)

    for (const outcome of [
      await service.checkout({ cwd: repo, branch: "other" }),
      await service.createBranch({ cwd: repo, branch: "fresh" }),
      await service.merge({ cwd: repo, direction: "intoCurrent", branch: "other" }),
    ]) {
      expect(outcome).toMatchObject({ ok: false, needsDecision: "dirty" })
    }
    expect(git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe("main")
    expect(await readFile(path.join(repo, "a.txt"), "utf8")).toBe("dirty\n")
  })

  it("discards tracked changes on request but keeps untracked files", async () => {
    const repo = await createRepository()
    git(repo, ["branch", "other"])
    await writeFile(path.join(repo, "a.txt"), "dirty\n", "utf8")
    await writeFile(path.join(repo, "draft.md"), "notes\n", "utf8")
    const service = serviceWith(recordingRunner().runner)

    await expect(service.checkout({ cwd: repo, branch: "other", discardChanges: true }))
      .resolves.toMatchObject({ ok: true, value: { branch: "other" } })
    expect(await readFile(path.join(repo, "a.txt"), "utf8")).toBe("base\n")
    // 未跟踪的新文件必须留着：它可能是用户根本没想提交的草稿，删掉不可逆。
    expect(await readFile(path.join(repo, "draft.md"), "utf8")).toBe("notes\n")
  })

  it("commits everything and returns the refreshed snapshot", async () => {
    const repo = await createRepository()
    await writeFile(path.join(repo, "a.txt"), "changed\n", "utf8")
    await writeFile(path.join(repo, "new.txt"), "new\n", "utf8")
    const service = serviceWith(recordingRunner().runner)

    await expect(service.commit({ cwd: repo, message: "全部提交" })).resolves.toMatchObject({
      ok: true,
      value: { changeCount: 0 },
    })
    expect(git(repo, ["log", "-1", "--pretty=%s"]).trim()).toBe("全部提交")
    expect(git(repo, ["show", "--name-only", "--pretty=", "HEAD"]).trim().split("\n").sort())
      .toEqual(["a.txt", "new.txt"])
    expect(await service.commit({ cwd: repo, message: "   " })).toMatchObject({ ok: false })
  })
})

describe("TerminalGitService · 推送与同步", () => {
  async function repositoryWithRemote(): Promise<{ repo: string; remote: string }> {
    const remote = await createBareRemote()
    const repo = await createRepository()
    git(repo, ["remote", "add", "origin", remote])
    return { repo, remote }
  }

  it("sets the upstream on the first push and reuses it afterwards", async () => {
    const { repo, remote } = await repositoryWithRemote()
    const recording = recordingRunner()
    const service = serviceWith(recording.runner)

    await expect(service.push({ cwd: repo })).resolves.toMatchObject({
      ok: true,
      value: { upstream: "origin/main" },
    })
    expect(recording.commands).toContain("push --set-upstream origin main")
    expect(git(remote, ["log", "-1", "--pretty=%s", "main"]).trim()).toBe("init")

    await writeFile(path.join(repo, "a.txt"), "second\n", "utf8")
    await service.commit({ cwd: repo, message: "second" })
    recording.commands.length = 0
    await expect(service.push({ cwd: repo })).resolves.toMatchObject({ ok: true, value: { ahead: 0 } })
    expect(recording.commands).toContain("push")
  })

  it("fast-forwards a sync and refuses to sync a dirty tree or a fork", async () => {
    const { repo, remote } = await repositoryWithRemote()
    const service = serviceWith(recordingRunner().runner)
    await service.push({ cwd: repo })

    // 在别处往远端推一个提交，本地靠同步把它拉回来。
    const other = await mkdtemp(path.join(os.tmpdir(), "synapse-terminal-git-other-"))
    temporaryDirectories.push(other)
    git(other, ["clone", remote, "work"])
    const work = path.join(other, "work")
    git(work, ["config", "user.email", "other@example.com"])
    git(work, ["config", "user.name", "Other"])
    await writeFile(path.join(work, "remote.txt"), "from remote\n", "utf8")
    git(work, ["add", "-A"])
    git(work, ["commit", "-m", "remote commit"])
    git(work, ["push"])

    await expect(service.sync({ cwd: repo })).resolves.toMatchObject({
      ok: true,
      value: { behind: 0, ahead: 0 },
    })
    expect(existsSync(path.join(repo, "remote.txt"))).toBe(true)

    // 脏工作区：先提交再同步。
    await writeFile(path.join(repo, "a.txt"), "dirty\n", "utf8")
    await expect(service.sync({ cwd: repo })).resolves.toMatchObject({
      ok: false,
      message: "当前目录里有未提交的改动。",
    })
    git(repo, ["checkout", "--", "a.txt"])

    // 分叉：本地和远端各有提交 → 整体失败，不产生合并提交。
    await writeFile(path.join(repo, "local.txt"), "local\n", "utf8")
    git(repo, ["add", "-A"])
    git(repo, ["commit", "-m", "local commit"])
    await writeFile(path.join(work, "remote2.txt"), "remote2\n", "utf8")
    git(work, ["add", "-A"])
    git(work, ["commit", "-m", "remote2"])
    git(work, ["push"])

    await expect(service.sync({ cwd: repo })).resolves.toMatchObject({
      ok: false,
      message: "本地分支与上游分支已分叉，请使用外部 Git 工具处理后重试。",
    })
    // 没有合并提交：远端那个提交并没有被拉进来。
    expect(existsSync(path.join(repo, "remote2.txt"))).toBe(false)
  })
})

describe("TerminalGitService · 合并", () => {
  /** 两条分支从同一个基点出发，都改了同一行 —— 这是必然冲突的形状。 */
  async function conflictingRepository(): Promise<string> {
    const repo = await createRepository()
    git(repo, ["checkout", "-b", "feature"])
    await writeFile(path.join(repo, "a.txt"), "feature\n", "utf8")
    git(repo, ["commit", "-am", "feature"])
    git(repo, ["checkout", "main"])
    await writeFile(path.join(repo, "a.txt"), "main\n", "utf8")
    git(repo, ["commit", "-am", "main"])
    return repo
  }

  it("merges another branch into the current one", async () => {
    const repo = await createRepository()
    git(repo, ["checkout", "-b", "feature"])
    await writeFile(path.join(repo, "feature.txt"), "feature\n", "utf8")
    git(repo, ["add", "-A"])
    git(repo, ["commit", "-m", "feature"])
    git(repo, ["checkout", "main"])
    const service = serviceWith(recordingRunner().runner)

    await expect(service.merge({ cwd: repo, direction: "intoCurrent", branch: "feature" })).resolves.toMatchObject({
      ok: true,
      value: { branch: "main" },
    })
    expect(git(repo, ["log", "--pretty=%s", "main"]).trim().split("\n")).toEqual(["feature", "init"])
  })

  it("merges the current branch into another one and comes back", async () => {
    const repo = await createRepository()
    git(repo, ["checkout", "-b", "release"])
    git(repo, ["checkout", "main"])
    await writeFile(path.join(repo, "work.txt"), "work\n", "utf8")
    git(repo, ["add", "-A"])
    git(repo, ["commit", "-m", "work on main"])
    const service = serviceWith(recordingRunner().runner)

    await expect(service.merge({ cwd: repo, direction: "outOfCurrent", branch: "release" })).resolves.toMatchObject({
      ok: true,
      value: { branch: "main" },
    })
    // 方向二必然离开当前分支，做完必须回到原地。
    expect(git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe("main")
    expect(git(repo, ["log", "--pretty=%s", "release"]).trim().split("\n")).toEqual(["work on main", "init"])
  })

  it("aborts and rolls back a conflicting merge, leaving no merge in progress", async () => {
    const repo = await conflictingRepository()
    const service = serviceWith(recordingRunner().runner)
    const before = await service.getSnapshot(repo)

    const outcome = await service.merge({ cwd: repo, direction: "intoCurrent", branch: "feature" })

    expect(outcome.ok).toBe(false)
    expect(outcome).toMatchObject({
      message: "检测到冲突，已自动取消合并并回退。",
      conflict: { source: "feature", target: "main", files: ["a.txt"] },
    })
    expect(outcome.ok === false && outcome.conflict?.summaryText).toContain("【Synapse · Git 合并冲突】")
    expect(outcome.ok === false && outcome.conflict?.summaryText).toContain("把分支 feature 合并到 main")
    expect(outcome.ok === false && outcome.conflict?.summaryText).toContain("- a.txt")

    // abort 干净了：没有 MERGE_HEAD，没有未解决的冲突。
    expect(mergeInProgress(repo)).toBe(false)
    const after = await service.getSnapshot(repo)
    expect(after.branch).toBe(before.branch)
    expect(after.changeCount).toBe(before.changeCount)
    expect(after.ahead).toBe(before.ahead)
    expect(after.behind).toBe(before.behind)
    expect(after.hasConflicts).toBe(false)
    expect(await readFile(path.join(repo, "a.txt"), "utf8")).toBe("main\n")
  })

  it("comes back to the original branch after a conflict in the other direction too", async () => {
    const repo = await conflictingRepository()
    const service = serviceWith(recordingRunner().runner)

    const outcome = await service.merge({ cwd: repo, direction: "outOfCurrent", branch: "feature" })

    expect(outcome).toMatchObject({
      ok: false,
      conflict: { source: "main", target: "feature", files: ["a.txt"] },
    })
    expect(git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe("main")
    expect(mergeInProgress(repo)).toBe(false)
  })

  /**
   * 只让「切回原分支」那一条命令失败，其余照跑真实 git。
   *
   * 这一步在真实仓库里没有可靠的造法（干净的合并之后，工作区不会凭空长出会被覆盖的
   * 文件），但它在真实世界里是会发生的 —— 用户自己的配置、钩子、权限都可能让它失败。
   * 这里注入的就是那一次失败本身。
   */
  function runnerFailingRestore(): { runner: GitClientCommandRunner; commands: string[] } {
    const inner = createGitClientCommandRunner()
    const commands: string[] = []
    return {
      commands,
      runner: {
        async run(input) {
          commands.push(input.args.join(" "))
          if (input.operation === "terminal-git.merge.restore") {
            throw new Error("error: Your local changes would be overwritten by checkout.")
          }
          return inner.run(input)
        },
      } as GitClientCommandRunner,
    }
  }

  it("reports a finished merge as finished even when it cannot come back to the original branch", async () => {
    const repo = await createRepository()
    git(repo, ["checkout", "-b", "release"])
    git(repo, ["checkout", "main"])
    await writeFile(path.join(repo, "work.txt"), "work\n", "utf8")
    git(repo, ["add", "-A"])
    git(repo, ["commit", "-m", "work on main"])

    const failing = runnerFailingRestore()
    const service = serviceWith(failing.runner)
    const outcome = await service.merge({ cwd: repo, direction: "outOfCurrent", branch: "release" })

    // 合并真的进了历史。这就是它不能被报成失败的全部理由：用户会以为什么都没发生。
    expect(git(repo, ["log", "--pretty=%s", "release"]).trim().split("\n")).toEqual(["work on main", "init"])
    expect(failing.commands).toContain("checkout main")

    expect(outcome.ok).toBe(true)
    // 成功归成功，切不回去这件事要如实说出来，而且带上真实的分支名。
    expect(outcome.ok === true ? outcome.message : undefined).toBe(
      "合并已完成，但没能切回 main：error: Your local changes would be overwritten by checkout.",
    )
    // 快照是当下的实话：它还停在 release 上。
    expect(outcome.ok === true ? outcome.value.branch : null).toBe("release")
    expect(git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe("release")
  })

  it("refuses to merge a branch into itself and refuses while detached", async () => {
    const repo = await createRepository()
    const service = serviceWith(recordingRunner().runner)
    await expect(service.merge({ cwd: repo, direction: "intoCurrent", branch: "main" }))
      .resolves.toMatchObject({ ok: false, message: "不能把 main 合并到它自己。" })

    git(repo, ["checkout", "--detach"])
    await expect(service.merge({ cwd: repo, direction: "intoCurrent", branch: "main" }))
      .resolves.toMatchObject({ ok: false })
  })
})

describe("TerminalGitService · 不碰「代码仓库」", () => {
  it("ran every action above without touching repositories.json", async () => {
    for (const [candidate, snapshot] of repositoriesJsonBefore) {
      const now = existsSync(candidate) ? readFileSync(candidate, "utf8") : null
      expect(now, candidate).toBe(snapshot)
    }
  })
})
