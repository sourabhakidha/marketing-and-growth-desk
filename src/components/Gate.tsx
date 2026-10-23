import { Navigate, Outlet, useLocation } from "react-router";
import { useAccess } from "../lib/session.tsx";
import { supabase } from "../lib/supabase.ts";
import { FullPage, Loading, StatePanel } from "./States.tsx";
import { accountLabel } from "../lib/username.ts";

/** Only active Marketing OS members get past this point. RLS enforces the same rule server-side. */
export function RequireMember() {
  const access = useAccess();
  const location = useLocation();

  switch (access.kind) {
    case "not_configured":
      return (
        <FullPage>
          <StatePanel title="Not configured" tone="warning">
            <p>Supabase connection settings are missing for this deployment. Set
              <code> VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>.</p>
          </StatePanel>
        </FullPage>
      );
    case "loading":
      return <FullPage><Loading /></FullPage>;
    case "signed_out":
      return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    case "error":
      return (
        <FullPage>
          <StatePanel title="Could not verify your access" tone="error"><p>{access.message}</p></StatePanel>
        </FullPage>
      );
    case "no_access":
      return (
        <FullPage>
          <StatePanel title={access.reason === "inactive" ? "Access disabled" : "No access to Marketing OS"} tone="warning">
            <p>
              You are signed in{access.email ? ` as ${accountLabel(access.email)}` : ""}, but this account
              {access.reason === "inactive" ? " has been deactivated" : " is not a Marketing OS member"}.
              Ask Sourabh or Tanvi to add you.
            </p>
            <button type="button" className="button" onClick={() => supabase?.auth.signOut()}>Sign out</button>
          </StatePanel>
        </FullPage>
      );
    case "member":
      return <Outlet />;
  }
}
