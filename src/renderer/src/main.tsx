import React from "react";
import ReactDOM from "react-dom/client";
import "katex/dist/katex.min.css";
import App from "./App";
import "./index.css";

function initThemeFromStorage(): void {
  const saved = localStorage.getItem("openwork-theme");
  const resolved = saved === "light" || saved === "dark" ? saved : "light";
  if (!saved) {
    localStorage.setItem("openwork-theme", "light");
  }
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(resolved);
}
initThemeFromStorage();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
