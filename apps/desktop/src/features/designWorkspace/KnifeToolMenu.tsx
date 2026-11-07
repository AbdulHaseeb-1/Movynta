import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { parseSnapAngle } from "./knifeSettings";
import { setKnifeSettings } from "./workspaceSlice";
interface Props {
  start: (onlySelected?: boolean) => void;
  disabled: boolean;
}
export function KnifeToolMenu({ start, disabled }: Props) {
  const dispatch = useAppDispatch(),
    settings = useAppSelector((state) => state.designWorkspace.knifeSettings);
  return (
    <div className="flex items-center">
      <Button
        size="sm"
        variant="ghost"
        className="h-7 rounded-sm px-2 text-[11px]"
        disabled={disabled}
        onClick={() => start(false)}
        aria-keyshortcuts="K"
        title="Knife · K"
      >
        Knife
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            className="size-6"
            disabled={disabled}
            aria-label="Knife settings"
          >
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Knife settings</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => start(true)}>
            Cut selected faces · Shift+K
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              dispatch(setKnifeSettings({ cutThrough: !settings.cutThrough }));
            }}
          >
            Occlude geometry: {settings.cutThrough ? "Off" : "On"} · C
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              dispatch(setKnifeSettings({ xray: !settings.xray }));
            }}
          >
            X-ray path: {settings.xray ? "On" : "Off"} · V
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              dispatch(
                setKnifeSettings({ measures: (settings.measures + 1) % 4 }),
              );
            }}
          >
            Measurements:{" "}
            {["Off", "Distance", "Angles", "Both"][settings.measures]} · S
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Angle snapping · A</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={String(settings.angleMode)}
            onValueChange={(value) => {
              const angleMode = Number(value);
              if ([0, 1, 2].includes(angleMode))
                dispatch(setKnifeSettings({ angleMode }));
            }}
          >
            <DropdownMenuRadioItem value="0">Off</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="1">Screen</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="2">
              Relative to surface edge
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <label htmlFor="knife-angle" className="grid gap-1 px-2 py-2 text-xs">
            Snap increment (degrees)
            <Input
              id="knife-angle"
              type="number"
              min="0"
              max="180"
              step="any"
              defaultValue={settings.angle}
              onChange={(event) => {
                // Saved as it is typed: closing the menu removes the field without a blur, which lost the value.
                const angle = parseSnapAngle(event.target.value);
                if (angle !== null) dispatch(setKnifeSettings({ angle }));
              }}
              onBlur={(event) => {
                if (parseSnapAngle(event.target.value) === null)
                  event.target.value = String(settings.angle);
              }}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </label>
          <p className="px-2 pb-2 text-[11px] text-muted-foreground">
            Draw across full faces. Enter confirms; Esc cancels. Interior
            endpoints and loose edges are unsupported.
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
