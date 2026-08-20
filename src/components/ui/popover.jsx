import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverAnchor = PopoverPrimitive.Anchor

// Is there anything between the wheel and the popover's own box that can still
// move in the direction being scrolled? A list already at its bottom answers
// no, so scrolling never chains out to whatever is behind the popover.
const absorbsWheel = (container, event) => {
  const vertical = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
  const delta = vertical ? event.deltaY : event.deltaX
  if (!delta) return false

  for (let el = event.target; el instanceof Element; el = el.parentElement) {
    const overflow = window.getComputedStyle(el)[vertical ? "overflowY" : "overflowX"]
    if (overflow === "auto" || overflow === "scroll") {
      // scrollLeft runs negative in RTL, so compare distances, not signs.
      const scrolled = vertical ? el.scrollTop : Math.abs(el.scrollLeft)
      const room = vertical
        ? el.scrollHeight - el.clientHeight
        : el.scrollWidth - el.clientWidth
      if (delta > 0 ? scrolled < room - 1 : scrolled > 0) return true
    }
    if (el === container) break
  }
  return false
}

// A popover is portaled to <body>, so one opened inside a dialog lands OUTSIDE
// that dialog's scroll lock — react-remove-scroll only lets through wheels over
// nodes the DialogContent itself contains. Everything else it reads as "the
// page behind the dialog is being scrolled" and cancels. That is why the size
// list in "הזמנה חדשה" would only move by dragging its scrollbar: dragging a
// scrollbar isn't a wheel event, so it was the one gesture left.
//
// The lock listens on `document`, so keeping the event from getting that far is
// the whole fix. Nothing is preventDefault-ed — the browser scrolls the list
// natively, exactly as it does for the same popover on a plain page.
//
// (React delegates its events at the portal container, i.e. <body>, which is
// above us on the bubble path — so an onWheel prop inside a popover would not
// fire. Nothing in the app uses one.)
const useWheelThroughScrollLock = (forwardedRef) => {
  const detach = React.useRef(null)

  return React.useCallback((node) => {
    if (detach.current) {
      detach.current()
      detach.current = null
    }

    if (typeof forwardedRef === "function") forwardedRef(node)
    else if (forwardedRef) forwardedRef.current = node

    if (!node) return
    const onWheel = (event) => {
      if (absorbsWheel(node, event)) event.stopPropagation()
    }
    node.addEventListener("wheel", onWheel)
    detach.current = () => node.removeEventListener("wheel", onWheel)
  }, [forwardedRef])
}

const PopoverContent = React.forwardRef(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={useWheelThroughScrollLock(ref)}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props} />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
