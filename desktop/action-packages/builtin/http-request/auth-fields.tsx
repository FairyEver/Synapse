import { Input } from "../../../src/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "../../../src/components/ui/toggle-group"

interface AuthConfig {
  readonly type: "none" | "bearer" | "basic"
  readonly bearerToken?: string
  readonly basicUsername?: string
  readonly basicPassword?: string
}

interface AuthFieldsProps {
  readonly value: AuthConfig | undefined
  readonly onChange: (value: AuthConfig | undefined) => void
  readonly idPrefix?: string
}

const AUTH_TYPE_OPTIONS: Array<{ label: string; value: AuthConfig["type"] }> = [
  { label: "无", value: "none" },
  { label: "Bearer Token", value: "bearer" },
  { label: "Basic Auth", value: "basic" },
]

export function AuthFields({ value, onChange, idPrefix = "auth" }: AuthFieldsProps) {
  const auth = value ?? { type: "none" as const }

  return (
    <div className="flex flex-col gap-2">
      <ToggleGroup
        aria-label="认证类型"
        className="w-full"
        type="single"
        value={auth.type}
        variant="outline"
        onValueChange={(type) => {
          if (type) onChange({ type: type as AuthConfig["type"] })
        }}
      >
        {AUTH_TYPE_OPTIONS.map((opt) => (
          <ToggleGroupItem key={opt.value} className="flex-1" value={opt.value} id={`${idPrefix}-type-${opt.value}`}>
            {opt.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {auth.type === "bearer" && (
        <Input
          id={`${idPrefix}-bearer-token`}
          type="password"
          placeholder="Bearer Token"
          className="h-8 text-xs"
          value={auth.bearerToken ?? ""}
          onChange={(e) => onChange({ ...auth, bearerToken: e.target.value })}
        />
      )}

      {auth.type === "basic" && (
        <div className="flex flex-col gap-2">
          <Input
            id={`${idPrefix}-basic-username`}
            placeholder="Username"
            className="h-8 text-xs"
            value={auth.basicUsername ?? ""}
            onChange={(e) => onChange({ ...auth, basicUsername: e.target.value })}
          />
          <Input
            id={`${idPrefix}-basic-password`}
            type="password"
            placeholder="Password"
            className="h-8 text-xs"
            value={auth.basicPassword ?? ""}
            onChange={(e) => onChange({ ...auth, basicPassword: e.target.value })}
          />
        </div>
      )}
    </div>
  )
}
