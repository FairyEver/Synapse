import { describe, expect, it } from "vitest"
import { htmlGeneratorEjsFileNodeManifest, htmlGeneratorEjsNodeManifest } from "../manifest"
import { htmlGeneratorEjsFileNodeConfigSchema, htmlGeneratorEjsNodeConfigSchema } from "../schema"

const dataBinding = { name: "data", source: { type: "node_output", node: "upstream" } }

describe("HTML Generator workflow node schemas", () => {
  it("requires exactly one fixed data node_output binding for string generation", () => {
    expect(htmlGeneratorEjsNodeConfigSchema.safeParse({ template: "<%= data.title %>", variables: [dataBinding] }).success).toBe(true)
    expect(htmlGeneratorEjsNodeConfigSchema.safeParse({ template: "x", variables: [] }).success).toBe(false)
    expect(htmlGeneratorEjsNodeConfigSchema.safeParse({ template: "x", variables: [dataBinding, { ...dataBinding }] }).success).toBe(false)
  })

  it("allows file-path bindings but reserves data for node_output", () => {
    expect(htmlGeneratorEjsFileNodeConfigSchema.safeParse({
      template: "x",
      outputPath: "{{folder}}/out.html",
      overwrite: false,
      variables: [dataBinding, { name: "folder", source: { type: "param", param: "folder" } }],
    }).success).toBe(true)
    expect(htmlGeneratorEjsFileNodeConfigSchema.safeParse({
      template: "x",
      outputPath: "/tmp/out.html",
      overwrite: false,
      variables: [{ name: "data", source: { type: "static", value: "{}" } }],
    }).success).toBe(false)
    expect(htmlGeneratorEjsFileNodeConfigSchema.safeParse({
      template: "x",
      outputPath: "{{data}}/out.html",
      overwrite: false,
      variables: [dataBinding],
    }).success).toBe(false)
    expect(htmlGeneratorEjsFileNodeConfigSchema.safeParse({
      template: "x",
      outputPath: "{{missing}}/out.html",
      overwrite: false,
      variables: [dataBinding],
    }).success).toBe(false)
  })

  it("declares independent capability, risk, and file resource contracts", () => {
    expect(htmlGeneratorEjsNodeManifest.share).toEqual({
      selfContained: false,
      capability: { id: "app.html_generator.ejs.generate", minVersion: "1.0.0", installSourceId: "synapse.builtin" },
      risks: [{ path: ["template"], id: "shell.execute", when: "present" }],
    })
    expect(htmlGeneratorEjsFileNodeManifest.share).toMatchObject({
      capability: { id: "app.html_generator.ejs_file.generate", minVersion: "1.0.0" },
      resources: [{ path: ["outputPath"], entryType: "file", cardinality: "one", access: "write" }],
    })
  })
})
