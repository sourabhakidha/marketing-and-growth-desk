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
import { Pipeline } from "./workspace/Pipeline.tsx";
import { Flow } from "./workspace/Flow.tsx";
import { TaskList } from "./workspace/TaskList.tsx";
import { TaskDetail } from "./workspace/TaskDetail.tsx";
import { Workspace } from "./workspace/Workspace.tsx";
import { Calendar } from "./modules/Calendar.tsx";
import { Radar } from "./modules/Radar.tsx";
import { NewOpportunity, OpportunityDetail, OpportunityList } from "./modules/Opportunities.tsx";
import { DraftDetail, Drafts, Intelligence, Knowledge } from "./modules/Intelligence.tsx";
import { LearningLoop, Learnings, ProcessInsights } from "./modules/Learning.tsx";

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
              { index: true, element: <Pipeline /> },
              { path: "board", element: <TaskBoard /> },
              { path: "list", element: <TaskList /> },
              { path: "calendar", element: <Calendar embedded /> },
              { path: "flow", element: <Flow /> },
              { path: "goals", element: <Goals /> },
              { path: "activity", element: <ActivityLog /> },
              { path: "exports", element: <Exports /> },
            ],
          },
          { path: "/workspace/tasks/:ref", element: <TaskDetail /> },
          { path: "/calendar", element: <Calendar /> },
          { path: "/radar", element: <Radar /> },
          { path: "/opportunities", element: <OpportunityList /> },
          { path: "/opportunities/new", element: <NewOpportunity /> },
          { path: "/opportunities/:ref", element: <OpportunityDetail /> },
          {
            path: "/intelligence",
            element: <Intelligence />,
            children: [
              { index: true, element: <Drafts /> },
              { path: "knowledge", element: <Knowledge /> },
            ],
          },
          { path: "/intelligence/drafts/:ref", element: <DraftDetail /> },
          {
            path: "/learning",
            element: <LearningLoop />,
            children: [
              { index: true, element: <Learnings /> },
              { path: "process", element: <ProcessInsights /> },
            ],
          },
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
