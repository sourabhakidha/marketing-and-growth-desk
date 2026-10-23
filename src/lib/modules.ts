// Primary modules (Project Bible §1.2 / §3). Order = navigation order.
export interface ModuleDef {
  path: string;
  name: string;
  question: string;
  built: boolean;
  /** shown for modules that are not built yet */
  plannedNote?: string;
}

export const MODULES: readonly ModuleDef[] = [
  { path: "/workspace", name: "Workspace", built: true,
    question: "What work exists, who owns it, where is it blocked, and what is due?" },
  { path: "/calendar", name: "Calendar", built: true,
    question: "What is planned, due, dependent or at risk over time?" },
  { path: "/radar", name: "Content Radar", built: true,
    question: "What is happening in our domain, and what sources support it?" },
  { path: "/opportunities", name: "Content Opportunities", built: true,
    question: "Which ideas deserve attention, and why?" },
  { path: "/intelligence", name: "AI Intelligence", built: true,
    question: "What should we draft next, grounded in our brand and evidence?" },
  { path: "/learning", name: "Learning Loop", built: true,
    question: "What did we learn from outcomes and execution?" },
  { path: "/performance", name: "Performance Planning", built: false, plannedNote: "Deferred by decision D-016",
    question: "What outcomes are we targeting, what is the actual result, and where is the gap?" },
];

export const isBuilt = (m: ModuleDef) => m.built;
