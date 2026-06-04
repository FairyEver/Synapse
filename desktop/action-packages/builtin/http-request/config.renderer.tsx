import { Input } from "../../../src/components/ui/input"
import { Textarea } from "../../../src/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "../../../src/components/ui/toggle-group"
import { Separator } from "../../../src/components/ui/separator"
import type { HttpRequestActionConfig } from "./schema"
import { KvEditor } from "./kv-editor"
import { CodeJsonEditor } from "./code-json-editor"
import { AuthFields } from "./auth-fields"
import { RequestTester } from "./request-tester"

const HTTP_METHOD_OPTIONS: Array<{ label: string; value: HttpRequestActionConfig["method"] }> = [
  { label: "GET", value: "GET" },
  { label: "POST", value: "POST" },
  { label: "PUT", value: "PUT" },
  { label: "PATCH", value: "PATCH" },
  { label: "DELETE", value: "DELETE" },
]

const BODY_TYPE_OPTIONS: Array<{ label: string; value: HttpRequestActionConfig["bodyType"] }> = [
  { label: "无", value: "none" },
  { label: "JSON", value: "json" },
  { label: "Text", value: "text" },
]

export function HttpRequestConfigForm({
  value,
  onChange,
  idPrefix = "task-action-http",
}: {
  readonly value: HttpRequestActionConfig
  readonly onChange: (value: HttpRequestActionConfig) => void
  readonly idPrefix?: string
}) {
  const bodyDisabled = value.method === "GET"

  return (
    <div className="flex flex-col gap-2">
      {/* Method + URL */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <ToggleGroup
            aria-label="方法"
            className="shrink-0"
            type="single"
            value={value.method}
            variant="outline"
            onValueChange={(method) => {
              if (!method) return
              const nextMethod = method as HttpRequestActionConfig["method"]
              onChange(nextMethod === "GET"
                ? { ...value, method: nextMethod, bodyType: "none", body: undefined }
                : { ...value, method: nextMethod })
            }}
          >
            {HTTP_METHOD_OPTIONS.map((opt) => (
              <ToggleGroupItem
                key={opt.value}
                id={`${idPrefix}-method-${opt.value}`}
                className="px-2 py-1 text-xs h-7"
                value={opt.value}
              >
                {opt.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <Input
          id={`${idPrefix}-url`}
          placeholder="https://api.example.com/v1/endpoint"
          className="h-8 text-xs"
          value={value.url}
          onChange={(e) => onChange({ ...value, url: e.target.value })}
        />
      </div>

      <Separator />

      {/* Auth */}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-muted-foreground">认证</p>
        <AuthFields
          value={value.auth}
          onChange={(auth) => onChange({ ...value, auth })}
          idPrefix={idPrefix}
        />
      </div>

      <Separator />

      {/* Query */}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-muted-foreground">Query</p>
        <KvEditor
          value={value.query ?? {}}
          onChange={(query) => onChange({ ...value, query: Object.keys(query).length > 0 ? query : undefined })}
          keyPlaceholder="参数名"
          valuePlaceholder="参数值"
          addButtonLabel="+ 添加参数"
          emptyMessage="无查询参数"
        />
      </div>

      <Separator />

      {/* Headers */}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-muted-foreground">Headers</p>
        <KvEditor
          value={value.headers ?? {}}
          onChange={(headers) => onChange({ ...value, headers: Object.keys(headers).length > 0 ? headers : undefined })}
          keyPlaceholder="Header 名"
          valuePlaceholder="Header 值"
          addButtonLabel="+ 添加 Header"
          emptyMessage="无自定义 Header"
        />
      </div>

      <Separator />

      {/* Body */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-muted-foreground">Body</p>
          <ToggleGroup
            aria-label="Body"
            className="ml-auto"
            type="single"
            value={bodyDisabled ? "none" : value.bodyType}
            variant="outline"
            onValueChange={(bodyType) => {
              if (bodyType && !bodyDisabled) {
                onChange({ ...value, bodyType: bodyType as HttpRequestActionConfig["bodyType"] })
              }
            }}
          >
            {BODY_TYPE_OPTIONS.map((opt) => (
              <ToggleGroupItem
                key={opt.value}
                id={`${idPrefix}-body-type-${opt.value}`}
                className="px-2 py-1 text-xs h-7"
                value={opt.value}
                disabled={bodyDisabled && opt.value !== "none"}
              >
                {opt.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        {!bodyDisabled && value.bodyType === "json" ? (
          <CodeJsonEditor
            value={value.body ?? ""}
            onChange={(body) => onChange({ ...value, body })}
          />
        ) : !bodyDisabled && value.bodyType === "text" ? (
          <Textarea
            id={`${idPrefix}-body`}
            rows={4}
            className="text-xs"
            value={value.body ?? ""}
            onChange={(e) => onChange({ ...value, body: e.target.value })}
          />
        ) : null}
      </div>

      <Separator />

      {/* Timeout */}
      <div className="flex items-center gap-2">
        <p className="text-xs font-medium text-muted-foreground shrink-0">超时分钟</p>
        <Input
          id={`${idPrefix}-timeout`}
          type="number"
          min={1}
          className="h-8 w-20 text-xs"
          value={value.timeoutMins ?? ""}
          onChange={(e) =>
            onChange({
              ...value,
              timeoutMins: e.target.value ? Number(e.target.value) : null,
            })
          }
        />
      </div>

      <Separator />

      {/* Request Tester */}
      <RequestTester config={value} />
    </div>
  )
}
