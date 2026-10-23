// Primary modules (Project Bible §1.2 / §3). Order = navigation order.
export interface ModuleDef {
  path: string;
  name: string;
  question: string;
  phase: number;
}

export const MODULES: readonly ModuleDef[] = [
  { path: "/workspace", name: "Workspace", phase: 1,
    question: "What work exists, who owns it, where is it blocked, and what is due?" },
  { path: "/performance", name: "Performance Planning", phase: 2,
    question: "What outcomes are we targeting, what is the actual result, and where is the gap?" },
  { path: "/calendar", name: "Calendar", phase: 2,
    question: "What is planned, due, dependent or at risk over time?" },
  { path: "/radar", name: "Content Radar", phase: 3,
    question: "What is happening in our domain, and what sources support it?" },
  { path: "/opportunities", name: "Content Opportunities", phase: 4,
    question: "Which ideas deserve attention, and why?" },
  { path: "/intelligence", name: "AI Intelligence", phase: 4,
    question: "What should we consider doing next, based on the context we have?" },
  { path: "/learning", name: "Learning Loop", phase: 5,
    question: "What did we learn from outcomes and execution?" },
];

/** Phase currently delivered; modules with a later phase render as "not built yet". */
export const isBuilt = (m: ModuleDef) => m.phase <= CURRENT_PHASE;
export const CURRENT_PHASE = 1;
