/**
 * @vitest-environment jsdom
 */
import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CronEditorDialog, CronEditorFields } from "../cron-editor-dialog"
import { CronInput } from "../cron-input"
import {
  createDefaultCronTemplateDraft,
  validateCronExpression,
} from "../cron-utils"

const { track } = vi.hoisted(() => ({
  track: vi.fn(),
}))

vi.mock("@/lib/ui-tracking", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ui-tracking")>("@/lib/ui-tracking")
  return {
    ...actual,
    track,
  }
})

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  track.mockClear()
})

describe("CronInput", () => {
  it("keeps manually entered hours when a common template field is changed", async () => {
    function Harness() { const [value, setValue] = useState("0 9 * * *"); return <CronInput id="manual-cron" value={value} onChange={setValue} /> }
    const container = document.createElement("div"); document.body.appendChild(container)
    const root = createRoot(container); roots.push(root)
    await act(async () => { root.render(<Harness />) })
    const change = (id: string, value: string) => {
      const input = document.getElementById(id) as HTMLInputElement
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    }
    await act(async () => { change("manual-cron", "0 15 * * *") })
    await act(async () => { Array.from(document.querySelectorAll("button")).find(b => b.textContent === "编辑")!.click() })
    expect((document.getElementById("cron-editor-hour") as HTMLInputElement).value).toBe("15")
    await act(async () => { change("cron-editor-minute", "1") })
    expect((document.getElementById("manual-cron") as HTMLInputElement).value).toBe("1 15 * * *")
  })
  it("renders as an input group with an embedded edit button", () => {
    const html = renderToStaticMarkup(
      <CronInput
        id="task-form-cron"
        value="0 9 * * *"
        onChange={vi.fn()}
      />,
    )

    expect(html).toContain('data-slot="input-group"')
    expect(html).toContain('id="task-form-cron"')
    expect(html).toContain('data-align="inline-end"')
    expect(html).toContain(">编辑</button>")
  })

  it("expands and collapses the cron editor inline without a dialog", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <CronInput
          id="task-form-cron"
          value="0 9 * * *"
          onChange={vi.fn()}
        />,
      )
    })

    const editButton = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent === "编辑")
    expect(editButton).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      editButton?.click()
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.body.textContent).toContain("常用")
    const collapseButton = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "收起")
    expect(collapseButton).toBeInstanceOf(HTMLButtonElement)
    await act(async () => { collapseButton?.click() })
    expect(document.body.textContent).not.toContain("未来 5 次")
  })
})

describe("CronEditorDialog", () => {
  it("shows an invalid expression error once", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <CronEditorDialog
          open
          value="bad cron"
          onApply={vi.fn()}
          onOpenChange={vi.fn()}
        />,
      )
    })

    expect(document.body.textContent?.match(/Cron 必须包含 5 段/g)).toHaveLength(1)
  })

  it("tracks cron apply submits without recording the expression", async () => {
    const onApply = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <CronEditorDialog
          open
          value="0 9 * * *"
          onApply={onApply}
          onOpenChange={vi.fn()}
        />,
      )
    })

    const form = document.body.querySelector("form")
    expect(form).toBeInstanceOf(HTMLFormElement)

    await act(async () => {
      form?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))
    })

    expect(onApply).toHaveBeenCalledWith("0 9 * * *")
    expect(track).toHaveBeenCalledWith({
      component: "automation",
      name: "automation-cron-apply",
      action: "submit",
      eventKey: "automation.cron.apply",
      metadata: {
        boundary: "renderer.automation.cron-editor",
        activeTab: "common",
        expressionLength: 9,
        previewCount: 5,
      },
    })
    expect(JSON.stringify(track.mock.calls)).not.toContain("0 9 * * *")
  })
})

describe("CronEditorFields", () => {
  it("renders compact common and advanced editor surfaces", () => {
    const validation = validateCronExpression("0 9 * * *")
    const html = renderToStaticMarkup(
      <CronEditorFields
        activeTab="common"
        draft="0 9 * * *"
        previewRuns={[new Date("2026-04-29T09:00:00")]}
        template={createDefaultCronTemplateDraft()}
        validation={validation}
        onDraftChange={vi.fn()}
        onTabChange={vi.fn()}
        onTemplateChange={vi.fn()}
      />,
    )

    expect(html).toContain("常用")
    expect(html).toContain("高级")
    expect(html).toContain("未来 5 次")
    expect(html).toContain("计划")
  })

  it("renders hour before minute for common templates that use both fields", () => {
    for (const kind of ["daily", "weekly", "monthly", "weekdays"] as const) {
      const validation = validateCronExpression("30 9 * * *")
      const html = renderToStaticMarkup(
        <CronEditorFields
          activeTab="common"
          draft="30 9 * * *"
          previewRuns={[new Date("2026-04-29T09:30:00")]}
          template={{
            ...createDefaultCronTemplateDraft(),
            kind,
            hour: 9,
            minute: 30,
          }}
          validation={validation}
          onDraftChange={vi.fn()}
          onTabChange={vi.fn()}
          onTemplateChange={vi.fn()}
        />,
      )

      expect(html.indexOf('for="cron-editor-hour"')).toBeLessThan(
        html.indexOf('for="cron-editor-minute"'),
      )
    }
  })

  it("opens invalid expressions on the advanced tab", () => {
    const validation = validateCronExpression("bad")
    const html = renderToStaticMarkup(
      <CronEditorFields
        activeTab="advanced"
        draft="bad"
        previewRuns={[]}
        template={createDefaultCronTemplateDraft()}
        validation={validation}
        onDraftChange={vi.fn()}
        onTabChange={vi.fn()}
        onTemplateChange={vi.fn()}
      />,
    )

    expect(html).toContain('data-state="active"')
    expect(html).toContain("Cron 必须包含 5 段")
  })
})
