import { getViewportForBounds, type Rect } from "@xyflow/react"
import { toPng } from "html-to-image"

import { normalizeContentFileNameSegment } from "@/lib/content-attachments"

const WORKFLOW_IMAGE_PADDING = 32
const WORKFLOW_IMAGE_PIXEL_RATIO = 2

interface ExportWorkflowViewportAsPngOptions {
  readonly viewport: HTMLElement
  readonly bounds: Rect
  readonly workflowName: string
}

async function exportWorkflowViewportAsPng({
  viewport,
  bounds,
  workflowName,
}: ExportWorkflowViewportAsPngOptions): Promise<void> {
  assertExportableBounds(bounds)

  const width = Math.ceil(bounds.width + WORKFLOW_IMAGE_PADDING * 2)
  const height = Math.ceil(bounds.height + WORKFLOW_IMAGE_PADDING * 2)
  const { x, y, zoom } = getViewportForBounds(
    bounds,
    width,
    height,
    1,
    1,
    `${WORKFLOW_IMAGE_PADDING}px`,
  )
  const dataUrl = await toPng(viewport, {
    backgroundColor: "white",
    height,
    pixelRatio: WORKFLOW_IMAGE_PIXEL_RATIO,
    style: {
      height: `${height}px`,
      transform: `translate(${x}px, ${y}px) scale(${zoom})`,
      width: `${width}px`,
    },
    width,
  })

  const link = document.createElement("a")
  link.download = workflowPngFileName(workflowName)
  link.href = dataUrl
  link.click()
}

function workflowPngFileName(workflowName: string): string {
  const trimmedName = workflowName.trim()
  const baseName = trimmedName
    ? normalizeContentFileNameSegment(trimmedName)
    : "workflow"
  return `${baseName}.png`
}

function assertExportableBounds(bounds: Rect): void {
  const values = [bounds.x, bounds.y, bounds.width, bounds.height]
  if (values.some((value) => !Number.isFinite(value)) || bounds.width <= 0 || bounds.height <= 0) {
    throw new Error("Workflow nodes are not ready for image export.")
  }
}

export {
  exportWorkflowViewportAsPng,
  workflowPngFileName,
}
