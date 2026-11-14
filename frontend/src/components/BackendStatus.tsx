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

  let dot = "bg-mist-faint";
  let label = "Connecting";
  let detail = API_URL;
  if (state.kind === "offline") {
    dot = "bg-alert";
    label = "Server offline";
    detail = `No response from ${API_URL}. Start the backend and this updates automatically.`;
  } else if (state.kind === "online") {
    const m = state.health.model;
    const name = m.weights.split(/[\\/]/).pop() ?? m.weights;
    if (m.error) {
      dot = "bg-marker";
      label = "Model error";
      detail = m.error;
    } else {
      dot = "bg-contour";
      label = m.loaded ? "Ready" : "Online";
      detail = m.loaded ? `${name} loaded` : `${name} loads on the first analysis`;
    }
  }

  return (
    <div
      title={detail}
      role="status"
      className="flex items-center gap-2 rounded-full border border-petrol-600 bg-petrol-900 py-1.5 pl-2.5 pr-3 text-xs text-mist"
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span>{label}</span>
      <span className="hidden max-w-[220px] truncate text-mist-faint md:inline">{state.kind === "online" ? detail : ""}</span>
    </div>
  );
}
