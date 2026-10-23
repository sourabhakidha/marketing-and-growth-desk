import { createBrowserRouter, RouterProvider } from "react-router";
import { RequireMember } from "./components/Gate.tsx";
import { Layout } from "./components/Layout.tsx";
import { FullPage, StatePanel } from "./components/States.tsx";
import { MODULES } from "./lib/modules.ts";
import { Account } from "./pages/Account.tsx";
import { Login } from "./pages/Login.tsx";
import { ModulePlaceholder } from "./pages/ModulePlaceholder.tsx";
import { Overview } from "./pages/Overview.tsx";
import { Team } from "./pages/Team.tsx";
import { Vocabularies } from "./pages/Vocabularies.tsx";

const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  {
    element: <RequireMember />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <Overview /> },
          ...MODULES.map((m) => ({ path: m.path, element: <ModulePlaceholder module={m} /> })),
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
