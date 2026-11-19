import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import { cn } from "cn"

// 올려 두면 이름이 뜨기까지 기다리는 시간(ms). 기본값(600)은 길어서 짧게 둔다.
// 하나가 뜬 뒤 옆 도구로 옮기면 기다림 없이 바로 뜬다(Provider 로 묶었을 때).
const TOOLTIP_DELAY_MS = 100

function TooltipProvider({
  delay = TOOLTIP_DELAY_MS,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider delay={delay} {...props} />
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 6,
  className,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn("z-50 w-max max-w-xs origin-(--transform-origin) rounded-md bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 ease-out motion-safe:data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 motion-safe:data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", className )}
          {...props}
        />
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
