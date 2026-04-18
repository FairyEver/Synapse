import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"

const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
const PACKAGE_JSON_PATH = path.join(process.cwd(), "package.json")
const CHANGELOG_PATH = path.join(process.cwd(), "CHANGELOG.md")
const IGNORED_COMMIT_TYPES = new Set(["build", "ci", "docs", "style", "test"])
const RUNTIME_PREFIXES = ["electron/", "src/"]
const RELEASE_COMMIT_PATTERN = /^chore\(release\):\s*v?\d+\.\d+\.\d+$/i

function main() {
  const [command, ...args] = process.argv.slice(2)

  if (!command) {
    printUsage()
    process.exit(1)
  }

  try {
    if (command === "plan") {
      const options = parseOptions(args)
      const plan = buildReleasePlan(options)
      printPlan(plan)
      return
    }

    if (command === "apply") {
      const options = parseOptions(args)
      const plan = buildReleasePlan(options)
      applyReleasePlan(plan)
      printApplyResult(plan)
      return
    }

    if (command === "notes") {
      const version = args[0] ?? readPackageVersion()
      const section = getChangelogSection(version)
      const notes = section.lines.join("\n").trim()

      if (!notes) {
        throw new Error(`CHANGELOG.md 中没有找到 v${version} 的更新说明。`)
      }

      process.stdout.write(`${notes}\n`)
      return
    }

    printUsage()
    process.exit(1)
  } catch (error) {
    const message = error instanceof Error ? error.message : "release 脚本执行失败。"
    console.error(`[release] ${message}`)
    process.exit(1)
  }
}

function printUsage() {
  console.log([
    "Usage:",
    "  node scripts/release.mjs plan [--minor|--patch|--no-release] [--no-fetch-tags]",
    "  node scripts/release.mjs apply [--minor|--patch|--no-release] [--no-fetch-tags]",
    "  node scripts/release.mjs notes [version]",
  ].join("\n"))
}

function parseOptions(args) {
  let overrideBump = null
  let fetchTags = true

  for (const arg of args) {
    if (arg === "--minor") {
      overrideBump = assertOverride(overrideBump, "minor")
      continue
    }

    if (arg === "--patch") {
      overrideBump = assertOverride(overrideBump, "patch")
      continue
    }

    if (arg === "--no-release") {
      overrideBump = assertOverride(overrideBump, "none")
      continue
    }

    if (arg === "--no-fetch-tags") {
      fetchTags = false
      continue
    }

    throw new Error(`不支持的参数：${arg}`)
  }

  return {
    fetchTags,
    overrideBump,
  }
}

function assertOverride(currentValue, nextValue) {
  if (currentValue && currentValue !== nextValue) {
    throw new Error("一次只能指定一个版本覆盖参数。")
  }

  return nextValue
}

function buildReleasePlan(options) {
  if (options.fetchTags) {
    tryFetchTags()
  }

  const packageJson = readPackageJson()
  const currentVersion = parseVersion(packageJson.version)
  const tags = listReleaseTags()
  const currentTag = tags.find((tag) => compareVersions(tag.version, currentVersion) === 0) ?? null
  const latestTag = tags[0] ?? null

  if (latestTag && compareVersions(currentVersion, latestTag.version) < 0) {
    throw new Error(
      `package.json 当前版本 v${formatVersion(currentVersion)} 落后于最新 tag v${formatVersion(latestTag.version)}，请先同步仓库状态。`,
    )
  }

  if (!currentTag && latestTag && compareVersions(currentVersion, latestTag.version) > 0) {
    throw new Error(
      `package.json 当前版本 v${formatVersion(currentVersion)} 已领先于最新 tag v${formatVersion(latestTag.version)}，请先发布或回退当前版本，再继续自动升版。`,
    )
  }

  const baseTag = currentTag?.name ?? latestTag?.name ?? null
  const rangeSpec = baseTag ? `${baseTag}..HEAD` : `${EMPTY_TREE_SHA}..HEAD`
  const commits = listCommits(rangeSpec)
  const changedFiles = listChangedFiles(rangeSpec)
  const analyzedChanges = analyzeChanges(commits, changedFiles)
  const suggestedBump = suggestBump(analyzedChanges)
  const resolvedBump = options.overrideBump ?? suggestedBump
  const nextVersion = resolvedBump === "none" ? null : incrementVersion(currentVersion, resolvedBump)
  const notes = buildReleaseNotes(analyzedChanges)
  const hasUncommittedChanges = checkHasUncommittedChanges()

  return {
    analyzedChanges,
    baseTag,
    changedFiles,
    currentVersion,
    hasUncommittedChanges,
    nextVersion,
    notes,
    overrideBump: options.overrideBump,
    resolvedBump,
    suggestedBump,
  }
}

function applyReleasePlan(plan) {
  if (plan.resolvedBump === "none" || !plan.nextVersion) {
    return
  }

  const packageJson = readPackageJson()
  packageJson.version = formatVersion(plan.nextVersion)
  writePackageJson(packageJson)
  writeChangelogEntry(plan.nextVersion, plan.notes)
}

function printPlan(plan) {
  const currentVersion = formatVersion(plan.currentVersion)
  const lines = [
    `当前版本: v${currentVersion}`,
    `基准 tag: ${plan.baseTag ?? "(none)"}`,
    `建议升版: ${renderBump(plan.suggestedBump)}`,
  ]

  if (plan.overrideBump) {
    lines.push(`手工覆盖: ${renderBump(plan.overrideBump)}`)
  }

  lines.push(`最终结果: ${renderBump(plan.resolvedBump)}`)

  if (plan.nextVersion) {
    lines.push(`目标版本: v${formatVersion(plan.nextVersion)}`)
  }

  if (plan.analyzedChanges.reasons.length > 0) {
    lines.push("", "判断依据:")

    for (const reason of plan.analyzedChanges.reasons) {
      lines.push(`- ${reason}`)
    }
  }

  if (plan.notes.length > 0) {
    lines.push("", "计划写入的更新说明:")

    for (const note of plan.notes) {
      lines.push(`- ${note.label}: ${note.text}`)
    }
  } else {
    lines.push("", "计划写入的更新说明:", "- 本次没有识别到需要发布的用户可见更新。")
  }

  if (plan.hasUncommittedChanges) {
    lines.push("", "提示:", "- 当前有未提交改动，release 规划只统计已提交到 HEAD 的变更。")
  }

  process.stdout.write(`${lines.join("\n")}\n`)
}

function printApplyResult(plan) {
  if (plan.resolvedBump === "none" || !plan.nextVersion) {
    process.stdout.write("本次没有需要发布的用户可见更新，未改动 package.json 或 CHANGELOG.md。\n")
    return
  }

  const lines = [
    `已更新 package.json 版本为 v${formatVersion(plan.nextVersion)}。`,
    "已写入 CHANGELOG.md 最新条目:",
  ]

  for (const note of plan.notes) {
    lines.push(`- ${note.label}: ${note.text}`)
  }

  process.stdout.write(`${lines.join("\n")}\n`)
}

function tryFetchTags() {
  try {
    const remote = runGit(["remote", "get-url", "origin"]).trim()

    if (!remote) {
      return
    }

    runGit(["fetch", "--tags", "origin"], {
      stdio: "ignore",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error"
    console.warn(`[release] 拉取远端 tags 失败，改用本地 tags 继续：${message}`)
  }
}

function readPackageJson() {
  if (!existsSync(PACKAGE_JSON_PATH)) {
    throw new Error("当前目录下没有 package.json。")
  }

  return JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8"))
}

function writePackageJson(packageJson) {
  writeFileSync(PACKAGE_JSON_PATH, `${JSON.stringify(packageJson, null, 2)}\n`)
}

function readPackageVersion() {
  return readPackageJson().version
}

function listReleaseTags() {
  const output = runGit(["tag", "--list", "v*"])
  const tags = output
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((name) => {
      const version = parseVersion(name.replace(/^v/, ""))
      return { name, version }
    })

  tags.sort((left, right) => compareVersions(right.version, left.version))
  return tags
}

function checkHasUncommittedChanges() {
  return runGit(["status", "--short"]).trim().length > 0
}

function listCommits(rangeSpec) {
  const output = runGit([
    "log",
    "--no-merges",
    `--format=%H%x1f%s%x1f%b%x1e`,
    rangeSpec,
  ])

  if (!output.trim()) {
    return []
  }

  return output
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash, subject, body = ""] = entry.split("\x1f")
      return {
        body: body.trim(),
        hash: hash.trim(),
        subject: subject.trim(),
      }
    })
}

function listChangedFiles(rangeSpec) {
  const output = runGit([
    "diff",
    "--name-status",
    "--find-renames=40%",
    rangeSpec,
  ])

  if (!output.trim()) {
    return []
  }

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t")
      const status = parts[0]
      const from = parts[1] ?? null
      const to = parts.length > 2 ? parts[2] : from

      return {
        from,
        status,
        to,
      }
    })
}

function analyzeChanges(commits, changedFiles) {
  const reasons = []
  const additions = []
  const improvements = []
  const fixes = []
  let hasBreakingChange = false
  let hasFeatureCommit = false
  let hasPatchCommit = false

  for (const commit of commits) {
    if (!commit.subject || RELEASE_COMMIT_PATTERN.test(commit.subject)) {
      continue
    }

    const parsedCommit = parseCommitSubject(commit.subject)
    const isBreaking = parsedCommit?.isBreaking
      || /\bBREAKING[\s-]CHANGE\b/i.test(commit.body)
    const normalizedSubject = normalizeCommitSubject(commit.subject)

    if (!normalizedSubject) {
      continue
    }

    if (isBreaking) {
      hasBreakingChange = true
      reasons.push(`检测到破坏性改动标记：${commit.subject}`)
      additions.push(normalizedSubject)
      continue
    }

    if (parsedCommit?.type === "feat") {
      hasFeatureCommit = true
      reasons.push(`检测到功能提交：${commit.subject}`)
      additions.push(normalizedSubject)
      continue
    }

    if (parsedCommit?.type === "fix") {
      hasPatchCommit = true
      fixes.push(normalizedSubject)
      continue
    }

    if (parsedCommit && IGNORED_COMMIT_TYPES.has(parsedCommit.type)) {
      continue
    }

    if (parsedCommit?.type === "perf" || parsedCommit?.type === "refactor" || parsedCommit?.type === "revert") {
      hasPatchCommit = true
    }

    improvements.push(normalizedSubject)
  }

  const runtimeChanges = changedFiles.filter((file) => isRuntimeFile(file.to ?? file.from))
  const runtimeAddedFiles = runtimeChanges.filter((file) => file.status.startsWith("A") && isRuntimeFile(file.to))

  if (hasBreakingChange) {
    reasons.push("当前规则禁止升 major，已自动改判为 minor。")
  } else if (hasFeatureCommit) {
    reasons.push("存在用户可见的新功能提交，建议提升 minor。")
  } else if (runtimeAddedFiles.length > 0 && improvements.length > 0) {
    reasons.push("检测到新增运行时代码文件，且提交语义未明确为 fix，建议提升 minor。")
  } else if (hasPatchCommit) {
    reasons.push("存在修复或优化类提交，建议提升 patch。")
  } else if (runtimeChanges.length > 0) {
    reasons.push("存在运行时代码变更，按保守策略建议提升 patch。")
  } else {
    reasons.push("本次只有文档、测试或非运行时改动，不建议发版。")
  }

  return {
    additions,
    fixes,
    hasBreakingChange,
    hasFeatureCommit,
    hasPatchCommit,
    improvements,
    reasons: dedupeStrings(reasons),
    runtimeAddedFiles,
    runtimeChanges,
  }
}

function suggestBump(analyzedChanges) {
  if (analyzedChanges.hasBreakingChange || analyzedChanges.hasFeatureCommit) {
    return "minor"
  }

  if (analyzedChanges.runtimeAddedFiles.length > 0 && analyzedChanges.improvements.length > 0) {
    return "minor"
  }

  if (analyzedChanges.hasPatchCommit || analyzedChanges.runtimeChanges.length > 0) {
    return "patch"
  }

  return "none"
}

function buildReleaseNotes(analyzedChanges) {
  const notes = []

  for (const text of dedupeStrings(analyzedChanges.additions)) {
    notes.push({ label: "新增", text })
  }

  for (const text of dedupeStrings(analyzedChanges.improvements)) {
    notes.push({ label: "改进", text })
  }

  for (const text of dedupeStrings(analyzedChanges.fixes)) {
    notes.push({ label: "修复", text })
  }

  if (notes.length > 0) {
    return notes
  }

  if (analyzedChanges.runtimeChanges.length > 0) {
    return [{
      label: "改进",
      text: `覆盖 ${analyzedChanges.runtimeChanges.length} 个运行时代码文件的调整`,
    }]
  }

  return []
}

function writeChangelogEntry(version, notes) {
  const date = new Date().toISOString().slice(0, 10)
  const entryLines = [`## v${formatVersion(version)} - ${date}`]

  for (const note of notes) {
    entryLines.push(`- ${note.label}: ${note.text}`)
  }

  if (notes.length === 0) {
    entryLines.push("- 改进: 本次发布没有额外的用户可见说明。")
  }

  const nextSection = {
    lines: entryLines.slice(1),
    title: entryLines[0],
    version: formatVersion(version),
  }

  const sections = readChangelogSections()
  const remainingSections = sections.filter((section) => section.version !== nextSection.version)
  const nextContent = [
    "# Changelog",
    "",
    ...renderChangelogSection(nextSection),
  ]

  for (const section of remainingSections) {
    nextContent.push("", ...renderChangelogSection(section))
  }

  writeFileSync(CHANGELOG_PATH, `${nextContent.join("\n").trim()}\n`)
}

function readChangelogSections() {
  if (!existsSync(CHANGELOG_PATH)) {
    return []
  }

  const content = readFileSync(CHANGELOG_PATH, "utf8").replace(/\r\n/g, "\n")
  const lines = content.split("\n")
  const sections = []
  let currentSection = null

  for (const line of lines) {
    if (line.startsWith("## v")) {
      if (currentSection) {
        currentSection.lines = trimTrailingBlankLines(currentSection.lines)
        sections.push(currentSection)
      }

      const versionMatch = /^## v(\d+\.\d+\.\d+)\b/.exec(line.trim())

      if (!versionMatch) {
        continue
      }

      currentSection = {
        lines: [],
        title: line.trim(),
        version: versionMatch[1],
      }
      continue
    }

    if (currentSection) {
      currentSection.lines.push(line)
    }
  }

  if (currentSection) {
    currentSection.lines = trimTrailingBlankLines(currentSection.lines)
    sections.push(currentSection)
  }

  return sections
}

function getChangelogSection(version) {
  const sections = readChangelogSections()
  const match = sections.find((section) => section.version === version)

  if (!match) {
    throw new Error(`CHANGELOG.md 中没有找到 v${version} 的条目。`)
  }

  return match
}

function renderChangelogSection(section) {
  return [section.title, ...section.lines]
}

function trimTrailingBlankLines(lines) {
  const nextLines = [...lines]

  while (nextLines.length > 0 && nextLines[nextLines.length - 1].trim() === "") {
    nextLines.pop()
  }

  return nextLines
}

function parseCommitSubject(subject) {
  const match = /^(?<type>[a-z]+)(?:\([^)]+\))?(?<breaking>!)?:\s+(?<message>.+)$/.exec(subject)

  if (!match?.groups) {
    return null
  }

  return {
    isBreaking: Boolean(match.groups.breaking),
    message: match.groups.message.trim(),
    type: match.groups.type.toLowerCase(),
  }
}

function normalizeCommitSubject(subject) {
  const parsedCommit = parseCommitSubject(subject)

  if (parsedCommit) {
    return parsedCommit.message
  }

  return subject.trim()
}

function isRuntimeFile(filePath) {
  if (!filePath) {
    return false
  }

  return RUNTIME_PREFIXES.some((prefix) => filePath.startsWith(prefix))
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim())

  if (!match) {
    throw new Error(`无法解析版本号：${value}`)
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  }
}

function formatVersion(version) {
  return `${version.major}.${version.minor}.${version.patch}`
}

function compareVersions(left, right) {
  if (left.major !== right.major) {
    return left.major - right.major
  }

  if (left.minor !== right.minor) {
    return left.minor - right.minor
  }

  return left.patch - right.patch
}

function incrementVersion(version, bump) {
  if (bump === "minor") {
    return {
      major: version.major,
      minor: version.minor + 1,
      patch: 0,
    }
  }

  if (bump === "patch") {
    return {
      major: version.major,
      minor: version.minor,
      patch: version.patch + 1,
    }
  }

  throw new Error(`不支持的 bump 类型：${bump}`)
}

function renderBump(bump) {
  if (bump === "minor") {
    return "minor"
  }

  if (bump === "patch") {
    return "patch"
  }

  return "no-release"
}

function dedupeStrings(values) {
  const seen = new Set()
  const nextValues = []

  for (const value of values) {
    const normalizedValue = value.trim()

    if (!normalizedValue || seen.has(normalizedValue)) {
      continue
    }

    seen.add(normalizedValue)
    nextValues.push(normalizedValue)
  }

  return nextValues
}

function runGit(args, options = {}) {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 8,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    })
  } catch (error) {
    if (error instanceof Error && "stderr" in error) {
      const stderr = String(error.stderr ?? "").trim()

      if (stderr) {
        throw new Error(stderr)
      }
    }

    throw error
  }
}

main()
