import { Link } from "react-router-dom";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`flex items-center gap-2.5 ${className}`} aria-label="O-Jester home">
      <img src="/logo.svg" alt="" className="h-9 w-9" />
      <span className="font-display text-xl font-bold tracking-tight">
        O<span className="text-gold-500">-</span>Jester
      </span>
    </Link>
  );
}
