import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";
import { api, ApiError } from "../lib/api";
import type { Meta, Plan, PlanId, Session } from "../lib/types";

interface AppState {
  session: Session | null;
  sessionLoading: boolean;
  meta: Meta | undefined;
  plans: Plan[];
  plan: PlanId | null;
  setSession: (s: Session | null) => void;
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      try {
        return await api.get<Session>("/auth/me");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
  const metaQuery = useQuery({ queryKey: ["meta"], queryFn: () => api.get<Meta>("/meta"), staleTime: 5 * 60_000 });
  const plansQuery = useQuery({
    queryKey: ["plans"],
    queryFn: () => api.get<{ plans: Plan[] }>("/plans"),
    staleTime: Infinity,
  });

  const setSession = useCallback(
    (s: Session | null) => {
      qc.setQueryData(["session"], s);
      // Plan-gated data must be refetched whenever the entitlement changes.
      void qc.invalidateQueries({ predicate: (q) => !["session", "meta", "plans"].includes(String(q.queryKey[0])) });
    },
    [qc],
  );

  const refreshSession = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["session"] });
    void qc.invalidateQueries({ predicate: (q) => !["session", "meta", "plans"].includes(String(q.queryKey[0])) });
  }, [qc]);

  const logout = useCallback(async () => {
    await api.post("/auth/logout");
    setSession(null);
  }, [setSession]);

  const value = useMemo<AppState>(
    () => ({
      session: sessionQuery.data ?? null,
      sessionLoading: sessionQuery.isLoading,
      meta: metaQuery.data,
      plans: plansQuery.data?.plans ?? [],
      plan: sessionQuery.data?.subscription?.plan ?? null,
      setSession,
      refreshSession,
      logout,
    }),
    [sessionQuery.data, sessionQuery.isLoading, metaQuery.data, plansQuery.data, setSession, refreshSession, logout],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
