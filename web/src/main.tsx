import { createRoot } from "react-dom/client";

import App from "./App";
import { ErrorBoundary } from "@/components/ErrorBoundary";

import "./index.css";

createRoot(document.getElementById("root")!, {
  // Log caught errors here rather than handing them to reportError(),
  // which would trigger the Vite dev overlay for an exception that
  // the nearest error boundary has already caught and rendered.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
