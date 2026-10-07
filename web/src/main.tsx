import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthGate } from "./ui/AuthGate";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthGate />
  </StrictMode>,
);
