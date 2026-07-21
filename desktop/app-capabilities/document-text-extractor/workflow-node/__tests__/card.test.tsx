import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { DocumentTextExtractNodeCard } from "../card"

vi.mock("@/modules/workflow/components/copy-id-button", () => ({
  CopyIdButton: ({ id }: { id: string }) => <span>{id}</span>,
}))

vi.mock("@/modules/workflow/runner/node-progress-bar", () => ({
  NodeProgressBar: () => <div data-testid="progress" />,
  useRunningTimer: () => "",
}))

describe("DocumentTextExtractNodeCard", () => {
  it("renders the configured file and running progress using the shared node card pattern", () => {
    const configured = renderToStaticMarkup(
      <DocumentTextExtractNodeCard
        config={{ filePath: "/tmp/report.pdf", variables: [] }}
        nodeId="extract-1"
      />,
    )
    expect(configured).toContain("文档文本提取")
    expect(configured).toContain("/tmp/report.pdf")
    expect(configured).toContain("extract-1")

    const running = renderToStaticMarkup(
      <DocumentTextExtractNodeCard
        config={{ filePath: "/tmp/report.pdf", variables: [] }}
        status="running"
        progressLabel="提取中"
      />,
    )
    expect(running).toContain("提取中")
    expect(running).not.toContain("/tmp/report.pdf")
  })
})
