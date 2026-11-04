import { crc32, deflateRawSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import { inspectHubSkillPackage } from "./skill-hub-package-node.js"

const MiB = 1024 * 1024
const main = Buffer.from("---\nname: demo-skill\ndescription: 'Keep Authorization examples'\nmetadata:\n  name: ignored\n---\nRun this skill.\n")

type Entry = [path: string, data?: Uint8Array, mode?: number, flags?: number]

function zip(entries: Entry[], timestamp = 0) {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, data = Buffer.alloc(0), mode = 0, flags = 0] of entries) {
    const path = Buffer.from(name)
    const compressed = deflateRawSync(data)
    const crc = crc32(data)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50)
    header.writeUInt16LE(flags, 6)
    header.writeUInt16LE(8, 8)
    header.writeUInt16LE(timestamp, 10)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(compressed.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(path.length, 26)
    local.push(header, path, compressed)
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50)
    directory.writeUInt16LE(0x0314, 4)
    header.copy(directory, 8, 6, 28)
    directory.writeUInt32LE((mode << 16) >>> 0, 38)
    directory.writeUInt32LE(offset, 42)
    central.push(directory, path)
    offset += header.length + path.length + compressed.length
  }
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(central.reduce((n, part) => n + part.length, 0), 12)
  end.writeUInt32LE(offset, 16)
  return { format: "zip" as const, bytes: Buffer.concat([...local, ...central, end]) }
}

describe("Skill Hub package inspection", () => {
  it("preserves exact Markdown bytes and reads only the package's top-level fields", () => {
    const result = inspectHubSkillPackage({ format: "markdown", bytes: main })
    expect(result.package).toEqual({ name: "demo-skill", description: "Keep Authorization examples" })
    expect(result.main).toEqual(main)
    expect(result.manifest.map((file) => file.path)).toEqual(["SKILL.md"])
  })

  it("supports literal and folded strings; rejects duplicate keys and non-string fields", () => {
    const inspect = (yaml: string) => inspectHubSkillPackage({ format: "markdown", bytes: Buffer.from(`---\n${yaml}\n---\nBody`) })
    expect(inspect("name: demo\ndescription: >-\n  line one\n  line two").package.description).toBe("line one line two")
    expect(inspect("name: demo\ndescription: |-\n  line one\n  line two").package.description).toBe("line one\nline two")
    for (const yaml of [
      "name: demo\n'name': other\ndescription: ok",
      "name: demo\ndescription: [a, b]",
      "name: demo\ndescription: 123",
      "name: demo\ndescription: true",
      "name: demo\ndescription: *alias",
      "name: CON\ndescription: ok",
    ]) expect(() => inspect(yaml)).toThrow()
    expect(() => inspectHubSkillPackage({ format: "markdown", bytes: Buffer.from([0xff]) })).toThrow()
    expect(() => inspectHubSkillPackage({ format: "markdown", bytes: Buffer.from("Just a post") })).toThrow()
  })

  it("fingerprints normalized file paths and bytes independently of ZIP wrappers or order", () => {
    const a = inspectHubSkillPackage(zip([["SKILL.md", main], ["assets/demo.pem", Buffer.from("a")]]))
    const b = inspectHubSkillPackage(zip([["outer/", undefined, 0o40755], ["outer/assets/demo.pem", Buffer.from("a")], ["outer/SKILL.md", main], ["__MACOSX/._outer", Buffer.from("meta")]], 7))
    expect(a.contentFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(a.contentFingerprint).toBe(b.contentFingerprint)
    expect(a.contentFingerprint).not.toBe(inspectHubSkillPackage(zip([["SKILL.md", main], ["assets/demo.pem", Buffer.from("b")]])).contentFingerprint)
  })

  it.each<Entry[]>([
    [["../outside", main]], [["C:/outside", main]], [["SKILL.md", main]],
    [["foo/a"], ["FOO/b"]], [["café/a"], ["cafe\u0301/b"]],
    [["foo"], ["foo/bar"]], [["foo/"], ["foo"]], [["nested/SKILL.md", main]],
    [["link", Buffer.from("target"), 0o120777]], [["pipe", undefined, 0o010644]],
    [["secret", main, 0, 1]], [[".env", main]], [["nested/.env.example", main]],
    [["node_modules/x"]], [["a/b/c/d/e/f/g/h/i/file"]],
  ])("rejects conflicting, forbidden or non-portable entries (%j)", (...entries) => {
    expect(() => inspectHubSkillPackage(zip([["SKILL.md", main], ...entries]))).toThrow()
  })

  it("enforces both file count and byte ceilings at the boundary", () => {
    const attachments: Entry[] = Array.from({ length: 100 }, (_, i) => [`file-${i}`])
    expect(inspectHubSkillPackage(zip([["SKILL.md", main], ...attachments])).manifest).toHaveLength(101)
    expect(() => inspectHubSkillPackage(zip([["SKILL.md", main], ...attachments, ["one-extra"]]))).toThrow()
    const exactMain = Buffer.concat([main, Buffer.alloc(MiB - main.length, 65)])
    const exactTotal: Entry[] = [["SKILL.md", exactMain], ...Array.from({ length: 4 }, (_, i): Entry => [`big-${i}`, Buffer.alloc(10 * MiB)]), ["last", Buffer.alloc(9 * MiB)]]
    expect(inspectHubSkillPackage(zip(exactTotal)).manifest.reduce((n, item) => n + item.size, 0)).toBe(50 * MiB)
    expect(() => inspectHubSkillPackage(zip([...exactTotal, ["extra", Buffer.of(1)]]))).toThrow()
    expect(() => inspectHubSkillPackage(zip([["SKILL.md", main], ["big", Buffer.alloc(10 * MiB + 1)]]))).toThrow()
    expect(() => inspectHubSkillPackage({ format: "markdown", bytes: Buffer.concat([exactMain, Buffer.of(65)]) })).toThrow()
  })
})
