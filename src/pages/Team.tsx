import { useQuery } from "@tanstack/react-query";
import { describeDbError, type Member, useMember } from "../lib/session.tsx";
import { supabase } from "../lib/supabase.ts";
import { Loading, StatePanel } from "../components/States.tsx";

export function Team() {
  const { member: me } = useMember();
  const members = useQuery({
    queryKey: ["members"],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("members")
        .select("id, username, email, display_name, role, is_active")
        .order("display_name");
      if (error) throw new Error(describeDbError(error.message));
      return data as Member[];
    },
  });

  return (
    <>
      <header className="page-header">
        <h1>Team</h1>
        <p className="muted">
          Marketing OS members and roles. Admins approve task completion and manage goals. New members are added
          by an admin (see docs/SUPABASE_SETUP.md).
        </p>
      </header>
      {members.isPending && <Loading />}
      {members.isError && <StatePanel title="Could not load team" tone="error"><p>{members.error.message}</p></StatePanel>}
      {members.data && (
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Name</th><th scope="col">Username</th><th scope="col">Role</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {members.data.map((m) => (
                <tr key={m.id}>
                  <td>{m.display_name}{m.id === me.id && <span className="muted"> (you)</span>}</td>
                  <td>{m.username}</td>
                  <td>{m.role === "admin" ? "Admin" : "Contributor"}</td>
                  <td>{m.is_active ? "Active" : "Inactive"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
