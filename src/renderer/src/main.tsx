import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "./index.css"

function initThemeFromStorage(): void {
  const saved = localStorage.getItem("openwork-theme")
  document.documentElement.classList.remove("light", "dark")
  document.documentElement.classList.add(saved === "light" ? "light" : "dark")
}
initThemeFromStorage()

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
