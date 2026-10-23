import type { Config } from "@netlify/functions";
import { requireMember } from "../lib/auth.ts";
import { handle, json } from "../lib/http.ts";

// Reference pattern for every future server action: verify the session and
// membership on the server, then act with the caller's own RLS-scoped client.
export default handle(async (req) => {
  const me = await requireMember(req);
  return json({
    userId: me.userId,
    memberId: me.memberId,
    username: me.username,
    displayName: me.displayName,
    role: me.role,
  });
});

export const config: Config = { path: "/api/me", method: ["GET"] };
