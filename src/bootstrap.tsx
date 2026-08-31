import { QueryClientProvider } from "@tanstack/react-query";
import { upload } from "@vercel/blob/client";
import { createRoot } from "react-dom/client";

import App from "./App";
import { configureVercelBlobClientUpload } from "./lib/privateMediaApi";
import { queryClient } from "./lib/queryClient";

export function mountBuildy(): void {
  configureVercelBlobClientUpload(upload);
  createRoot(document.getElementById("root")!).render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}
