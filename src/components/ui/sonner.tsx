import { useEffect, useState, type CSSProperties } from "react"
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
  const [resolvedTheme, setResolvedTheme] = useState<ToasterProps["theme"]>(() => resolveTheme())

  useEffect(() => {
    if (theme || typeof document === "undefined") {
      return
    }

    const root = document.documentElement
    const observer = new MutationObserver(() => {
      setResolvedTheme(resolveTheme())
    })

    observer.observe(root, {
      attributeFilter: ["class"],
      attributes: true,
    })

    return () => {
      observer.disconnect()
    }
  }, [theme])

  return (
    <Sonner
      theme={theme ?? resolvedTheme}
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
          closeButton: cn(
            "border-border bg-popover text-popover-foreground hover:border-border hover:bg-muted hover:text-popover-foreground",
            toastOptions?.classNames?.closeButton,
          ),
          ...toastOptions?.classNames,
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
