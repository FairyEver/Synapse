import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react"
import {
  CheckCircle2,
  FileText,
  FolderOpen,
  FolderSearch,
  Loader2,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"

import { createRendererLogger } from "@/app-shell/logging"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { ScrollArea } from "@/components/ui/scroll-area"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import { errorDiagnostic } from "@/modules/workflow/lib/error-utils"
import type { SynapseFileConversionResult } from "@/types/tools"
import {
  fileNameFromPath,
  isSupportedConversionFile,
  summarizeConversionResult,
  supportedConversionExtensionsLabel,
} from "./utils"

const logger = createRendererLogger("tools.file-conversion")

function samePathList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function appendUniquePaths(basePaths: readonly string[], nextPaths: readonly string[]): readonly string[] {
  const seen = new Set(basePaths)
  const merged = [...basePaths]
  for (const filePath of nextPaths) {
    if (!seen.has(filePath)) {
      seen.add(filePath)
      merged.push(filePath)
    }
  }
  return merged
}

function resultBadge(result: SynapseFileConversionResult): {
  readonly label: string
  readonly variant: "secondary" | "destructive"
} {
  if (result.failures.length === 0) return { label: "完成", variant: "secondary" }
  if (result.successes.length === 0) return { label: "失败", variant: "destructive" }
  return { label: "部分完成", variant: "secondary" }
}

export function FileConversionWindow() {
  const [filePaths, setFilePaths] = useState<readonly string[]>([])
  const [outputDirectory, setOutputDirectory] = useState<string | null>(null)
  const [outputDirectoryLoading, setOutputDirectoryLoading] = useState(true)
  const [converting, setConverting] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [result, setResult] = useState<SynapseFileConversionResult | null>(null)

  const canConvert = filePaths.length > 0 && outputDirectory !== null && !converting
  const summary = useMemo(() => result ? summarizeConversionResult(result) : null, [result])
  const resultStatus = useMemo(() => result ? resultBadge(result) : null, [result])
  const supportedExtensions = supportedConversionExtensionsLabel()

  useEffect(() => {
    let canceled = false

    async function loadDefaultOutputDirectory(): Promise<void> {
      try {
        const selection = await requireBridgeDomain("tools").fileConversion.getDefaultOutputDirectory()
        if (!canceled) {
          setOutputDirectory((current) => current ?? selection.directoryPath)
        }
      } catch (error) {
        logger.warn("File conversion default output directory loading failed.", {
          boundary: "renderer.tools.file-conversion.default-output",
          ...errorDiagnostic(error),
        })
        if (!canceled) {
          toast.error("读取下载目录失败")
        }
      } finally {
        if (!canceled) {
          setOutputDirectoryLoading(false)
        }
      }
    }

    void loadDefaultOutputDirectory()
    return () => {
      canceled = true
    }
  }, [])

  const setInputFiles = useCallback((nextPaths: readonly string[], mode: "replace" | "append") => {
    const supportedPaths = nextPaths.filter(isSupportedConversionFile)
    const unsupportedCount = nextPaths.length - supportedPaths.length
    if (unsupportedCount > 0) {
      toast.error(`仅支持 ${supportedExtensions} 文件`)
    }
    if (supportedPaths.length === 0) return

    const nextFilePaths = mode === "replace"
      ? appendUniquePaths([], supportedPaths)
      : appendUniquePaths(filePaths, supportedPaths)

    if (!samePathList(filePaths, nextFilePaths)) {
      setFilePaths(nextFilePaths)
      setResult(null)
    }
  }, [filePaths, supportedExtensions])

  async function handleSelectFiles(): Promise<void> {
    try {
      const selection = await requireBridgeDomain("tools").fileConversion.selectInputFiles()
      if (selection.filePaths.length > 0) {
        setInputFiles(selection.filePaths, "replace")
      }
    } catch (error) {
      logger.warn("File conversion input selection failed.", {
        boundary: "renderer.tools.file-conversion.select-input",
        ...errorDiagnostic(error),
      })
      toast.error("选择文件失败")
    }
  }

  async function handleSelectOutputDirectory(): Promise<void> {
    try {
      const selection = await requireBridgeDomain("tools").fileConversion.selectOutputDirectory(
        outputDirectory ? { defaultPath: outputDirectory } : undefined,
      )
      if (selection.directoryPath) {
        setOutputDirectory(selection.directoryPath)
        setResult(null)
      }
    } catch (error) {
      logger.warn("File conversion output directory selection failed.", {
        boundary: "renderer.tools.file-conversion.select-output",
        ...errorDiagnostic(error),
      })
      toast.error("选择目录失败")
    }
  }

  function handleRemoveFile(filePath: string): void {
    setFilePaths((current) => current.filter((item) => item !== filePath))
    setResult(null)
  }

  function handleClearFiles(): void {
    setFilePaths([])
    setResult(null)
  }

  async function handleConvert(): Promise<void> {
    if (!canConvert || outputDirectory === null) return
    setConverting(true)
    try {
      const nextResult = await requireBridgeDomain("tools").fileConversion.convert({
        filePaths,
        outputDirectory,
      })
      setResult(nextResult)
      toast.success(summarizeConversionResult(nextResult))
    } catch (error) {
      logger.warn("File conversion failed.", {
        boundary: "renderer.tools.file-conversion.convert",
        ...errorDiagnostic(error),
      })
      toast.error("转换失败")
    } finally {
      setConverting(false)
    }
  }

  async function handleShowItemInFolder(filePath: string): Promise<void> {
    try {
      await requireBridgeDomain("shell").showItemInFolder(filePath)
    } catch (error) {
      logger.warn("File conversion output reveal failed.", {
        boundary: "renderer.tools.file-conversion.show-output",
        ...errorDiagnostic(error),
      })
      toast.error("打开文件位置失败")
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    if (converting) {
      event.dataTransfer.dropEffect = "none"
      return
    }
    event.dataTransfer.dropEffect = "copy"
    setIsDragging(true)
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>): void {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
    setIsDragging(false)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    setIsDragging(false)
    if (converting) return
    const tools = requireBridgeDomain("tools")
    const droppedPaths = Array.from(event.dataTransfer.files)
      .map((file) => tools.fileConversion.filePathForDroppedFile(file))
      .filter((filePath): filePath is string => Boolean(filePath))
    setInputFiles(droppedPaths, "append")
  }

  return (
    <div
      aria-label="文件转换窗口"
      className="relative flex h-full min-h-0 flex-col bg-surface"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/80 p-6">
          <div className="flex items-center gap-2 rounded-lg border border-dashed bg-card px-5 py-4 text-sm font-medium text-card-foreground">
            <Upload />
            松开添加文件
          </div>
        </div>
      ) : null}

      <ScrollArea className="min-h-0 flex-1">
        <main className="grid gap-3 p-3">
          <Card size="sm">
            <CardHeader>
              <div>
                <CardTitle>文件</CardTitle>
                <CardDescription>{filePaths.length > 0 ? `${filePaths.length} 个文件` : supportedExtensions}</CardDescription>
              </div>
              <CardAction className="flex items-center gap-2">
                {filePaths.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={converting}
                    onClick={handleClearFiles}
                  >
                    <Trash2 data-icon="inline-start" />
                    清空
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={converting}
                  onClick={() => void handleSelectFiles()}
                >
                  <FileText data-icon="inline-start" />
                  添加文件
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {filePaths.length === 0 ? (
                <Empty className="min-h-52 border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Upload />
                    </EmptyMedia>
                    <EmptyTitle>拖入文件或选择文件</EmptyTitle>
                    <EmptyDescription>{supportedExtensions}</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={converting}
                      onClick={() => void handleSelectFiles()}
                    >
                      <FileText data-icon="inline-start" />
                      选择文件
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : (
                <ItemGroup>
                  {filePaths.map((filePath) => (
                    <Item key={filePath} variant="muted">
                      <ItemMedia variant="icon">
                        <FileText />
                      </ItemMedia>
                      <ItemContent className="min-w-0">
                        <ItemTitle className="max-w-full truncate" title={filePath}>
                          {fileNameFromPath(filePath)}
                        </ItemTitle>
                        <ItemDescription data-allow-select="true" className="max-w-full truncate" title={filePath}>
                          {filePath}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={converting}
                          aria-label={`移除 ${fileNameFromPath(filePath)}`}
                          onClick={() => handleRemoveFile(filePath)}
                        >
                          <X />
                        </Button>
                      </ItemActions>
                    </Item>
                  ))}
                </ItemGroup>
              )}
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <div>
                <CardTitle>输出位置</CardTitle>
                <CardDescription>{outputDirectoryLoading ? "读取中" : "Markdown"}</CardDescription>
              </div>
              <CardAction>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={converting || outputDirectoryLoading}
                  onClick={() => void handleSelectOutputDirectory()}
                >
                  <FolderOpen data-icon="inline-start" />
                  更改
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <Item variant="muted">
                <ItemMedia variant="icon">
                  <FolderOpen />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle>{outputDirectory ? fileNameFromPath(outputDirectory) : "输出目录"}</ItemTitle>
                  <ItemDescription data-allow-select="true" className="max-w-full truncate" title={outputDirectory ?? undefined}>
                    {outputDirectoryLoading ? "读取中" : outputDirectory ?? "选择输出目录"}
                  </ItemDescription>
                </ItemContent>
              </Item>
            </CardContent>
          </Card>

          {result ? (
            <Card size="sm">
              <CardHeader>
                <div>
                  <CardTitle>{summary}</CardTitle>
                  <CardDescription>{outputDirectory}</CardDescription>
                </div>
                {resultStatus ? (
                  <CardAction>
                    <Badge variant={resultStatus.variant}>{resultStatus.label}</Badge>
                  </CardAction>
                ) : null}
              </CardHeader>
              <CardContent className="grid gap-3">
                {result.successes.length > 0 ? (
                  <ItemGroup>
                    {result.successes.map((item) => (
                      <Item key={`${item.sourcePath}:${item.outputPath}`} variant="muted">
                        <ItemMedia variant="icon">
                          <CheckCircle2 />
                        </ItemMedia>
                        <ItemContent className="min-w-0">
                          <ItemTitle className="max-w-full truncate" title={item.outputPath}>
                            {fileNameFromPath(item.outputPath)}
                          </ItemTitle>
                          <ItemDescription data-allow-select="true" className="max-w-full truncate" title={item.outputPath}>
                            {item.outputPath}
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void handleShowItemInFolder(item.outputPath)}
                          >
                            <FolderSearch data-icon="inline-start" />
                            在文件夹中显示
                          </Button>
                        </ItemActions>
                      </Item>
                    ))}
                  </ItemGroup>
                ) : null}
                {result.failures.length > 0 ? (
                  <ItemGroup>
                    {result.failures.map((item) => (
                      <Item key={`${item.sourcePath}:${item.reason}`} variant="muted">
                        <ItemMedia variant="icon">
                          <XCircle />
                        </ItemMedia>
                        <ItemContent className="min-w-0">
                          <ItemTitle className="max-w-full truncate" title={item.sourcePath}>
                            {fileNameFromPath(item.sourcePath)}
                          </ItemTitle>
                          <ItemDescription className="max-w-full truncate" title={item.message}>
                            {item.message}
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions>
                          <Badge variant="destructive">失败</Badge>
                        </ItemActions>
                      </Item>
                    ))}
                  </ItemGroup>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </main>
      </ScrollArea>

      <div className="flex shrink-0 justify-end border-t bg-background px-3 py-3">
        <Button disabled={!canConvert} onClick={() => void handleConvert()}>
          {converting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <FileText data-icon="inline-start" />}
          转换
        </Button>
      </div>
    </div>
  )
}
