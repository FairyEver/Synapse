/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SkillUninstallerDialog } from "../skill-uninstaller-dialog"
import { useSkillUninstallerDialog } from "../use-skill-uninstaller-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  flowProps: vi.fn(),
}))

vi.mock("../skill-uninstaller-flow", () => ({
  SkillUninstallerFlow: (props: {
    initialQuery: { name: string }
  } & Record<string, unknown>) => {
    mocks.flowProps(props)
    const [query] = useState(props.initialQuery)
    return <div>卸载流程：{query.name}</div>
  },
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children, className, showCloseButton }: { children: ReactNode; className?: string; showCloseButton?: boolean }) => (
    <section data-class-name={className} data-show-close={String(showCloseButton)}>{children}</section>
  ),
  DialogFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFrameBody: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  DialogFrameHeader: ({ bordered, title }: { bordered?: boolean; title: ReactNode }) => (
    <header data-bordered={String(bordered)}>{title}</header>
  ),
}))

let roots: Root[] = []

async function render(element: ReactNode) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(element))
}

afterEach(async () => {
  vi.clearAllMocks()
  await act(async () => roots.forEach((root) => root.unmount()))
  roots = []
  document.body.innerHTML = ""
})

describe("SkillUninstallerDialog", () => {
  it("renders a locked auto-scanning flow in a large dialog", async () => {
    const onOpenChange = vi.fn()
    const onCompleted = vi.fn()
    await render(
      <SkillUninstallerDialog
        open
        query={{ name: "jenkins", searchRootPath: "/skills" }}
        onOpenChange={onOpenChange}
        onCompleted={onCompleted}
      />,
    )

    expect(document.body.textContent).toContain("Skill 卸载器")
    const content = document.querySelector("section")
    expect(content?.getAttribute("data-class-name")).toContain("h-[min(42rem,calc(100vh-2rem))]")
    expect(content?.getAttribute("data-show-close")).toBe("false")
    expect(mocks.flowProps).toHaveBeenCalledWith(expect.objectContaining({
      autoScan: true,
      initialQuery: { name: "jenkins", searchRootPath: "/skills" },
      mode: "modal",
      onCompleted,
      queryReadOnly: true,
    }))
  })

  it("renders nothing without a query", async () => {
    await render(<SkillUninstallerDialog open query={null} onOpenChange={vi.fn()} />)
    expect(document.body.textContent).toBe("")
  })
})

describe("useSkillUninstallerDialog", () => {
  it("opens and closes the callable dialog", async () => {
    function Harness() {
      const { dialog, openSkillUninstaller, closeSkillUninstaller } = useSkillUninstallerDialog()
      return (
        <>
          <button type="button" onClick={() => openSkillUninstaller({ initialName: "jenkins" })}>打开</button>
          <button type="button" onClick={closeSkillUninstaller}>关闭</button>
          {dialog}
        </>
      )
    }
    await render(<Harness />)

    await act(async () => {
      Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "打开")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(document.body.textContent).toContain("卸载流程")
    expect(mocks.flowProps).toHaveBeenLastCalledWith(expect.objectContaining({
      initialQuery: { name: "jenkins", searchRootPath: undefined },
    }))

    await act(async () => {
      Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "关闭")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(document.body.textContent).not.toContain("卸载流程")
  })

  it("replaces the locked flow query while the dialog remains open", async () => {
    function Harness() {
      const { dialog, openSkillUninstaller } = useSkillUninstallerDialog()
      return (
        <>
          <button type="button" onClick={() => openSkillUninstaller({ initialName: "jenkins" })}>打开 Jenkins</button>
          <button type="button" onClick={() => openSkillUninstaller({ initialName: "docker" })}>替换为 Docker</button>
          {dialog}
        </>
      )
    }
    await render(<Harness />)

    await act(async () => {
      Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "打开 Jenkins")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(document.body.textContent).toContain("卸载流程：jenkins")

    await act(async () => {
      Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "替换为 Docker")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(document.body.textContent).toContain("卸载流程：docker")
    expect(document.body.textContent).not.toContain("卸载流程：jenkins")
  })
})
