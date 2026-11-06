import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

export interface SlipItem {
  matchId: string;
  market: string;
  short: string;
  label: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  odds: number;
  probability: number;
}

interface SlipState {
  items: SlipItem[];
  has: (matchId: string, market: string) => boolean;
  /** Adds the selection, replacing any other selection on the same match; removes it if already present. */
  toggle: (item: SlipItem) => void;
  remove: (matchId: string) => void;
  clear: () => void;
}

const STORAGE_KEY = "oj-slip";
const SlipContext = createContext<SlipState | null>(null);

function load(): SlipItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SlipItem[]) : [];
  } catch {
    return [];
  }
}

export function SlipProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<SlipItem[]>(load);

  useEffect(() => {
    try {
      // Drop selections whose matches have already kicked off.
      const fresh = items.filter((i) => new Date(i.kickoff).getTime() > Date.now());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    } catch {
      // storage unavailable (private mode) — the slip still works for this session
    }
  }, [items]);

  const has = useCallback((matchId: string, market: string) => items.some((i) => i.matchId === matchId && i.market === market), [items]);
  const toggle = useCallback((item: SlipItem) => {
    setItems((prev) => {
      const same = prev.find((i) => i.matchId === item.matchId);
      if (same?.market === item.market) return prev.filter((i) => i.matchId !== item.matchId);
      return [...prev.filter((i) => i.matchId !== item.matchId), item];
    });
  }, []);
  const remove = useCallback((matchId: string) => setItems((prev) => prev.filter((i) => i.matchId !== matchId)), []);
  const clear = useCallback(() => setItems([]), []);

  const value = useMemo(() => ({ items, has, toggle, remove, clear }), [items, has, toggle, remove, clear]);
  return <SlipContext.Provider value={value}>{children}</SlipContext.Provider>;
}

export function useSlip() {
  const ctx = useContext(SlipContext);
  if (!ctx) throw new Error("useSlip must be used inside SlipProvider");
  return ctx;
}
