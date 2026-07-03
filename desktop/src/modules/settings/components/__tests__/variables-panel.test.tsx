/**
 * @vitest-environment jsdom
 */
import { act, type ButtonHTMLAttributes, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { VariablesPanel } from "@/modules/settings/components/variables-panel"
import type { SynapseVariable } from "@/types/config"

const mocks = vi.hoisted(() => ({
  config: {
    global: {
      variables: [] as SynapseVariable[],
    },
  },
  updateConfig: vi.fn(),
  updateRepository: vi.fn(),
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: mocks.config,
    updateConfig: mocks.updateConfig,
  }),
}))

vi.mock("@/app-shell/use-repository-manager", () => ({
  useActiveRepository: () => null,
  useRepositoryActions: () => ({
    updateRepository: mocks.updateRepository,
  }),
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  DialogFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFrameBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFrameFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  DialogFrameHeader: ({ title, description }: { title: ReactNode; description?: ReactNode }) => (
    <header>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
    </header>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}))

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
  AlertDialogCancel: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("VariablesPanel", () => {
  afterEach(() => {
    for (const root of roots) {
      act(() => {
        root.unmount()
      })
    }
    roots = []
    document.body.innerHTML = ""
    mocks.config.global.variables = []
    vi.clearAllMocks()
  })

  it("adds user variables without an active repository", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<VariablesPanel />)
    })

    expect(document.body.textContent).not.toContain("请先选择一个仓库")

    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("添加"))
        ?.click()
    })

    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"))

    await act(async () => {
      setInputValue(inputs[0]!, "API_KEY")
      setInputValue(inputs[1]!, "secret")
      setInputValue(inputs[2]!, "personal token")
    })

    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .filter((button) => button.textContent === "添加")
        .at(-1)
        ?.click()
    })

    expect(mocks.updateConfig).toHaveBeenCalledWith({
      global: {
        variables: [{ name: "API_KEY", value: "secret", description: "personal token" }],
      },
    })
    expect(mocks.updateRepository).not.toHaveBeenCalled()
  })

  it("does not render saved variable values as visible text", async () => {
    mocks.config.global.variables = [{
      name: "GITEE_TOKEN",
      value: "sk-secret-token",
      description: "Gitee",
    }]
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<VariablesPanel />)
    })

    expect(document.body.textContent).toContain("GITEE_TOKEN")
    expect(document.body.textContent).toContain("********")
    expect(document.body.textContent).not.toContain("sk-secret-token")
  })

  it("masks the value field when editing a variable", async () => {
    mocks.config.global.variables = [{
      name: "GITEE_TOKEN",
      value: "sk-secret-token",
      description: "Gitee",
    }]
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<VariablesPanel />)
    })
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="编辑变量"]')?.click()
    })

    const valueInput = document.querySelector<HTMLInputElement>("#variable-value")
    expect(valueInput?.type).toBe("password")
    expect(document.body.textContent).not.toContain("sk-secret-token")
  })
})
