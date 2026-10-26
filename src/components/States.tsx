import type { ReactNode } from "react";

export function StatePanel({ title, tone = "neutral", children }: {
  title: string;
  tone?: "neutral" | "warning" | "error";
  children?: ReactNode;
}) {
  return (
    <div className={`state state--${tone}`} role={tone === "error" ? "alert" : "status"}>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function FullPage({ children }: { children: ReactNode }) {
  return (
    <main className="fullpage">
      <div className="fullpage__brand">
        <span className="wordmark"><span className="wordmark__name">Akidha</span><span className="wordmark__product">Marketing Desk</span></span>
      </div>
      {children}
    </main>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <p className="muted" role="status">{label}</p>;
}
