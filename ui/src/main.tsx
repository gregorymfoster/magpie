import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { connect } from "./transport/index.ts";
import { CoreProvider } from "./api.tsx";
import { App } from "./App.tsx";
import "@fontsource/eb-garamond/latin-400.css";
import "@fontsource/eb-garamond/latin-500.css";
import "@fontsource/eb-garamond/latin-400-italic.css";
import "./styles.css";

const transport = await connect();
const queries = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queries}>
      <CoreProvider transport={transport}>
        <App />
      </CoreProvider>
    </QueryClientProvider>
  </StrictMode>,
);
