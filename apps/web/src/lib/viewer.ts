import { queryOptions } from "@tanstack/react-query";
import { getViewer } from "../server/session";

/** The signed-in person. Cached, so guards on every navigation don't each cost a request. */
export const viewerQuery = queryOptions({ queryKey: ["viewer"], queryFn: () => getViewer(), staleTime: 5 * 60_000 });
