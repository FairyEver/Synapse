import { FileText, FolderOpen } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { SynapseToolDefinition, SynapseToolInputField } from "@/types/tools"

export function GeneratedToolForm(props: {
  readonly tool: SynapseToolDefinition
  readonly values: Record<string, unknown>
  readonly disabled?: boolean
  readonly onChange: (fieldId: string, value: unknown) => void
  readonly onSelectFile: (fieldId: string) => void
  readonly onSelectDirectory: (fieldId: string) => void
}) {
  return (
    <div className="grid gap-3">
      {props.tool.inputFields.filter((field) => fieldVisible(field, props.values)).map((field) => (
        <div key={field.id} className="grid gap-1.5">
          <Label htmlFor={field.id}>{field.label}</Label>
          <FieldControl
            field={field}
            value={props.values[field.id]}
            disabled={props.disabled}
            onChange={(value) => props.onChange(field.id, value)}
            onSelectFile={() => props.onSelectFile(field.id)}
            onSelectDirectory={() => props.onSelectDirectory(field.id)}
          />
        </div>
      ))}
    </div>
  )
}

function FieldControl(props: {
  readonly field: SynapseToolInputField
  readonly value: unknown
  readonly disabled?: boolean
  readonly onChange: (value: unknown) => void
  readonly onSelectFile: () => void
  readonly onSelectDirectory: () => void
}) {
  if (props.field.kind === "file") {
    return (
      <div className="flex items-center gap-2">
        <Input id={props.field.id} value={typeof props.value === "string" ? props.value : ""} readOnly />
        <Button type="button" variant="outline" disabled={props.disabled} onClick={props.onSelectFile}>
          <FileText data-icon="inline-start" />
          选择文件
        </Button>
      </div>
    )
  }
  if (props.field.kind === "directory") {
    return (
      <div className="flex items-center gap-2">
        <Input id={props.field.id} value={typeof props.value === "string" ? props.value : ""} readOnly />
        <Button type="button" variant="outline" disabled={props.disabled} onClick={props.onSelectDirectory}>
          <FolderOpen data-icon="inline-start" />
          选择目录
        </Button>
      </div>
    )
  }
  if (props.field.kind === "select") {
    return (
      <Select
        disabled={props.disabled}
        value={typeof props.value === "string" ? props.value : props.field.defaultValue ?? ""}
        onValueChange={props.onChange}
      >
        <SelectTrigger id={props.field.id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {props.field.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (props.field.kind === "checkbox") {
    return (
      <Checkbox
        id={props.field.id}
        disabled={props.disabled}
        checked={Boolean(props.value ?? props.field.defaultValue)}
        onCheckedChange={(checked) => props.onChange(checked === true)}
      />
    )
  }
  if (props.field.kind === "number") {
    return (
      <Input
        id={props.field.id}
        type="number"
        disabled={props.disabled}
        value={typeof props.value === "number" ? props.value : props.field.defaultValue ?? ""}
        min={props.field.min}
        max={props.field.max}
        onChange={(event) => props.onChange(event.target.value === "" ? "" : Number(event.target.value))}
      />
    )
  }
  return (
    <Input
      id={props.field.id}
      disabled={props.disabled}
      value={typeof props.value === "string" ? props.value : props.field.defaultValue ?? ""}
      onChange={(event) => props.onChange(event.target.value)}
    />
  )
}

function fieldVisible(field: SynapseToolInputField, values: Record<string, unknown>): boolean {
  if (!("when" in field) || !field.when) return true
  return values[field.when.field] === field.when.equals
}

