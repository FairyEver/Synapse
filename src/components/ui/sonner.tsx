import type { CSSProperties } from "react"
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { cn } from "@/lib/utils"

function resolveTheme(): ToasterProps["theme"] {
  if (typeof document === "undefined") {
    return "light"
  }

  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

function Toaster({ className, icons, style, theme, toastOptions, ...props }: ToasterProps) {
  return (
    <Sonner
      theme={theme ?? resolveTheme()}
      className={cn("toaster group", className)}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
        ...icons,
      }}
      style={{
        "--normal-bg": "var(--popover)",
        "--normal-text": "var(--popover-foreground)",
        "--normal-border": "var(--border)",
        "--border-radius": "var(--radius)",
        ...style,
      } as CSSProperties}
      toastOptions={{
        ...toastOptions,
        classNames: {
          toast: "cn-toast",
          ...toastOptions?.classNames,
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
