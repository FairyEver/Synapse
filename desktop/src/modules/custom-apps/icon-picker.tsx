import { Globe } from "lucide-react"

type CustomAppIconPreviewProps = {
  readonly src: string | null
  readonly size?: "sm" | "lg"
}

export function CustomAppIconPreview({ src, size = "sm" }: CustomAppIconPreviewProps) {
  const className = size === "lg" ? "size-16 rounded-xl" : "size-5 rounded-md"
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={`${className} shrink-0 object-contain`}
        onError={(event) => { event.currentTarget.hidden = true }}
      />
    )
  }
  return <Globe aria-hidden="true" className={`${className} shrink-0 text-muted-foreground`} />
}
