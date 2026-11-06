import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { PageLoader } from "./ui";

export function RequireAuth({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { session, sessionLoading } = useApp();
  const location = useLocation();
  if (sessionLoading) return <PageLoader />;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (admin && session.user.role !== "ADMIN") return <Navigate to="/app" replace />;
  return <>{children}</>;
}
