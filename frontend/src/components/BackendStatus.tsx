"use client";

import { useEffect, useState } from "react";

import { API_URL, getHealth } from "@/lib/api";
import type { Health } from "@/lib/types";

type State = { kind: "checking" } | { kind: "online"; health: Health } | { kind: "offline" };

export default function BackendStatus() {
  const [state, setState] = useState<State>({ kind: "checking" });

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const health = await getHealth();
        if (!cancelled) setState({ kind: "online", health });
      } catch {
        if (!cancelled) setState({ kind: "offline" });
      }
    };
    check();
    const id = setInterval(check, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  let dot = "bg-slate-500";
  let label = "Connecting…";
  let title = API_URL;
  if (state.kind === "offline") {
    dot = "bg-red-500";
    label = "Backend offline";
    title = `No response from ${API_URL}`;
  } else if (state.kind === "online") {
    const m = state.health.model;
    const name = m.weights.split(/[\\/]/).pop();
    if (m.error) {
      dot = "bg-amber-500";
      label = "Model error";
      title = m.error;
    } else {
      dot = "bg-emerald-500 animate-pulse";
      label = m.loaded ? `${name} ready` : `Online · ${name} loads on first run`;
    }
  }

  return (
    <div title={title} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 font-mono text-xs text-slate-300">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </div>
  );
}
