import { Clock, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../api/client";
import type { ExternalTime } from "../types";

const RESYNC_INTERVAL_MS = 60_000;
const TICK_INTERVAL_MS = 1_000;

export default function LiveClock() {
  const [externalTime, setExternalTime] = useState<ExternalTime | null>(null);
  const [displayTime, setDisplayTime] = useState<Date | null>(null);
  const [error, setError] = useState(false);
  const baseReceivedAtRef = useRef<number>(0);

  async function syncTime() {
    try {
      const { data } = await api.get<ExternalTime>("/system/time");
      setExternalTime(data);
      baseReceivedAtRef.current = Date.now();
      setDisplayTime(new Date(data.datetime));
      setError(false);
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    syncTime();
    const resyncId = setInterval(syncTime, RESYNC_INTERVAL_MS);
    return () => clearInterval(resyncId);
  }, []);

  useEffect(() => {
    if (!externalTime) return;
    const tickId = setInterval(() => {
      const elapsed = Date.now() - baseReceivedAtRef.current;
      setDisplayTime(new Date(new Date(externalTime.datetime).getTime() + elapsed));
    }, TICK_INTERVAL_MS);
    return () => clearInterval(tickId);
  }, [externalTime]);

  if (error && !displayTime) {
    return (
      <div className="flex items-center gap-1.5 text-slate-400 text-sm">
        <WifiOff size={16} />
        <span>Time unavailable</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-1.5">
      <Clock size={16} className="text-brand-600" />
      <div className="leading-tight">
        <div className="font-mono text-sm font-semibold text-slate-800">
          {displayTime ? displayTime.toLocaleTimeString() : "--:--:--"}
        </div>
        <div className="text-[10px] text-slate-400">
          {externalTime?.timezone ?? "syncing..."}
          {externalTime?.source === "local_fallback" && " (local)"}
        </div>
      </div>
    </div>
  );
}
