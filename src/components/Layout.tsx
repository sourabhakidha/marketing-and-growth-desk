import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Link, NavLink, Outlet, useLocation, matchPath } from "react-router";
import { MODULES } from "../lib/modules.ts";
import { useMember } from "../lib/session.tsx";
import { supabase } from "../lib/supabase.ts";
import { PopupMenu } from "./PopupMenu.tsx";
import { ScopeProvider, ScopeSwitch } from "../lib/scope.tsx";

interface NavItem { to: string; name: string; built: boolean; end?: boolean; also?: readonly string[] }

const NAV_ITEMS: NavItem[] = [
  { to: "/", name: "Overview", built: true, end: true },
  ...MODULES.map((m) => ({ to: m.path, name: m.name, built: m.built, also: m.also })),
];

const SETTINGS_ITEMS: NavItem[] = [
  { to: "/settings/team", name: "Team", built: true },
  { to: "/settings/vocabularies", name: "Vocabularies", built: true },
  { to: "/account", name: "Account", built: true },
];

const navClass = (item: NavItem) => ({ isActive }: { isActive: boolean }) =>
  `${isActive ? "active" : ""}${item.built ? "" : " nav--planned"}`;

function ItemLabel({ item }: { item: NavItem }) {
  return <>{item.name}{!item.built && <span className="nav__tag">later</span>}</>;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "")).toUpperCase() || "?";
}

/** How many primary nav items fit inline; the rest go into a "More" popup. */
function useVisibleCount(navRef: RefObject<HTMLElement | null>, measureRef: RefObject<HTMLElement | null>) {
  const [count, setCount] = useState(NAV_ITEMS.length);
  useLayoutEffect(() => {
    const nav = navRef.current;
    const measure = measureRef.current;
    if (!nav || !measure) return;
    const compute = () => {
      const widths = Array.from(measure.querySelectorAll<HTMLElement>("[data-measure-item]")).map((el) => el.offsetWidth);
      const moreWidth = measure.querySelector<HTMLElement>("[data-measure-more]")?.offsetWidth ?? 80;
      const gap = 4;
      const available = nav.clientWidth;
      const total = widths.reduce((s, w) => s + w + gap, 0);
      if (total <= available) { setCount(widths.length); return; }
      let used = moreWidth;
      let n = 0;
      for (const w of widths) {
        if (used + w + gap > available) break;
        used += w + gap;
        n++;
      }
      setCount(Math.max(1, n));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(nav);
    document.fonts?.ready.then(compute).catch(() => undefined);
    return () => ro.disconnect();
  }, [navRef, measureRef]);
  return count;
}

export function Layout() {
  const { member } = useMember();
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const visible = useVisibleCount(navRef, measureRef);
  const inline = NAV_ITEMS.slice(0, visible);
  const overflow = NAV_ITEMS.slice(visible);
  const isOn = (item: NavItem) => [item.to, ...(item.also ?? [])].some((p) => !!matchPath({ path: p, end: !!item.end }, location.pathname));
  const navCls = (item: NavItem) => `${isOn(item) ? "active" : ""}${item.built ? "" : " nav--planned"}`;
  const roleLabel = member.role === "admin" ? "Admin" : "Contributor";
  const settingsActive = SETTINGS_ITEMS.some(isOn);

  return (
    <ScopeProvider>
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="topbar">
        <div className="topbar__inner">
          <Link to="/" className="topbar__brand">
            <span className="wordmark"><span className="wordmark__name">Akidha</span><span className="wordmark__product">Marketing Desk</span></span>
          </Link>

          <nav className="topnav" aria-label="Modules" ref={navRef}>
            {inline.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={() => `topnav__link ${navCls(item)}`}>
                <ItemLabel item={item} />
              </NavLink>
            ))}
            {overflow.length > 0 && (
              <PopupMenu label="More modules" buttonClassName="topnav__more" align="end" active={overflow.some(isOn)}
                button={<>More <span className="caret" aria-hidden="true" /></>}>
                {overflow.map((item) => (
                  <NavLink key={item.to} role="menuitem" to={item.to} end={item.end} className={() => `popup__item ${navCls(item)}`}>
                    <ItemLabel item={item} />
                  </NavLink>
                ))}
              </PopupMenu>
            )}
            {/* hidden copy used only to measure how many items fit */}
            <div className="topnav__measure" ref={measureRef} aria-hidden="true" inert>
              {NAV_ITEMS.map((item) => <span key={item.to} data-measure-item className="topnav__link"><ItemLabel item={item} /></span>)}
              <span data-measure-more className="topnav__more">More <span className="caret" /></span>
            </div>
          </nav>

          <div className="topbar__end">
            <ScopeSwitch />
            <PopupMenu label="Menu" buttonClassName="topbar__menu-button" panelClassName="popup__panel--sheet" align="end"
              active={NAV_ITEMS.some(isOn)}
              button={<><span className="hamburger" aria-hidden="true" /><span>Menu</span></>}>
              <div className="popup__label" role="presentation">Modules</div>
              {NAV_ITEMS.map((item) => (
                <NavLink key={item.to} role="menuitem" to={item.to} end={item.end} className={(s) => `popup__item ${navClass(item)(s)}`}>
                  <ItemLabel item={item} />
                </NavLink>
              ))}
            </PopupMenu>

            <PopupMenu label="Account and settings" buttonClassName="account-button" align="end" active={settingsActive}
              button={<>
                <span className="account-button__avatar" aria-hidden="true">{initials(member.display_name)}</span>
                <span className="account-button__name">{member.display_name}</span>
                <span className="caret" aria-hidden="true" />
              </>}
              header={
                <div className="popup__header">
                  <span className="account-button__avatar account-button__avatar--lg" aria-hidden="true">{initials(member.display_name)}</span>
                  <div>
                    <strong>{member.display_name}</strong>
                    <span className="pill">{roleLabel}</span>
                  </div>
                </div>
              }>
              {member.role === "admin" && (
                <NavLink role="menuitem" to="/bin" className={({ isActive }) => `popup__item ${isActive ? "active" : ""}`}>Recycle Bin</NavLink>
              )}
              {SETTINGS_ITEMS.map((item) => (
                <NavLink key={item.to} role="menuitem" to={item.to} className={(s) => `popup__item ${navClass(item)(s)}`}>
                  {item.name}
                </NavLink>
              ))}
              <div className="popup__sep" role="separator" />
              <button type="button" role="menuitem" className="popup__item popup__item--signout" onClick={() => supabase?.auth.signOut()}>Sign out</button>
            </PopupMenu>
          </div>
        </div>
      </header>
      <main className="content" id="main">
        <Outlet />
      </main>
    </div>
    </ScopeProvider>
  );
}
