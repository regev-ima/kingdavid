"use client";
import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner"

// App-wide toast surface. `richColors` gives success/error/warning their own
// color + icon (far more visual than the old plain card), `closeButton` adds a
// working X, and `duration` guarantees every toast auto-dismisses — the old
// shadcn toaster never dismissed, so notifications got stuck on screen.
const Toaster = ({
  ...props
}) => {
  const { theme = "system" } = useTheme()

  return (
    (<Sonner
      theme={theme}
      className="toaster group"
      position="bottom-right"
      richColors
      closeButton
      duration={4000}
      toastOptions={{
        classNames: {
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props} />)
  );
}

export { Toaster }
