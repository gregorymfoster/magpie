import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { connect } from "./transport/index.ts";
import { CoreProvider } from "./api.tsx";
import { App } from "./App.tsx";
// Newsreader for books (variable, with an optical-size axis so 13px tile titles stay sturdy) and Inter for the UI. Both OFL, bundled.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "@fontsource-variable/inter/index.css";
import "./styles.css";

const transport = await connect();
const queries = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false } } });
// Another process (`magpie mcp`, `magpie call`) may have changed the Library while the window was in the background.
window.addEventListener("focus", () => queries.invalidateQueries());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queries}>
      <CoreProvider transport={transport}>
        <App />
      </CoreProvider>
    </QueryClientProvider>
  </StrictMode>,
);
