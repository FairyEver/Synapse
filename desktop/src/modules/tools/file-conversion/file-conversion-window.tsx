import { useMemo, useState } from "react"
import {
  CheckCircle2,
  FileText,
  FolderOpen,
  Loader2,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"

import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import type { SynapseFileConversionResult } from "@/types/tools"
import { errorDiagnostic } from "@/modules/workflow/lib/error-utils"
import { fileNameFromPath, summarizeConversionResult } from "./utils"

const logger = createRendererLogger("tools.file-conversion")

export function FileConversionWindow() {
  const [filePaths, setFilePaths] = useState<readonly string[]>([])
  const [outputDirectory, setOutputDirectory] = useState<string | null>(null)
  const [converting, setConverting] = useState(false)
  const [result, setResult] = useState<SynapseFileConversionResult | null>(null)

  const canConvert = filePaths.length > 0 && outputDirectory !== null && !converting
  const summary = useMemo(() => result ? summarizeConversionResult(result) : null, [result])

  async function handleSelectFiles(): Promise<void> {
    try {
      const selection = await requireBridgeDomain("tools").fileConversion.selectInputFiles()
      if (selection.filePaths.length > 0) {
        setFilePaths(selection.filePaths)
        setResult(null)
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
      const selection = await requireBridgeDomain("tools").fileConversion.selectOutputDirectory()
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2.5">
        <h1 className="text-sm font-semibold">文件转换</h1>
        <Button size="sm" disabled={!canConvert} onClick={() => void handleConvert()}>
          {converting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <FileText data-icon="inline-start" />}
          转换
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <main className="grid gap-3 p-3">
          <Card>
            <CardHeader>
              <CardTitle>文件</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div>
                <Button variant="outline" onClick={() => void handleSelectFiles()}>
                  <FileText data-icon="inline-start" />
                  选择文件
                </Button>
              </div>
              {filePaths.length > 0 ? (
                <ul className="grid gap-1 text-sm">
                  {filePaths.map((filePath) => (
                    <li key={filePath} className="truncate text-muted-foreground" title={filePath}>
                      {fileNameFromPath(filePath)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>输出目录</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div>
                <Button variant="outline" onClick={() => void handleSelectOutputDirectory()}>
                  <FolderOpen data-icon="inline-start" />
                  选择目录
                </Button>
              </div>
              {outputDirectory ? (
                <div className="truncate text-sm text-muted-foreground" title={outputDirectory}>
                  {outputDirectory}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {result ? (
            <Card>
              <CardHeader>
                <CardTitle>{summary}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                {result.successes.length > 0 ? (
                  <ul className="grid gap-1 text-sm">
                    {result.successes.map((item) => (
                      <li key={`${item.sourcePath}:${item.outputPath}`} className="flex min-w-0 items-center gap-2">
                        <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate" title={item.outputPath}>{fileNameFromPath(item.outputPath)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {result.failures.length > 0 ? (
                  <ul className="grid gap-1 text-sm">
                    {result.failures.map((item) => (
                      <li key={`${item.sourcePath}:${item.reason}`} className="flex min-w-0 items-center gap-2 text-muted-foreground">
                        <XCircle className="size-4 shrink-0" />
                        <span className="truncate" title={item.message}>{fileNameFromPath(item.sourcePath)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </main>
      </ScrollArea>
    </div>
  )
}
