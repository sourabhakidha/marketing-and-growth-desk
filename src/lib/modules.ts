// Primary modules (Project Bible §1.2 / §3). Order = navigation order.
export interface ModuleDef {
  path: string;
  name: string;
  question: string;
  built: boolean;
  /** shown for modules that are not built yet */
  plannedNote?: string;
  /** other paths that belong to this module (for the active state in the top bar) */
  also?: readonly string[];
}

export const MODULES: readonly ModuleDef[] = [
  { path: "/ops", name: "Daily Ops", built: true,
    question: "What is my day: hours, planned work, and time on each task?" },
  { path: "/workspace", name: "Workspace", built: true, also: ["/goals"],
    question: "What work exists, who owns it, where is it blocked, and what is due?" },
  { path: "/radar", name: "Ideas", built: true, also: ["/opportunities"],
    question: "What is happening in our domain, and which ideas deserve attention?" },
  { path: "/intelligence", name: "AI", built: true,
    question: "What should we draft next, grounded in our brand and evidence?" },
  { path: "/insights", name: "Insights", built: true,
    question: "How is the work going: impact, flow, learnings and the full record?" },
];

export const isBuilt = (m: ModuleDef) => m.built;
