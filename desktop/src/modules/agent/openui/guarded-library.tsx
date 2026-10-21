import { Component, createContext, createElement, useContext, type ReactNode } from "react"
import type { ComponentRenderProps } from "@openuidev/react-lang"
import { openuiLibrary } from "@openuidev/react-ui"
import { hasUnsafeGeneratedUiResource } from "@/lib/agent-generated-ui"
import { redactSensitiveValue } from "@/lib/agent-redaction"

export const GeneratedUiFailureContext = createContext<(error: Error) => void>(() => undefined)

/** Stop a failed component before the upstream auto-recovery boundary can retry it. */
class OfficialComponentBoundary extends Component<{ children: ReactNode; onFailure: (error: Error) => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { this.props.onFailure(error) }
  render() { return this.state.failed ? null : this.props.children }
}

// Keep every official schema and renderer. Check evaluated props before a renderer
// can mount resource-loading elements; source checks alone cannot cover bindings.
export const guardedOpenuiLibrary = {
  ...openuiLibrary,
  components: Object.fromEntries(Object.entries(openuiLibrary.components).map(([name, definition]) => {
    function CheckedOfficialComponent(input: ComponentRenderProps) {
      if (hasUnsafeGeneratedUiResource({ typeName: name, props: input.props })) throw new Error("界面包含不支持的资源。")
      return createElement(definition.component, { ...input, props: redactSensitiveValue(input.props) as Record<string, unknown> })
    }
    function GuardedOfficialComponent(input: ComponentRenderProps) {
      const onFailure = useContext(GeneratedUiFailureContext)
      return <OfficialComponentBoundary onFailure={onFailure}><CheckedOfficialComponent {...input} /></OfficialComponentBoundary>
    }
    return [name, { ...definition, component: GuardedOfficialComponent }]
  })),
}
