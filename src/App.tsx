import { Routes, Route } from "react-router-dom";
import { Atmosphere } from "./components/Atmosphere";
import { Landing } from "./pages/Landing";
import { Setup } from "./pages/Setup";
import { Interview } from "./pages/Interview";
import { Results } from "./pages/Results";

export function App() {
  return (
    <>
      <Atmosphere />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/interview" element={<Interview />} />
        <Route path="/results" element={<Results />} />
      </Routes>
    </>
  );
}
