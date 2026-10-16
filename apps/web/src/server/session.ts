import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAuth } from "./auth";

export interface Viewer {
  id: string;
  email: string;
  name: string;
  image: string | null;
}

async function viewerFromRequest(): Promise<Viewer | null> {
  const session = await getAuth().api.getSession({ headers: getRequest().headers });
  if (!session) return null;
  const { id, email, name, image } = session.user;
  return { id, email, name, image: image ?? null };
}

/** The signed-in person, or null. Safe to call from loaders (it runs on the server). */
export const getViewer = createServerFn({ method: "GET" }).handler(viewerFromRequest);

export class UnauthorizedError extends Error {
  constructor() {
    super("You're signed out. Sign in again.");
  }
}

/**
 * For every server function that touches private data: resolves the session
 * inside the handler (route guards are only UX) and passes the person on.
 */
export const requireViewer = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const viewer = await viewerFromRequest();
  if (!viewer) throw new UnauthorizedError();
  return next({ context: { viewer } });
});
