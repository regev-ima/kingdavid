import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef(({ className, ...props }, ref) => {
  return (
    (<textarea
      className={cn(
        "flex min-h-[60px] w-full rounded-lg border border-border bg-white px-3.5 py-2.5 text-sm placeholder:text-muted-foreground/70 transition-all duration-200 hover:border-border/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/10 focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props} />)
  );
})
Textarea.displayName = "Textarea"

export { Textarea }
