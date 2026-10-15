import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  // A fresh client per request on the server, one per tab in the browser.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Load a route's code and data when someone hovers or touches its link, before the click.
    defaultPreload: "intent",
    // Freshness is TanStack Query's job; the router always asks it.
    defaultPreloadStaleTime: 0,
  });
  // Data loaded during SSR is sent with the HTML and reused on the client, not fetched again.
  setupRouterSsrQueryIntegration({ router, queryClient });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
