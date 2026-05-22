import type { ReactNode } from "react"

type ContentEditorWindowLayoutProps = {
  auxiliary: ReactNode
  body: ReactNode
  footer: ReactNode
  meta: ReactNode
  title: string
}

function ContentEditorWindowLayout({
  auxiliary,
  body,
  footer,
  meta,
  title,
}: ContentEditorWindowLayoutProps) {
  return (
    <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      <header className="border-b px-4 py-3">
        <h1 className="text-base font-medium">{title}</h1>
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-[18rem_minmax(0,1fr)_22rem] overflow-hidden">
        <aside className="min-h-0 overflow-auto border-r p-4">
          {meta}
        </aside>
        <section className="min-h-0 overflow-hidden p-4">
          {body}
        </section>
        <aside className="min-h-0 overflow-auto border-l p-4">
          {auxiliary}
        </aside>
      </main>
      <footer className="border-t px-4 py-3">
        {footer}
      </footer>
    </div>
  )
}

export { ContentEditorWindowLayout }
