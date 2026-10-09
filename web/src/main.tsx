import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthGate } from "./ui/AuthGate";
import { SharedView } from "./ui/SharedView";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* /ver é o link de leitura: não passa pelo login. */}
    {window.location.pathname === "/ver" ? <SharedView /> : <AuthGate />}
  </StrictMode>,
);
