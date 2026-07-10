import { Routes, Route } from "react-router-dom";
import { Atmosphere } from "./components/Atmosphere";
import { RequireAuth } from "./components/RequireAuth";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { SessionReview } from "./pages/SessionReview";
import { Setup } from "./pages/Setup";
import { Interview } from "./pages/Interview";
import { Results } from "./pages/Results";
import { Privacy } from "./pages/Privacy";

export function App() {
  return (
    <>
      <Atmosphere />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/session/:id"
          element={
            <RequireAuth>
              <SessionReview />
            </RequireAuth>
          }
        />
        <Route
          path="/setup"
          element={
            <RequireAuth>
              <Setup />
            </RequireAuth>
          }
        />
        <Route
          path="/interview"
          element={
            <RequireAuth>
              <Interview />
            </RequireAuth>
          }
        />
        <Route
          path="/results"
          element={
            <RequireAuth>
              <Results />
            </RequireAuth>
          }
        />
      </Routes>
    </>
  );
}
