import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import { LEGAL, LEGAL_UPDATED, PUBLISHER } from "../i18n/legal";
import { shortDate } from "../lib/format";

export default function Legal() {
  const { lang, t } = useI18n();
  const doc = LEGAL[lang];

  return (
    <div className="container-page max-w-3xl py-10">
      <h1 className="text-3xl font-bold">{doc.title}</h1>
      <p className="mt-2 text-xs text-ink-400">
        {doc.updated}: {shortDate(`${LEGAL_UPDATED}T12:00:00Z`)}
      </p>
      <p className="mt-5 text-sm leading-relaxed text-ink-300">{doc.intro}</p>

      <nav className="card mt-6 p-5 text-sm" aria-label={doc.title}>
        <ol className="space-y-1.5">
          {doc.sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className={`hover:underline ${s.warning ? "font-semibold text-loss-400" : "text-ink-300 hover:text-ink-100"}`}>
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {doc.sections.map((s) => (
        <section
          key={s.id}
          id={s.id}
          className={`mt-10 scroll-mt-24 ${s.warning ? "rounded-2xl border-2 border-loss-500/60 bg-loss-500/5 p-6" : ""}`}
        >
          <h2 className={`flex items-center gap-3 text-xl font-bold ${s.warning ? "text-loss-400" : ""}`}>
            {s.warning && <span className="rounded-lg border-2 border-loss-400 px-2 py-0.5 text-base">18+</span>}
            {s.title}
          </h2>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-300">
            {s.paragraphs.map((p) => (
              <p key={p} className={s.warning && p === s.paragraphs[0] ? "font-semibold text-ink-100" : ""}>
                {p}
              </p>
            ))}
            {s.bullets && (
              <ul className="list-disc space-y-1.5 pl-5">
                {s.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ))}

      <section className="mt-10 border-t border-ink-800 pt-6 text-sm text-ink-300">
        <h2 className="font-semibold text-ink-100">{doc.publisher}</h2>
        <p className="mt-2">
          {PUBLISHER.company} · {PUBLISHER.registration}
          <br />
          {PUBLISHER.address} · {PUBLISHER.email}
        </p>
      </section>

      <Link to="/" className="mt-10 inline-block text-sm text-pitch-400 hover:underline">
        ← {t("notFound.home")}
      </Link>
    </div>
  );
}
