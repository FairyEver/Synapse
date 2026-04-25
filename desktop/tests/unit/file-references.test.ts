import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  buildReferenceViewRequest,
  parseLocalReference,
  renderReferenceView,
  transformLocalReferences,
} from "../../electron/services/file-reference-service"

const tempRoots: string[] = []

function tempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-ref-"))
  tempRoots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true })
  }
})

describe("file references", () => {
  it("parses local reference locations and rejects web URLs", () => {
    const workspace = tempWorkspace()
    const file = path.join(workspace, "src", "app.ts")
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, "export const x = 1\n")

    expect(parseLocalReference(`${file}:12:2`, workspace)).toMatchObject({
      kind: "file",
      pathRel: "src/app.ts",
      locationFormat: "colon_line_col",
      lineStart: 12,
      column: 2,
    })
    expect(parseLocalReference(`[app.ts](${file}#L4)`, workspace)).toMatchObject({
      locationFormat: "hash_line",
      lineStart: 4,
    })
    expect(parseLocalReference("https://example.com/app.ts", workspace)).toBeNull()
  })

  it("transforms workspace-local references while preserving web links and fences", () => {
    const workspace = tempWorkspace()
    const src = path.join(workspace, "src", "app.ts")
    const spec = path.join(workspace, "tests", "app.ts")
    fs.mkdirSync(path.dirname(src), { recursive: true })
    fs.mkdirSync(path.dirname(spec), { recursive: true })
    fs.writeFileSync(src, "export const app = true\n")
    fs.writeFileSync(spec, "test('app')\n")

    const output = transformLocalReferences(
      [
        "Docs: [OpenAI](https://openai.com/)",
        `Compare ${src}:42 and ${spec}`,
        "```",
        `${src}:1`,
        "```",
      ].join("\n"),
      {
        normalizeAgents: ["codex"],
        renderPlatforms: ["feishu"],
        displayPath: "smart",
        markerStyle: "ascii",
        enclosureStyle: "code",
      },
      "codex",
      "feishu",
      workspace,
    )

    expect(output).toContain("[OpenAI](https://openai.com/)")
    expect(output).toContain("[FILE] `src/app.ts:42`")
    expect(output).toContain("[FILE] `tests/app.ts`")
    expect(output).toContain(`\`\`\`\n${src}:1\n\`\`\``)
  })

  it("builds view requests and blocks outside-workspace paths", () => {
    const workspace = tempWorkspace()
    const file = path.join(workspace, "svc", "handler.go")
    const dir = path.join(workspace, "docs", "spec.v1")
    const outside = path.join(os.tmpdir(), "outside-secret.txt")
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, "package svc\n")
    fs.writeFileSync(outside, "secret\n")

    expect(buildReferenceViewRequest(`${file}:12`, workspace).mode).toBe("context")
    expect(buildReferenceViewRequest(`${file}:8-17`, workspace).mode).toBe("range")
    expect(buildReferenceViewRequest(dir, workspace).mode).toBe("dir")
    expect(() => buildReferenceViewRequest(`${dir}:12`, workspace)).toThrow("directory reference")
    expect(() => buildReferenceViewRequest(outside, workspace)).toThrow("inside the workspace")

    fs.rmSync(outside, { force: true })
  })

  it("renders file head, context, and directory listings", () => {
    const workspace = tempWorkspace()
    const file = path.join(workspace, "svc", "handler.go")
    const dir = path.join(workspace, "docs", "spec.v1")
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.mkdirSync(path.join(dir, "subdir"), { recursive: true })
    fs.writeFileSync(path.join(dir, "alpha.md"), "x")
    fs.writeFileSync(file, [
      "package svc",
      "",
      "func one() {}",
      "func two() {}",
      "func three() {}",
    ].join("\n"))

    expect(renderReferenceView(buildReferenceViewRequest(file, workspace))).toContain("```go\npackage svc")
    expect(renderReferenceView(buildReferenceViewRequest(`${file}:4`, workspace))).toContain("func two() {}")

    const dirView = renderReferenceView(buildReferenceViewRequest(dir, workspace))
    expect(dirView).toContain("[DIR] docs/spec.v1/")
    expect(dirView).toContain("- alpha.md")
    expect(dirView).toContain("- subdir/")
  })
})
