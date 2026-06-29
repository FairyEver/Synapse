import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TagInput } from "@/components/ui/tag-input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFrame,
  DialogFrameBody,
  DialogFrameFooter,
  DialogFrameHeader,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { ColumnKind, DatabaseTableSchema } from "@/types/database"
import { createRendererLogger } from "@/app-shell/logging"
import { sanitizeTrackValue } from "@/lib/ui-tracking"
import {
  COLUMN_KINDS,
  formatChoicesSummary,
  getColumnKindDisplayName,
  getColumnKindLabel,
} from "./database-column-types"
import { ChoicesEditorDialog } from "./choices-editor-dialog"

const logger = createRendererLogger("database.schema")

type TableSchemaSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  schema: DatabaseTableSchema | null
  onAddColumn: (name: string, kind: ColumnKind, description?: string, choices?: string[]) => void
  onUpdateTableDescription: (description: string) => Promise<void> | void
  onUpdateColumnDescription: (column: string, description: string) => void
  onUpdateColumnChoices: (column: string, choices: string[]) => Promise<void>
  onDropTable: () => void
}

function TableSchemaSheet({
  open,
  onOpenChange,
  schema,
  onAddColumn,
  onUpdateTableDescription,
  onUpdateColumnDescription,
  onUpdateColumnChoices,
  onDropTable,
}: TableSchemaSheetProps) {
  const [newColName, setNewColName] = useState("")
  const [newColKind, setNewColKind] = useState<ColumnKind>("text")
  const [newColDesc, setNewColDesc] = useState("")
  const [newColChoices, setNewColChoices] = useState<string[]>([])
  const [tableDescription, setTableDescription] = useState("")
  const [isTableDescriptionSaving, setIsTableDescriptionSaving] = useState(false)
  const [editingCol, setEditingCol] = useState<string | null>(null)
  const [editingDesc, setEditingDesc] = useState("")
  const [editingChoicesCol, setEditingChoicesCol] = useState<string | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const skipTableDescriptionCommitRef = useRef(false)

  const editingChoicesColumn = useMemo(
    () => (schema && editingChoicesCol ? schema.columns.find((c) => c.name === editingChoicesCol) ?? null : null),
    [schema, editingChoicesCol],
  )

  useEffect(() => {
    setTableDescription(schema?.description ?? "")
  }, [schema?.description, schema?.name])

  useEffect(() => {
    if (!open) {
      setEditingChoicesCol(null)
    }
  }, [open])

  const commitTableDescription = useCallback(async () => {
    if (skipTableDescriptionCommitRef.current) {
      skipTableDescriptionCommitRef.current = false
      return
    }

    if (!schema) return

    const nextDescription = tableDescription.trim()
    if (nextDescription === schema.description) return

    setIsTableDescriptionSaving(true)
    try {
      await onUpdateTableDescription(nextDescription)
    } finally {
      setIsTableDescriptionSaving(false)
    }
  }, [onUpdateTableDescription, schema, tableDescription])

  const handleAddColumn = useCallback(() => {
    const trimmed = newColName.trim()
    if (!trimmed) return
    const isChoiceKind = newColKind === "single_choice" || newColKind === "multi_choice"
    const choices = isChoiceKind && newColChoices.length > 0
      ? newColChoices
      : undefined
    if (isChoiceKind && (!choices || choices.length === 0)) return
    logger.info("Column add submitted from schema dialog.", {
      table: schema?.name ?? null,
      column: trimmed,
      kind: newColKind,
      description: sanitizeTrackValue("description", newColDesc),
      choiceCount: choices?.length ?? 0,
    })
    onAddColumn(trimmed, newColKind, newColDesc.trim() || undefined, choices)
    setNewColName("")
    setNewColKind("text")
    setNewColDesc("")
    setNewColChoices([])
  }, [newColName, newColKind, newColDesc, newColChoices, onAddColumn, schema?.name])

  const startEditDescription = useCallback((colName: string, currentDesc: string) => {
    logger.info("Column description edit started.", {
      table: schema?.name ?? null,
      column: colName,
    })
    setEditingCol(colName)
    setEditingDesc(currentDesc)
    setTimeout(() => editInputRef.current?.focus(), 0)
  }, [schema?.name])

  const commitEditDescription = useCallback(() => {
    if (editingCol) {
      logger.info("Column description edit submitted.", {
        table: schema?.name ?? null,
        column: editingCol,
        description: sanitizeTrackValue(editingCol, editingDesc),
      })
      onUpdateColumnDescription(editingCol, editingDesc.trim())
      setEditingCol(null)
    }
  }, [editingCol, editingDesc, onUpdateColumnDescription, schema?.name])

  if (!schema) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange} data-track="database-schema-dialog">
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-[600px]"
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (document.activeElement?.id === "table-description") {
            event.preventDefault()
          }
        }}
      >
        <DialogFrame>
          <DialogFrameHeader title={`${schema.name} 表结构`} />

          <DialogFrameBody>
            <ScrollArea className="h-full max-h-[calc(100vh-12rem)] min-h-0">
              <div className="flex min-h-0 flex-col gap-5 px-5 py-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="table-description">表备注</Label>
                  <Input
                    id="table-description"
                    data-track="database-table-description"
                    value={tableDescription}
                    disabled={isTableDescriptionSaving}
                    onChange={(event) => setTableDescription(event.target.value)}
                    onBlur={() => {
                      void commitTableDescription()
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur()
                      }
                      if (event.key === "Escape") {
                        skipTableDescriptionCommitRef.current = true
                        setTableDescription(schema.description)
                        event.currentTarget.blur()
                      }
                    }}
                  />
                </div>

                <ScrollArea className="min-h-0 rounded-md border" scrollbars="both">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>列名</TableHead>
                        <TableHead>类型</TableHead>
                        <TableHead>说明</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {schema.columns.map((col) => (
                        <TableRow key={col.name}>
                          <TableCell className="font-mono text-sm">{col.name}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span>{getColumnKindDisplayName(col.kind)}</span>
                              {(col.kind === "single_choice" || col.kind === "multi_choice") && col.choices && col.choices.length > 0 ? (
                                <>
                                  <span className="text-xs text-muted-foreground">· {formatChoicesSummary(col.choices)}</span>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="size-6 text-muted-foreground hover:text-foreground"
                                    data-track="database-column-choices-open"
                                    onClick={() => {
                                      logger.info("Column choices editor opened.", {
                                        table: schema.name,
                                        column: col.name,
                                      })
                                      setEditingChoicesCol(col.name)
                                    }}
                                    title="编辑选项"
                                  >
                                    <Pencil className="size-3" />
                                  </Button>
                                </>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {col.system ? (
                              col.primaryKey ? "自增主键" : col.name === "created_at" ? "创建时间，自动生成" : "更新时间，自动更新"
                            ) : editingCol === col.name ? (
                              <Input
                                ref={editInputRef}
                                className="h-7 text-xs"
                                data-track="database-column-description"
                                value={editingDesc}
                                onChange={(e) => setEditingDesc(e.target.value)}
                                onBlur={commitEditDescription}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") commitEditDescription()
                                  if (e.key === "Escape") setEditingCol(null)
                                }}
                                placeholder="列说明"
                              />
                            ) : (
                              <span
                                className="cursor-pointer rounded px-1 py-0.5 hover:bg-muted"
                                onClick={() => startEditDescription(col.name, col.description ?? "")}
                              >
                                {col.description || "点击添加说明"}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>

                <div className="flex flex-col gap-2">
                  <Label>添加列</Label>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7.5rem_minmax(0,1.25fr)_auto]">
                    <Input
                      data-track="database-add-column-name"
                      value={newColName}
                      onChange={(e) => setNewColName(e.target.value)}
                      placeholder="列名"
                    />
                    <Select data-track="database-add-column-kind" value={newColKind} onValueChange={(v) => setNewColKind(v as ColumnKind)}>
                      <SelectTrigger className="w-full">
                        <SelectValue>{getColumnKindLabel(newColKind)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {COLUMN_KINDS.map((t) => (
                          <SelectItem key={t} value={t}>
                            {getColumnKindLabel(t)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      data-track="database-add-column-description"
                      value={newColDesc}
                      onChange={(e) => setNewColDesc(e.target.value)}
                      placeholder="用途说明，帮助 AI 理解此列"
                      className="text-xs"
                    />
                    <Button
                      className="w-full sm:w-auto"
                      data-track="database-add-column-submit"
                      onClick={handleAddColumn}
                      disabled={!newColName.trim()}
                    >
                      添加
                    </Button>
                  </div>
                  {newColKind === "single_choice" || newColKind === "multi_choice" ? (
                    <TagInput
                      value={newColChoices}
                      data-track="database-add-column-choices"
                      onChange={setNewColChoices}
                      placeholder="输入后按回车添加"
                      className="text-xs"
                    />
                  ) : null}
                </div>
              </div>
            </ScrollArea>
          </DialogFrameBody>

          {editingChoicesColumn ? (
            <ChoicesEditorDialog
              open={!!editingChoicesCol}
              onOpenChange={(next) => { if (!next) setEditingChoicesCol(null) }}
              table={schema.name}
              column={editingChoicesColumn.name}
              kind={editingChoicesColumn.kind === "multi_choice" ? "multi_choice" : "single_choice"}
              initialChoices={editingChoicesColumn.choices ?? []}
              onSave={(choices) => onUpdateColumnChoices(editingChoicesColumn.name, choices)}
            />
          ) : null}

          <DialogFrameFooter className="sm:items-center sm:justify-between">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" data-track="database-drop-table-open">删除此表</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认删除</AlertDialogTitle>
                  <AlertDialogDescription>
                    确定要删除表 "{schema.name}" 吗？此操作不可撤销，所有数据将被永久删除。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction data-track="database-drop-table-confirm" onClick={onDropTable}>删除</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <DialogClose asChild>
              <Button variant="outline" data-track="database-schema-close">关闭</Button>
            </DialogClose>
          </DialogFrameFooter>
        </DialogFrame>
      </DialogContent>
    </Dialog>
  )
}

export { TableSchemaSheet }
