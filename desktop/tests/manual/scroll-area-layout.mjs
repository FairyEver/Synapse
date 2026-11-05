// Open the desktop Vite origin, then evaluate:
// await import('/tests/manual/scroll-area-layout.mjs').then(m => m.runScrollAreaLayoutChecks())
// Uses real Chromium layout and production components; does not access application data.
import React from "react"
import { createRoot } from "react-dom/client"
import { ScrollArea } from "../../src/components/ui/scroll-area"
import { ActionVariablesDialog } from "../../src/action-runtime/action-variables-dialog"
import { FormDialog } from "../../src/components/form-dialog"
import { Dialog } from "../../src/components/ui/dialog"
import { Table, TableBody, TableCell, TableRow } from "../../src/components/ui/table"

const h = React.createElement
const settle = async () => {
  for (let frame = 0; frame < 4; frame++) await new Promise(requestAnimationFrame)
}
const rows = Array.from({ length: 30 }, (_, index) => h("p", { key: index, className: "p-3" }, `滚动条目 ${index + 1}`))
const variables = Array.from({ length: 30 }, (_, index) => ({
  key: `trigger.payload.field${index + 1}`, label: `变量 ${index + 1}`, group: "event",
}))

export async function runScrollAreaLayoutChecks({ keepOpen = false } = {}) {
  const host = document.createElement("div")
  host.className = "fixed inset-0 bg-background p-4"
  document.body.append(host)
  const root = createRoot(host)
  const results = []
  const measure = (name, viewport, axis = "y") => {
    const vertical = axis === "y"
    const client = vertical ? viewport.clientHeight : viewport.clientWidth
    const scroll = vertical ? viewport.scrollHeight : viewport.scrollWidth
    if (vertical) viewport.scrollTop = scroll
    else viewport.scrollLeft = scroll
    const offset = vertical ? viewport.scrollTop : viewport.scrollLeft
    results.push({ name, client, scroll, offset, passed: client > 0 && scroll > client && offset > 0 })
  }

  try {
    for (const [name, wrapperClassName, className] of [
      ["max-height list", "w-80", "max-h-64"],
      ["flex body in max-height dialog", "flex max-h-96 w-80 flex-col overflow-hidden", "min-h-0 flex-1"],
      ["fixed-height list", "w-80", "h-64"],
    ]) {
      root.render(h("div", { className: wrapperClassName },
        h("header", { className: "shrink-0 p-4" }, "固定标题"),
        h(ScrollArea, { className, trackScroll: false }, rows),
        h("footer", { className: "shrink-0 p-4" }, "固定操作")))
      await settle()
      measure(name, host.querySelector('[data-slot="scroll-area-viewport"]'))
    }

    root.render(h(ScrollArea, { className: "w-80", scrollbars: "horizontal", trackScroll: false },
      h("pre", null, "wide-content ".repeat(100))))
    await settle()
    measure("horizontal content", host.querySelector('[data-slot="scroll-area-viewport"]'), "x")

    root.render(h(ScrollArea, { className: "w-80", trackScroll: false }, h("p", { className: "p-3" }, "短内容")))
    await settle()
    const short = host.querySelector('[data-slot="scroll-area-viewport"]')
    results.push({ name: "unconstrained short content", passed: short.clientHeight > 0 && short.scrollHeight === short.clientHeight })

    root.render(h(ScrollArea, { className: "max-h-64 w-80", trackScroll: false },
      h(Table, null, h(TableBody, null, ...rows.map((_, index) =>
        h(TableRow, { key: index }, h(TableCell, null, `命令 ${index + 1}`)))))))
    await settle()
    measure("max-height list with nested horizontal table", host.querySelector('[data-slot="scroll-area-viewport"]'))

    root.render(h(Dialog, { open: true }, h(FormDialog, {
      title: "长表单", footer: h("button", { type: "submit" }, "保存"), onSubmit(event) { event.preventDefault() },
    }, rows)))
    await settle()
    measure("shared form dialog body", document.querySelector('[role="dialog"] [data-slot="scroll-area-viewport"]'))

    for (const mode of ["view", "insert"]) {
      root.render(h(ActionVariablesDialog, {
        key: mode, mode, variables, triggerTitle: "滚动验收", targetLabel: "提示词", onInsert() {},
        trigger: h("button", { type: "button" }, "打开变量"),
      }))
      await settle()
      host.querySelector("button").click()
      await settle()
      const dialog = document.querySelector('[role="dialog"]')
      const viewport = dialog.querySelector('[data-slot="scroll-area-viewport"]')
      measure(`variables ${mode}`, viewport)
      const footer = dialog.querySelector('[data-slot="dialog-frame-footer"]')
      results.push({ name: `variables ${mode} footer visible`, passed: footer.getBoundingClientRect().bottom <= innerHeight })
      if (keepOpen && mode === "insert") viewport.scrollTop = 0
      else dialog.querySelector('[data-slot="dialog-frame-header"] button').click()
      await settle()
    }
    return { width: innerWidth, height: innerHeight, passed: results.every(result => result.passed), results }
  } finally {
    if (!keepOpen) {
      root.unmount()
      host.remove()
    }
  }
}
