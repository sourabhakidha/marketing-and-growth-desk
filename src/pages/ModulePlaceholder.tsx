import type { ModuleDef } from "../lib/modules.ts";
import { StatePanel } from "../components/States.tsx";

export function ModulePlaceholder({ module }: { module: ModuleDef }) {
  return (
    <>
      <header className="page-header">
        <h1>{module.name}</h1>
        <p className="muted">{module.question}</p>
      </header>
      <StatePanel title="Not built yet">
        <p>This module is scheduled for Phase {module.phase}. Nothing here is connected to real data yet.</p>
      </StatePanel>
    </>
  );
}
