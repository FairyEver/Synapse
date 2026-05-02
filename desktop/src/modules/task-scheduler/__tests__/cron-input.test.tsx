import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { CronEditorFields } from "../components/cron-editor-dialog"
import { CronInput } from "../components/cron-input"
import {
  createDefaultCronTemplateDraft,
  validateCronExpression,
} from "../cron-utils"

describe("CronInput", () => {
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
