import { createMiddleware, createStart } from "@tanstack/react-start";

/**
 * Refuses cross-site requests that could change something: server functions
 * and form posts must come from pages on this origin. (Better Auth checks its
 * own endpoints the same way.)
 */
const sameOriginWrites = createMiddleware().server(async ({ next, request }) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
      return new Response("Cross-origin request refused", { status: 403 });
    }
  }
  return next();
});

export const startInstance = createStart(() => ({ requestMiddleware: [sameOriginWrites] }));
