import type { Config } from "@netlify/functions";
import { hasForbiddenServerSecrets, integrationStatus } from "../lib/env.ts";
import { handle, json } from "../lib/http.ts";

// Public, unauthenticated: reports only configured / not_configured flags.
export default handle(async () =>
  json({
    status: "ok",
    integrations: integrationStatus(),
    warnings: hasForbiddenServerSecrets()
      ? ["SUPABASE_SERVICE_ROLE_KEY is set in this environment; remove it from Netlify"]
      : [],
  }),
);

export const config: Config = { path: "/api/health", method: ["GET"] };
