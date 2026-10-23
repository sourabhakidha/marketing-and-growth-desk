import { NavLink, Outlet } from "react-router";
import { MODULES } from "../lib/modules.ts";
import { useMember } from "../lib/session.tsx";
import { supabase } from "../lib/supabase.ts";

export function Layout() {
  const { member } = useMember();
  return (
    <div className="shell">
      <aside className="sidebar">
        <NavLink to="/" className="sidebar__brand" end>
          <span className="brand-mark" aria-hidden="true" />
          <span>Marketing OS</span>
        </NavLink>
        <nav aria-label="Modules">
          <NavLink to="/" end>Overview</NavLink>
          {MODULES.map((m) => (
            <NavLink key={m.path} to={m.path}>{m.name}</NavLink>
          ))}
        </nav>
        <nav aria-label="Settings" className="sidebar__secondary">
          <NavLink to="/settings/team">Team</NavLink>
          <NavLink to="/settings/vocabularies">Vocabularies</NavLink>
          <NavLink to="/account">Account</NavLink>
        </nav>
        <div className="sidebar__user">
          <div>
            <strong>{member.display_name}</strong>
            <span className="pill">{member.role === "admin" ? "Admin" : "Contributor"}</span>
          </div>
          <button type="button" className="link" onClick={() => supabase?.auth.signOut()}>Sign out</button>
        </div>
      </aside>
      <main className="content" id="main">
        <Outlet />
      </main>
    </div>
  );
}
