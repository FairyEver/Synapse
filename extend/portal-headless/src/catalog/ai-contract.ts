/** Authoritative business contracts consumed by describe(), page descriptions and documentation. */
export type AiField = {
  path: string
  type: string
  meaning: string
  optional?: boolean
  nullable?: boolean
  values?: Record<string, string>
  format?: string
  unit?: string
  constraints?: string[]
  nullMeaning?: string
  source?: string
}

export type AiParameter = {
  options?: Array<{ value: string | number; label: string }>
  type?: string
  required?: boolean
  requiredWhen?: string
  nullable?: boolean
  omitted?: string
  unit?: string
  nullMeaning?: string
  meaning: string
  source: string
  format?: string
  default?: string
  constraints?: string[]
  lookup?: { capabilityId: string; args: Record<string, unknown>; valueField: string; labelField: string }
}

export type AiContract = {
  purpose: string
  whenToUse: string
  boundaries: string[]
  effect: 'read' | 'prepare' | 'write' | 'local'
  prerequisites: string[]
  /** Parameters augment the existing definition, including nested object fields. */
  inputs: Record<string, AiParameter>
  output: {
    shape: string
    fields: AiField[]
    empty: string
    /** Only runtime-defined structures may use this; the path must really be callable. */
    dynamic?: { sdkPath: string; args: Record<string, unknown>; instructions: string }
  }
  consume: string[]
  steps: Array<{
    role: 'required' | 'optional' | 'recovery' | 'cancel'
    when: string
    capabilityId?: string
    sdkPath?: string
    mapping?: Record<string, string>
    instruction: string
  }>
  completion: string
  failures: string[]
  idempotency: string | null
  evidence: Array<{ source: string; kind: 'implementation' | 'browser' | 'smoke' | 'test' | 'reference'; note: string }>
  /** Concrete missing evidence; nonempty means this contract is not complete. */
  gaps?: string[]
  examples?: Array<{ scenario: string; args: Record<string, unknown>; result: unknown; interpretation: string }>
}
