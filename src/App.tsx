import { createBrowserRouter, RouterProvider } from "react-router";
import { RequireMember } from "./components/Gate.tsx";
import { Layout } from "./components/Layout.tsx";
import { FullPage, StatePanel } from "./components/States.tsx";
import { isBuilt, MODULES } from "./lib/modules.ts";
import { Account } from "./pages/Account.tsx";
import { Login } from "./pages/Login.tsx";
import { ModulePlaceholder } from "./pages/ModulePlaceholder.tsx";
import { Overview } from "./pages/Overview.tsx";
import { Team } from "./pages/Team.tsx";
import { Vocabularies } from "./pages/Vocabularies.tsx";
import { ActivityLog } from "./workspace/ActivityLog.tsx";
import { Exports } from "./workspace/Exports.tsx";
import { Goals } from "./workspace/Goals.tsx";
import { TaskBoard } from "./workspace/TaskBoard.tsx";
import { TaskDetail } from "./workspace/TaskDetail.tsx";
import { Workspace } from "./workspace/Workspace.tsx";

const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  {
    element: <RequireMember />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <Overview /> },
          {
            path: "/workspace",
            element: <Workspace />,
            children: [
              { index: true, element: <TaskBoard /> },
              { path: "goals", element: <Goals /> },
              { path: "activity", element: <ActivityLog /> },
              { path: "exports", element: <Exports /> },
            ],
          },
          { path: "/workspace/tasks/:ref", element: <TaskDetail /> },
          ...MODULES.filter((m) => !isBuilt(m)).map((m) => ({ path: m.path, element: <ModulePlaceholder module={m} /> })),
          { path: "/settings/team", element: <Team /> },
          { path: "/settings/vocabularies", element: <Vocabularies /> },
          { path: "/account", element: <Account /> },
          { path: "*", element: <StatePanel title="Page not found" /> },
        ],
      },
    ],
  },
  { path: "*", element: <FullPage><StatePanel title="Page not found" /></FullPage> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
