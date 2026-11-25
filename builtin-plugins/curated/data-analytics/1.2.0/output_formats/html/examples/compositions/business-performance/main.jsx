import React from "react";
import { createRoot } from "react-dom/client";
import { DataAppShell } from "../shell.jsx";
import { DashboardContent } from "../../business-performance/content/dashboard/DashboardContent.jsx";
import "../../business-performance/content/dashboard/dashboard.css";
import { snapshot } from "./data.js";

createRoot(document.getElementById("root")).render(
  <React.StrictMode><DataAppShell snapshot={snapshot} hosted={false}><DashboardContent /></DataAppShell></React.StrictMode>,
);
