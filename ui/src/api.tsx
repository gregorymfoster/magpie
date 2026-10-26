// Reads go through TanStack Query, keyed by [command, args]. Nothing polls:
// the core pushes events and this file decides what each one refetches.

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Args, CommandName, Job, Result } from "@magpie/core";
import type { Transport } from "./transport/index.ts";

const Ctx = createContext<Transport | null>(null);

export function CoreProvider({ transport, children }: { transport: Transport; children: ReactNode }) {
  const qc = useQueryClient();
  useEffect(
    () =>
      transport.on((e) => {
        if (e.type === "library.changed") qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "settings.get" && q.queryKey[0] !== "devices.list" });
        if (e.type === "settings.changed") qc.invalidateQueries({ queryKey: ["settings.get"] });
        if (e.type === "job") {
          qc.setQueryData<Result<"app.state">>(["app.state", undefined], (s) => s && { ...s, jobs: upsert(s.jobs, e.job) });
          if (e.job.state === "done" || e.job.state === "cancelled") qc.invalidateQueries();
        }
      }),
    [transport, qc],
  );
  return <Ctx.Provider value={transport}>{children}</Ctx.Provider>;
}

function upsert(jobs: Job[], job: Job) {
  return jobs.some((j) => j.id === job.id) ? jobs.map((j) => (j.id === job.id ? job : j)) : [...jobs, job];
}

export function useTransport(): Transport {
  const t = useContext(Ctx);
  if (!t) throw new Error("no transport");
  return t;
}

/** A read. Re-runs when an event says its data changed. */
export function useCall<K extends CommandName>(command: K, args?: Args<K>, opts: { enabled?: boolean; every?: number } = {}) {
  const t = useTransport();
  // Keep showing the last answer while a new one loads (typing in search), so "No matches" never flashes.
  return useQuery({
    queryKey: [command, args],
    queryFn: () => t.call(command, args) as Promise<Result<K>>,
    enabled: opts.enabled ?? true,
    placeholderData: keepPreviousData,
    refetchInterval: opts.every,
  });
}

/** A change. Callers show errors with the toast; the events refresh the screens. */
export function useAction() {
  const t = useTransport();
  const qc = useQueryClient();
  return async <K extends CommandName>(command: K, args?: Args<K>): Promise<Result<K>> => {
    const r = await t.call(command, args);
    qc.invalidateQueries();
    return r;
  };
}
