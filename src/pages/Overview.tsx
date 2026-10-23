import { Link } from "react-router";
import { CURRENT_PHASE, MODULES } from "../lib/modules.ts";
import { useMember } from "../lib/session.tsx";

export function Overview() {
  const { member } = useMember();
  return (
    <>
      <header className="page-header">
        <p className="eyebrow">Sense → Interpret → Decide → Execute → Learn</p>
        <h1>Welcome, {member.display_name.split(" ")[0]}</h1>
        <p className="muted">
          Foundation release (Phase {CURRENT_PHASE}). Accounts, permissions, vocabularies and the audit log are live.
          No operational modules are built yet, so this page shows no counts or metrics.
        </p>
      </header>
      <section className="module-grid" aria-label="Modules">
        {MODULES.map((m) => (
          <Link key={m.path} to={m.path} className="module-card">
            <span className="pill pill--muted">Planned · Phase {m.phase}</span>
            <h2>{m.name}</h2>
            <p>{m.question}</p>
          </Link>
        ))}
      </section>
    </>
  );
}
