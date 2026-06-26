/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createDriveMarkdownImageUploader: vi.fn(),
  uploaderUpload: vi.fn(),
  mdxEditor: vi.fn(),
  headingsPlugin: vi.fn(() => ({ name: "headings" })),
  listsPlugin: vi.fn(() => ({ name: "lists" })),
  quotePlugin: vi.fn(() => ({ name: "quote" })),
  linkPlugin: vi.fn(() => ({ name: "link" })),
  linkDialogPlugin: vi.fn(() => ({ name: "linkDialog" })),
  imagePlugin: vi.fn(() => ({ name: "image" })),
  tablePlugin: vi.fn(() => ({ name: "table" })),
  thematicBreakPlugin: vi.fn(() => ({ name: "thematicBreak" })),
  codeBlockPlugin: vi.fn(() => ({ name: "codeBlock" })),
  codeMirrorPlugin: vi.fn(() => ({ name: "codeMirror" })),
  diffSourcePlugin: vi.fn(() => ({ name: "diffSource" })),
  markdownShortcutPlugin: vi.fn(() => ({ name: "markdownShortcut" })),
  toolbarPlugin: vi.fn(() => ({ name: "toolbar" })),
}))

type MdxEditorProps = {
  readonly markdown: string
  readonly plugins: readonly { readonly name: string }[]
  readonly onChange: (markdown: string) => void
  readonly contentEditableClassName?: string
}

type ToolbarPluginConfig = {
  readonly toolbarContents: () => null
}

type ImagePluginConfig = {
  readonly imageUploadHandler: (file: File) => Promise<string>
}

vi.mock("@mdxeditor/editor/style.css", () => ({}))

vi.mock("@mdxeditor/editor", () => ({
  MDXEditor: (props: MdxEditorProps) => {
    mocks.mdxEditor(props)
    return <div data-testid="mdx-editor">{props.markdown}</div>
  },
  headingsPlugin: mocks.headingsPlugin,
  listsPlugin: mocks.listsPlugin,
  quotePlugin: mocks.quotePlugin,
  linkPlugin: mocks.linkPlugin,
  linkDialogPlugin: mocks.linkDialogPlugin,
  imagePlugin: mocks.imagePlugin,
  tablePlugin: mocks.tablePlugin,
  thematicBreakPlugin: mocks.thematicBreakPlugin,
  codeBlockPlugin: mocks.codeBlockPlugin,
  codeMirrorPlugin: mocks.codeMirrorPlugin,
  diffSourcePlugin: mocks.diffSourcePlugin,
  markdownShortcutPlugin: mocks.markdownShortcutPlugin,
  toolbarPlugin: mocks.toolbarPlugin,
}))

vi.mock("../drive-markdown-image-uploader", () => ({
  createDriveMarkdownImageUploader: mocks.createDriveMarkdownImageUploader,
}))

import { DriveMdxEditor } from "../drive-mdx-editor"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  mocks.uploaderUpload.mockResolvedValue("https://synapse.test/files/image.png")
  mocks.createDriveMarkdownImageUploader.mockReturnValue({ upload: mocks.uploaderUpload })
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("DriveMdxEditor", () => {
  it("renders the provided markdown without controlling editor changes as local state", async () => {
    const onDirtyChange = vi.fn()

    await renderEditor({
      markdown: "# First",
      onDirtyChange,
    })

    const props = lastMdxEditorProps()
    expect(document.body.textContent).toContain("# First")
    expect(props.contentEditableClassName).toBe("prose max-w-none")
    expect(props.plugins.map((plugin) => plugin.name)).toEqual([
      "headings",
      "lists",
      "quote",
      "link",
      "linkDialog",
      "image",
      "table",
      "thematicBreak",
      "codeBlock",
      "codeMirror",
      "diffSource",
      "markdownShortcut",
      "toolbar",
    ])

    await act(async () => {
      props.onChange("# Changed")
    })

    expect(onDirtyChange).toHaveBeenCalledWith(true)
    expect(document.body.textContent).toContain("# First")
    expect(document.body.textContent).not.toContain("# Changed")
    expect(mocks.diffSourcePlugin).toHaveBeenCalledWith({ viewMode: "rich-text", diffMarkdown: "" })
    expect(mocks.toolbarPlugin).toHaveBeenCalledWith({ toolbarContents: expect.any(Function) })
    expect(firstPluginConfig<ToolbarPluginConfig>(mocks.toolbarPlugin).toolbarContents()).toBeNull()
  })

  it("uploads pasted or dropped images through the Drive markdown uploader", async () => {
    const onUploadingChange = vi.fn()
    await renderEditor({ onUploadingChange })

    const imageUploadHandler = firstPluginConfig<ImagePluginConfig>(mocks.imagePlugin).imageUploadHandler
    const file = new File(["image"], "image.png", { type: "image/png" })

    await expect(imageUploadHandler(file)).resolves.toBe("https://synapse.test/files/image.png")

    expect(mocks.createDriveMarkdownImageUploader).toHaveBeenCalledTimes(1)
    expect(mocks.uploaderUpload).toHaveBeenCalledWith(file)
    expect(onUploadingChange.mock.calls).toEqual([[true], [false]])
  })
})

async function renderEditor(
  overrides: Partial<Parameters<typeof DriveMdxEditor>[0]> = {},
): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <DriveMdxEditor
        markdown=""
        onDirtyChange={vi.fn()}
        onUploadingChange={vi.fn()}
        {...overrides}
      />,
    )
  })
}

function lastMdxEditorProps(): MdxEditorProps {
  return mocks.mdxEditor.mock.calls.at(-1)?.[0] as MdxEditorProps
}

function firstPluginConfig<T>(mock: { mock: { calls: readonly (readonly unknown[])[] } }): T {
  const call = mock.mock.calls[0]
  if (!call) {
    throw new Error("Plugin was not called.")
  }
  return call[0] as T
}
