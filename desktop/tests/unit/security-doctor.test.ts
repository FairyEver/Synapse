import { describe, expect, it } from "vitest"
import {
  createRunAsPreflightReport,
  parseIsolationProbeOutput,
  redactPathLikeText,
  renderIsolationHumanReport,
} from "../../electron/services/security-doctor-service"

describe("security doctor", () => {
  it("reports passwordless sudo setup failures as fatal and stops follow-up checks", () => {
    const report = createRunAsPreflightReport({
      project: "demo",
      runAsUser: "coder",
      workDir: "/Users/alice/project",
      sudoToTarget: "error",
      sudoToTargetError: "a password is required",
    }, { now: () => new Date("2026-04-25T00:00:00.000Z") })

    expect(report.generatedAt).toBe("2026-04-25T00:00:00.000Z")
    expect(report.checks).toHaveLength(1)
    expect(report.checks[0]).toMatchObject({
      id: "sudo-to-target",
      severity: "fatal",
    })
  })

  it("reports target sudo escalation and capped descendant warnings", () => {
    const report = createRunAsPreflightReport({
      project: "demo",
      runAsUser: "coder",
      workDir: "/Users/alice/project",
      sudoToTarget: "ok",
      targetCanEscalate: true,
      sudoListOutput: "(ALL) NOPASSWD: ALL",
      workDirAccess: { readable: true, writable: true },
      descendantFindings: [
        "nowrite\t/Users/alice/project/b.log",
        "noread\t/Users/alice/project/a.env",
        "noread\t/Users/alice/project/a.env",
        "nosearch\t/Users/alice/project/c",
      ],
      maxDescendantReport: 2,
    })

    expect(report.checks.find((check) => check.id === "target-passwordless-sudo")).toMatchObject({
      severity: "fatal",
      detail: "(ALL) NOPASSWD: ALL",
    })
    expect(report.checks.find((check) => check.id === "workdir-descendant-scan")?.detail).toContain("... and 1 more")
  })

  it("parses isolation probe output and computes fatal leaks", () => {
    const output = `BEGIN probe-version=1
ID uid=1001(coder)
WHOAMI coder
HOME /home/coder
WORKDIR_PATH /Users/alice/project
WORKDIR_READABLE yes
WORKDIR_WRITABLE yes
TARGET_HAS /home/coder/.claude/settings.json
TARGET_MISSING /home/coder/.pgpass
CROSS_LEAKED leigh /home/leigh/.claude/settings.json
SUPERVISOR_DENIED /home/supervisor/.claude/settings.json
END probe-version=1
`
    const report = parseIsolationProbeOutput(output, {
      project: "demo",
      runAsUser: "coder",
      workDir: "/Users/alice/project",
    })

    expect(report.probeVersion).toBe("1")
    expect(report.identity.whoami).toBe("coder")
    expect(report.targetPaths).toHaveLength(2)
    expect(report.crossUser[0]).toMatchObject({ otherUser: "leigh", status: "leaked" })
    expect(report.fatal[0]).toContain("CROSS_LEAKED")
    expect(report.rawOutput).toBe(output)
  })

  it("renders redacted human reports by default", () => {
    const report = parseIsolationProbeOutput(`BEGIN probe-version=1
ID uid=1001(coder)
WHOAMI coder
HOME /home/coder
WORKDIR_PATH /Users/alice/project
WORKDIR_READABLE yes
WORKDIR_WRITABLE no
SUPERVISOR_LEAKED /Users/alice/.pgpass
END probe-version=1
`, {
      project: "demo",
      runAsUser: "coder",
      workDir: "/Users/alice/project",
    })

    const rendered = renderIsolationHumanReport(report)
    expect(rendered).toContain("/Users/[USER]/project")
    expect(rendered).toContain("FATAL")
    expect(rendered).not.toContain("/Users/alice")
  })

  it("redacts common home directory path segments", () => {
    expect(redactPathLikeText("/Users/alice/project and /home/bob/.pgpass")).toBe(
      "/Users/[USER]/project and /home/[USER]/.pgpass",
    )
  })
})
