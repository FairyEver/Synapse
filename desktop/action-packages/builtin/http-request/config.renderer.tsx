import { Field, FieldContent, FieldGroup, FieldLabel } from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../src/components/ui/select"
import { Textarea } from "../../../src/components/ui/textarea"
import { parseRecordText, stringifyRecordText } from "../../records"
import type { HttpRequestActionConfig } from "./schema"

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
        <FieldLabel htmlFor="task-action-http-method">方法</FieldLabel>
        <FieldContent>
          <Select
            value={value.method}
            onValueChange={(method) =>
              onChange({ ...value, method: method as HttpRequestActionConfig["method"] })
            }
          >
            <SelectTrigger id="task-action-http-method" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="GET">GET</SelectItem>
                <SelectItem value="POST">POST</SelectItem>
                <SelectItem value="PUT">PUT</SelectItem>
                <SelectItem value="PATCH">PATCH</SelectItem>
                <SelectItem value="DELETE">DELETE</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
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
        <FieldLabel htmlFor="task-action-http-body-type">Body</FieldLabel>
        <FieldContent>
          <Select
            value={value.bodyType}
            onValueChange={(bodyType) =>
              onChange({ ...value, bodyType: bodyType as HttpRequestActionConfig["bodyType"] })
            }
          >
            <SelectTrigger id="task-action-http-body-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="none">无</SelectItem>
                <SelectItem value="json">JSON</SelectItem>
                <SelectItem value="text">Text</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
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
