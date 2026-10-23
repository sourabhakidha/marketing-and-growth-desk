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
        <p>{module.plannedNote ?? "Planned for a later release."} Nothing here is connected to real data.</p>
      </StatePanel>
    </>
  );
}
