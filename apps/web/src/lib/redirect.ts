/** Only same-site paths, so a crafted ?redirect= can't send people elsewhere after signing in. */
export function safeRedirect(target: string | undefined): string {
  return target && target.startsWith("/") && !target.startsWith("//") && !target.startsWith("/\\") ? target : "/";
}
