import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { DocumentTemplateNodeCard } from "../card"

vi.mock("@/modules/workflow/components/copy-id-button", () => ({
  CopyIdButton: ({ id }: { id: string }) => <span>{id}</span>,
}))

vi.mock("@/modules/workflow/runner/node-progress-bar", () => ({
  NodeProgressBar: () => <div data-testid="progress" />,
  useRunningTimer: () => "",
}))

describe("DocumentTemplateNodeCard", () => {
  it("renders title, output path, data source, and node id", () => {
    const html = renderToStaticMarkup(
      <DocumentTemplateNodeCard
        config={{
          templatePath: "/tmp/template.docx",
          outputPath: "/tmp/output.docx",
          dataSource: "dataPath",
          dataPath: "/tmp/data.json",
          overwrite: false,
          variables: [],
        }}
        nodeId="doc-node-1"
      />,
    )

    expect(html).toContain("模板生成文档")
    expect(html).toContain("/tmp/output.docx")
    expect(html).toContain("JSON 文件")
    expect(html).toContain("doc-node-1")
  })

  it("renders running progress text before config summary", () => {
    const html = renderToStaticMarkup(
      <DocumentTemplateNodeCard
        config={{
          templatePath: "",
          outputPath: "",
          dataSource: "inline",
          dataJson: "{}",
          overwrite: false,
          variables: [],
        }}
        status="running"
        progressLabel="模板生成文档"
      />,
    )

    expect(html).toContain("模板生成文档")
    expect(html).not.toContain("未设置输出文件")
  })
})
