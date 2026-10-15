import { defineConfig } from "vitepress";

const repo = "https://github.com/Yug3ne/tidepush";

export default defineConfig({
  title: "Tidepush",
  description: "Self-hosted OTA updates for Expo apps, on Cloudflare.",
  lang: "en-US",
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ["README.md"],
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
    ["meta", { name: "theme-color", content: "#10263E" }],
    ["meta", { property: "og:title", content: "Tidepush" }],
    ["meta", { property: "og:description", content: "Self-hosted OTA updates for Expo apps, on Cloudflare." }],
  ],
  themeConfig: {
    logo: { src: "/logo.svg", alt: "" },
    siteTitle: "Tidepush",
    nav: [
      { text: "Guide", link: "/guide/what-is-tidepush", activeMatch: "^/(guide|guides)/" },
      { text: "Reference", link: "/reference/cli", activeMatch: "^/reference/" },
      { text: "License", link: "/license" },
      { text: "GitHub", link: repo },
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
          { text: "Custom domain", link: "/guides/custom-domain" },
          { text: "Admin accounts & security", link: "/guides/admin-accounts" },
          { text: "CI/CD with GitHub Actions", link: "/guides/ci-cd" },
          { text: "Local development", link: "/guides/local-development" },
          { text: "Testing on a device", link: "/guides/testing-on-device" },
          { text: "Upgrading & migrations", link: "/guides/upgrading" },
          { text: "Moving Cloudflare accounts", link: "/guides/moving-accounts" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "CLI", link: "/reference/cli" },
          { text: "Configuration", link: "/reference/configuration" },
          { text: "Admin HTTP API", link: "/reference/admin-api" },
          { text: "Protocol details", link: "/reference/protocol" },
          { text: "Database schema", link: "/reference/database" },
          { text: "Security model", link: "/reference/security" },
          { text: "Costs & limits", link: "/reference/costs" },
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
