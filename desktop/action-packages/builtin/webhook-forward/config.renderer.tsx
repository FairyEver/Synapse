import { ConfigurationFieldError, configurationFieldProps } from "../../../src/components/configuration-field-error"
import { Field, FieldContent, FieldLabel } from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import type { ActionConfigFormComponent } from "../../../src/action-runtime/action-registry"
import type { WebhookForwardActionConfig } from "./schema"

export const WebhookForwardConfigForm: ActionConfigFormComponent<WebhookForwardActionConfig> = ({ value, onChange, fieldErrors }) => (
  <Field>
    <FieldLabel htmlFor="webhook-forward-url">URL</FieldLabel>
    <FieldContent>
      <Input {...configurationFieldProps(fieldErrors, "url", "webhook-forward-url")} id="webhook-forward-url" value={value.url} onChange={event => onChange({ url: event.target.value })} />
      <ConfigurationFieldError errors={fieldErrors} name="url" id="webhook-forward-url" />
    </FieldContent>
  </Field>
)
