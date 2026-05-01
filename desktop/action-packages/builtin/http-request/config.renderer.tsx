import { Field, FieldContent, FieldGroup, FieldLabel } from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import { Textarea } from "../../../src/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "../../../src/components/ui/toggle-group"
import { parseRecordText, stringifyRecordText } from "../../records"
import type { HttpRequestActionConfig } from "./schema"

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
}: {
  readonly value: HttpRequestActionConfig
  readonly onChange: (value: HttpRequestActionConfig) => void
}) {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="task-action-http-method-GET">方法</FieldLabel>
        <FieldContent>
          <ToggleGroup
            aria-label="方法"
            className="w-full"
            data-track="task-action-http-method"
            type="single"
            value={value.method}
            variant="outline"
            onValueChange={(method) => {
              if (method) onChange({ ...value, method: method as HttpRequestActionConfig["method"] })
            }}
          >
            {HTTP_METHOD_OPTIONS.map((option) => (
              <ToggleGroupItem
                key={option.value}
                id={`task-action-http-method-${option.value}`}
                className="flex-1"
                value={option.value}
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel htmlFor="task-action-http-url">URL</FieldLabel>
        <FieldContent>
          <Input
            id="task-action-http-url"
            value={value.url}
            onChange={(event) => onChange({ ...value, url: event.target.value })}
          />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel htmlFor="task-action-http-query">Query</FieldLabel>
        <FieldContent>
          <Textarea
            id="task-action-http-query"
            rows={3}
            value={stringifyRecordText(value.query)}
            onChange={(event) => onChange({ ...value, query: parseRecordText(event.target.value) })}
          />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel htmlFor="task-action-http-headers">Headers</FieldLabel>
        <FieldContent>
          <Textarea
            id="task-action-http-headers"
            rows={3}
            value={stringifyRecordText(value.headers)}
            onChange={(event) => onChange({ ...value, headers: parseRecordText(event.target.value) })}
          />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel htmlFor="task-action-http-body-type-none">Body</FieldLabel>
        <FieldContent>
          <ToggleGroup
            aria-label="Body"
            className="w-full"
            data-track="task-action-http-body-type"
            type="single"
            value={value.bodyType}
            variant="outline"
            onValueChange={(bodyType) => {
              if (bodyType) onChange({ ...value, bodyType: bodyType as HttpRequestActionConfig["bodyType"] })
            }}
          >
            {BODY_TYPE_OPTIONS.map((option) => (
              <ToggleGroupItem
                key={option.value}
                id={`task-action-http-body-type-${option.value}`}
                className="flex-1"
                value={option.value}
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FieldContent>
      </Field>
      {value.bodyType === "none" ? null : (
        <Field>
          <FieldLabel htmlFor="task-action-http-body">内容</FieldLabel>
          <FieldContent>
            <Textarea
              id="task-action-http-body"
              rows={5}
              value={value.body ?? ""}
              onChange={(event) => onChange({ ...value, body: event.target.value })}
            />
          </FieldContent>
        </Field>
      )}
      <Field>
        <FieldLabel htmlFor="task-action-http-timeout">超时分钟</FieldLabel>
        <FieldContent>
          <Input
            id="task-action-http-timeout"
            type="number"
            min={1}
            value={value.timeoutMins ?? ""}
            onChange={(event) =>
              onChange({
                ...value,
                timeoutMins: event.target.value ? Number(event.target.value) : null,
              })
            }
          />
        </FieldContent>
      </Field>
    </FieldGroup>
  )
}
