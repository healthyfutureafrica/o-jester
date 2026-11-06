import { useApp } from "../context/AppContext";
import { useI18n } from "../i18n";
import { addDays } from "../lib/format";

/** Yesterday / Today / Tomorrow switcher. */
export function DateTabs({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const { meta } = useApp();
  const { t } = useI18n();
  if (!meta) return null;
  const dates = [
    [addDays(meta.today, -1), t("date.yesterday")],
    [meta.today, t("date.today")],
    [meta.tomorrow, t("date.tomorrow")],
  ] as const;
  return (
    <div className="inline-flex rounded-xl border border-ink-700 bg-ink-900 p-1" role="tablist">
      {dates.map(([d, label]) => (
        <button
          key={d}
          role="tab"
          aria-selected={value === d}
          onClick={() => onChange(d)}
          className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${value === d ? "bg-ink-700 text-ink-100" : "text-ink-400 hover:text-ink-100"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
