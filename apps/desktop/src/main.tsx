import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { Shell } from "./shell/Shell";
import "./styles.css";

// HashRouter: the bundled app is served from a custom protocol with no
// server-side fallback, so "/chat/abc" must live in the fragment.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <Shell />
    </HashRouter>
  </React.StrictMode>
);
