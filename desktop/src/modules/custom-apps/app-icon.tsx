import { useState } from "react"
import { Globe } from "lucide-react"
import type { AppIconDescriptor } from "./app-adapter"

type AppEntryIconProps = {
  readonly icon?: AppIconDescriptor
  readonly className?: string
}

export function AppEntryIcon({ icon, className = "size-5" }: AppEntryIconProps) {
  const [failed, setFailed] = useState(false)
  if (icon?.kind === "image" && !failed) {
    return (
      <img
        data-app-icon
        src={icon.src}
        alt=""
        className={`${className} shrink-0 object-contain`}
        onError={() => setFailed(true)}
      />
    )
  }
  if (icon?.kind === "lucide") {
    const Icon = icon.icon
    return <Icon aria-hidden="true" className={className} />
  }
  return <Globe aria-hidden="true" className={className} />
}
