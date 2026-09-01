"use client"

import { Collapsible as CollapsiblePrimitive } from "radix-ui"
import { track } from "@/lib/ui-tracking"

function Collapsible({
  "data-track": dataTrack,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root> & {
  "data-track"?: string
}) {
  return (
    <CollapsiblePrimitive.Root
      data-slot="collapsible"
      onOpenChange={(open) => {
        track({ component: "collapsible", name: dataTrack ?? "collapsible", action: open ? "expand" : "collapse", eventKey: dataTrack })
        onOpenChange?.(open)
      }}
      {...props}
    />
  )
}

function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      data-slot="collapsible-trigger"
      {...props}
    />
  )
}

function CollapsibleContent({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      {...props}
    />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
