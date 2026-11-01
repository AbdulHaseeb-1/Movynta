import { useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { providersLoaded, providersSchema } from "@/features/providers";
import { backendRequest, errorMessage } from "@/lib/backend";
import { settingsButtonClass } from "./styles";

export function BackendConnection() {
  const connected = useAppSelector((state) => state.providers.connected);
  const dispatch = useAppDispatch();
  const [message, setMessage] = useState("");
  async function reconnect() {
    try {
      dispatch(
        providersLoaded(await backendRequest("/providers", providersSchema)),
      );
      setMessage("Connected");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }
  return (
    <div className="flex max-w-lg flex-col gap-5">
      <h2 id="general-settings-heading" className="text-[17px] font-semibold">
        General
      </h2>
      <div>
        <h3 className="text-sm font-medium">Backend connection</h3>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {connected
            ? "Connected automatically to your local backend."
            : "Waiting for your local backend. Start it to connect automatically."}
        </p>
      </div>
      <Button
        variant="outline"
        onClick={() => void reconnect()}
        className={`${settingsButtonClass} self-start`}
      >
        Reconnect
      </Button>
      <output className="text-xs text-muted-foreground">{message}</output>
    </div>
  );
}
