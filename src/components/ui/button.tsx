import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[6px] text-sm font-medium leading-[1.43] tracking-normal transition-[background-color,color,box-shadow,outline-color] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsla(212,100%,48%,1)] aria-invalid:outline-destructive",
  {
    variants: {
      variant: {
        default: "bg-foreground text-background shadow-[rgba(0,0,0,0.08)_0px_0px_0px_1px] hover:bg-black",
        destructive: "bg-destructive text-destructive-foreground shadow-[rgba(0,0,0,0.08)_0px_0px_0px_1px] hover:bg-[#e65045]",
        outline: "bg-card text-foreground surface-border-light hover:bg-secondary",
        secondary: "bg-card text-foreground surface-border-light hover:bg-foreground hover:text-background",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        link: "text-[#0072f5] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 has-[>svg]:px-3",
        sm: "h-9 gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-11 px-6 has-[>svg]:px-4",
        icon: "size-9",
        pill: "h-8 rounded-full px-3.5 text-[12px] font-medium leading-[1.33]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button"

  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
