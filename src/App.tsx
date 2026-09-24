import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Landing } from "./pages/Landing";
import { Markets } from "./pages/Markets";
import { NewSwitch } from "./pages/NewSwitch";
import { Switches } from "./pages/Switches";
import { AppDataProvider } from "./state/AppData";

export function App() {
  return (
    <AppDataProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<AppShell />}>
          <Route index element={<NewSwitch />} />
          <Route path="switches" element={<Switches />} />
          <Route path="markets" element={<Markets />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppDataProvider>
  );
}
