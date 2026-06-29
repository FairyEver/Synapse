import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/components/ui/dialog", () => ({
  DialogContent: ({ children, className }: { readonly children: ReactNode; readonly className?: string }) => (
    <div data-slot="dialog-content" className={className}>{children}</div>
  ),
  DialogDescription: ({ children }: { readonly children: ReactNode }) => <p>{children}</p>,
  DialogFrame: ({ children, className }: { readonly children: ReactNode; readonly className?: string }) => (
    <div data-slot="dialog-frame" className={className}>{children}</div>
  ),
  DialogFrameBody: ({ children, className }: { readonly children: ReactNode; readonly className?: string }) => (
    <div data-slot="dialog-frame-body" className={className}>{children}</div>
  ),
  DialogFrameFooter: ({ children, className }: { readonly children: ReactNode; readonly className?: string }) => (
    <div data-slot="dialog-frame-footer" className={className}>{children}</div>
  ),
  DialogFrameHeader: ({
    description,
    title,
  }: {
    readonly description?: ReactNode
    readonly title: ReactNode
  }) => (
    <header>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
    </header>
  ),
  DialogFooter: ({ children, className }: { readonly children: ReactNode; readonly className?: string }) => (
    <div className={className}>{children}</div>
  ),
  DialogHeader: ({ children, className }: { readonly children: ReactNode; readonly className?: string }) => (
    <div className={className}>{children}</div>
  ),
  DialogTitle: ({ children }: { readonly children: ReactNode }) => <h2>{children}</h2>,
}))

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({
    children,
    className,
  }: {
    readonly children: ReactNode
    readonly className?: string
  }) => <div data-slot="scroll-area" className={className}>{children}</div>,
}))

import { FormDialog } from "@/components/form-dialog"

describe("FormDialog", () => {
  it("keeps body padding inside the scroll content", () => {
    const html = renderToStaticMarkup(
      <FormDialog
        title="新建提示词"
        footer={<button type="submit">保存</button>}
        onSubmit={(event) => event.preventDefault()}
      >
        <input aria-label="标题" />
      </FormDialog>,
    )

    expect(html).not.toContain('data-slot="scroll-area" class="min-h-0 flex-1 px-5 py-4"')
    expect(html).toContain('class="px-5 py-4"')
  })

  it("applies bodyClassName to the inner content wrapper", () => {
    const html = renderToStaticMarkup(
      <FormDialog
        title="编辑任务"
        bodyClassName="overflow-hidden"
        footer={<button type="submit">保存</button>}
        onSubmit={(event) => event.preventDefault()}
      >
        <div>表单</div>
      </FormDialog>,
    )

    expect(html).not.toContain('data-slot="scroll-area" class="min-h-0 flex-1 px-5 py-4 overflow-hidden"')
    expect(html).toContain('class="px-5 py-4 overflow-hidden"')
  })
})
