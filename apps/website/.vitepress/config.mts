import { defineConfig } from "vitepress";

const repo = "https://github.com/Yug3ne/tidepush";

export default defineConfig({
  title: "Tidepush",
  description: "OTA updates for Expo apps. Signed, staged, instantly reversible.",
  lang: "en-US",
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ["README.md"],
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
    ["meta", { name: "theme-color", content: "#10263E" }],
    ["meta", { property: "og:title", content: "Tidepush" }],
    ["meta", { property: "og:description", content: "OTA updates for Expo apps. Signed, staged, instantly reversible." }],
  ],
  themeConfig: {
    logo: { src: "/logo.svg", alt: "" },
    siteTitle: "Tidepush",
    nav: [
      { text: "Guide", link: "/guide/what-is-tidepush", activeMatch: "^/(guide|guides)/" },
      { text: "Reference", link: "/reference/cli", activeMatch: "^/reference/" },
      { text: "Pricing", link: "/reference/limits" },
      { text: "Sign in", link: "https://tidepush-web.yugenecodes99.workers.dev" },
    ],
    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "What is Tidepush?", link: "/guide/what-is-tidepush" },
          { text: "What are OTA updates?", link: "/guide/ota-updates" },
          { text: "Key concepts", link: "/guide/concepts" },
          { text: "How it works", link: "/guide/how-it-works" },
        ],
      },
      {
        text: "Getting started",
        items: [{ text: "Tutorial: zero to first update", link: "/guide/getting-started" }],
      },
      {
        text: "Guides",
        items: [
          { text: "Channels & promoting", link: "/guides/channels" },
          { text: "Staged rollouts", link: "/guides/staged-rollouts" },
          { text: "Rollbacks", link: "/guides/rollbacks" },
          { text: "Code signing & keys", link: "/guides/code-signing" },
          { text: "Team & access", link: "/guides/team-and-access" },
          { text: "CI/CD with GitHub Actions", link: "/guides/ci-cd" },
          { text: "Testing on a device", link: "/guides/testing-on-device" },
          { text: "Moving from EAS Update", link: "/guides/moving-from-eas" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "CLI", link: "/reference/cli" },
          { text: "Protocol details", link: "/reference/protocol" },
          { text: "Security", link: "/reference/security" },
          { text: "Plans & limits", link: "/reference/limits" },
        ],
      },
      {
        text: "Help",
        items: [
          { text: "Troubleshooting", link: "/troubleshooting" },
          { text: "FAQ", link: "/faq" },
        ],
      },
      {
        text: "Project",
        items: [
          { text: "Self-hosting", link: "/self-hosting" },
          { text: "License", link: "/license" },
          { text: "Contributing", link: "/contributing" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: repo }],
    search: { provider: "local" },
    editLink: {
      pattern: `${repo}/edit/main/apps/website/:path`,
      text: "Edit this page on GitHub",
    },
    lastUpdated: { text: "Last updated" },
    outline: { level: [2, 3] },
    footer: {
      message: "Released under the AGPL-3.0-only license. Commercial licenses available.",
      copyright: "Copyright © Eugene Koech",
    },
  },
});
