import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-[background-color,color,box-shadow,border-color] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 outline-none focus-visible:ring-[3px] focus-visible:ring-[#3898ec]/25 aria-invalid:border-destructive aria-invalid:ring-destructive/20",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[0_0_0_1px_#c96442] hover:bg-[#bc5d3f]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[0_0_0_1px_#b53333] hover:bg-[#9f2d2d] focus-visible:ring-destructive/20",
        outline: "border border-border bg-card text-foreground hover:bg-secondary",
        secondary: "bg-secondary text-secondary-foreground shadow-[0_0_0_1px_#d1cfc5] hover:bg-[#dfdccf]",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2 has-[>svg]:px-3",
        sm: "h-9 gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-11 px-6 has-[>svg]:px-4",
        icon: "size-9",
        pill: "h-8 rounded-full px-3.5 text-sm",
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
