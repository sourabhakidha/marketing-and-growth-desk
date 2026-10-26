import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { RequireMember } from "./components/Gate.tsx";
import { Layout } from "./components/Layout.tsx";
import { FullPage, StatePanel } from "./components/States.tsx";
import { Account } from "./pages/Account.tsx";
import { Login } from "./pages/Login.tsx";
import { Overview } from "./pages/Overview.tsx";
import { Team } from "./pages/Team.tsx";
import { Vocabularies } from "./pages/Vocabularies.tsx";
import { ActivityLog } from "./workspace/ActivityLog.tsx";
import { Exports } from "./workspace/Exports.tsx";
import { Board } from "./workspace/Board.tsx";
import { TableView } from "./workspace/TableView.tsx";
import { Timeline } from "./workspace/Timeline.tsx";
import { DeliverablesTab, GoalsTab } from "./workspace/Hierarchy.tsx";
import { TaskDetail } from "./workspace/TaskDetail.tsx";
import { Workspace } from "./workspace/Workspace.tsx";
import { WorkspaceOverview } from "./workspace/WorkspaceOverview.tsx";
import { DailyOps, MyDay, TeamPlans } from "./ops/DailyOps.tsx";
import { OpsLog, Performance } from "./ops/Performance.tsx";
import { DeliverableJourneyPage } from "./workspace/Journey.tsx";
import { Flow } from "./workspace/Flow.tsx";
import { Radar } from "./modules/Radar.tsx";
import { NewOpportunity, OpportunityDetail, OpportunityList } from "./modules/Opportunities.tsx";
import { DraftDetail, Drafts, Intelligence, Knowledge } from "./modules/Intelligence.tsx";
import { Learnings, ProcessInsights } from "./modules/Learning.tsx";
import { ImpactBrief } from "./modules/ImpactBrief.tsx";
import { BinPage, GoalsPage, IdeasLayout, InsightsLayout } from "./modules/Hubs.tsx";

const to = (path: string) => <Navigate to={path} replace />;

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
            path: "/ops",
            element: <DailyOps />,
            children: [
              { index: true, element: <MyDay /> },
              { path: "team", element: <TeamPlans /> },
              { path: "performance", element: <Performance /> },
              { path: "log", element: <OpsLog /> },
            ],
          },
          {
            path: "/workspace",
            element: <Workspace />,
            children: [
              { index: true, element: <WorkspaceOverview /> },
              { path: "goals", element: <GoalsTab /> },
              { path: "deliverables", element: <DeliverablesTab /> },
              { path: "deliverables/:ref", element: <DeliverableJourneyPage /> },
              { path: "tasks", element: <Board /> },
              { path: "calendar", element: <Timeline /> },
              { path: "list", element: <TableView /> },
              // earlier views (D-026 … D-040) now live in these tabs or elsewhere
              { path: "board", element: to("/workspace/tasks") },
              { path: "table", element: to("/workspace/list") },
              { path: "timeline", element: to("/workspace/calendar?view=bars") },
              { path: "flow", element: to("/insights/flow") },
              { path: "activity", element: to("/insights/activity") },
              { path: "exports", element: to("/insights/exports") },
              { path: "bin", element: to("/bin") },
            ],
          },
          { path: "/workspace/tasks/:ref", element: <TaskDetail /> },
          { path: "/goals", element: <GoalsPage /> },
          {
            element: <IdeasLayout />,
            children: [
              { path: "/radar", element: <Radar /> },
              { path: "/opportunities", element: <OpportunityList /> },
            ],
          },
          { path: "/ideas", element: to("/radar") },
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
            path: "/insights",
            element: <InsightsLayout />,
            children: [
              { index: true, element: <ImpactBrief embedded /> },
              { path: "flow", element: <Flow /> },
              { path: "learnings", element: <Learnings /> },
              { path: "process", element: <ProcessInsights /> },
              { path: "activity", element: <ActivityLog /> },
              { path: "exports", element: <Exports /> },
            ],
          },
          { path: "/bin", element: <BinPage /> },
          { path: "/calendar", element: to("/workspace/calendar") },
          { path: "/impact", element: to("/insights") },
          { path: "/learning", element: to("/insights/learnings") },
          { path: "/learning/process", element: to("/insights/process") },
          { path: "/performance", element: to("/ops/performance") },
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
