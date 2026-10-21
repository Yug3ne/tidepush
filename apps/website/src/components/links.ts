export const repo = "https://github.com/Yug3ne/tidepush";
export const webApp = "https://tidepush-web.yugenecodes99.workers.dev";
export const signup = `${webApp}/signup`;

/** Top navigation, shared by the landing page and the docs header. */
export const nav = [
  { label: "Guide", href: "/guide/what-is-tidepush", match: /^\/guides?\// },
  { label: "Reference", href: "/reference/cli", match: /^\/reference\// },
  { label: "Pricing", href: "/reference/limits", match: /^\/reference\/limits$/ },
  { label: "Sign in", href: webApp, match: null },
];
