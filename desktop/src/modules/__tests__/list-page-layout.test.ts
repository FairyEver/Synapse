import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

async function readModuleSource(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), "utf8")
}

describe("list page layout surfaces", () => {
  it("keeps the database table surface aligned with the task scheduler cards", async () => {
    const source = await readModuleSource("../database/components/data-table-view.tsx")

    expect(source).toContain('className="min-h-0 flex-1 rounded-lg bg-card"')
    expect(source).not.toContain('className="min-h-0 flex-1 rounded-lg border bg-background"')
  })

  it("keeps local scan item cards on a white borderless card surface", async () => {
    const source = await readModuleSource("../editor-scan/components/scan-item-card.tsx")

    expect(source).toContain("rounded-lg bg-card")
    expect(source).not.toContain("rounded-lg bg-background")
    expect(source).not.toContain("hover:bg-muted/50")
  })

  it("keeps usage analysis pages on the shared list-page rhythm", async () => {
    const source = await readModuleSource("../usage-analysis/shared/components/usage-analysis-shell.tsx")

    expect(source).toContain('className="flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden bg-surface"')
    expect(source).toContain('className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-2 px-2 py-2.5"')
    expect(source).toContain('className="min-h-full min-w-full w-0 max-w-full overflow-x-hidden px-2 pb-2 pt-0"')
    expect(source).not.toContain("border-b")
  })

  it("keeps workflow list pages on the shared list-page rhythm", async () => {
    const moduleSource = await readModuleSource("../workflow/index.tsx")
    const modulePageSource = await readModuleSource("../../components/module-page.tsx")
    const listSource = await readModuleSource("../workflow/components/workflow-list.tsx")
    const cardSource = await readModuleSource("../workflow/components/workflow-card.tsx")

    expect(moduleSource).toContain("<ModulePage")
    expect(moduleSource).toContain('title="工作流"')
    expect(moduleSource).toContain("afterContent={(")
    expect(modulePageSource).toContain('className="flex h-full min-h-0 flex-col bg-surface"')
    expect(listSource).toContain("<ModuleContentPanel>")
    expect(listSource).toContain('<Table className="min-w-[52rem] table-fixed">')
    expect(cardSource).toContain("<TableRow")
    expect(cardSource).not.toContain("<Item")
    expect(cardSource).not.toContain("hover:bg-muted/50")
  })

  it("keeps model price pages aligned with the shared module page shell", async () => {
    const moduleSource = await readModuleSource("../model-price/index.tsx")
    const coverageSource = await readModuleSource("../model-price/components/model-coverage-view.tsx")
    const rulesSource = await readModuleSource("../model-price/components/price-rules-view.tsx")

    expect(moduleSource).toContain("<SystemAppWindowShell")
    expect(moduleSource).toContain("tabs={MODEL_PRICE_VIEWS.map")
    expect(moduleSource).not.toContain('title="价格"')
    expect(coverageSource).toContain('<ModuleContentPanel className="overflow-hidden')
    expect(coverageSource).toContain('<Table className="table-fixed" containerClassName="overflow-x-hidden" scrollbars="none">')
    expect(coverageSource).not.toContain("min-w-[72rem]")
    expect(rulesSource).toContain('<ModuleContentPanel className="min-w-0 max-w-full overflow-hidden">')
    expect(rulesSource).toContain('<Table containerClassName="min-w-0 max-w-full" className="min-w-[60rem] table-fixed">')
  })
})
