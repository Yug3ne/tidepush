// @ts-check
import { defineConfig, passthroughImageService } from "astro/config";
import starlight from "@astrojs/starlight";
import { repo } from "./src/components/links.ts";

export default defineConfig({
  site: "https://tidepush-website.yugenecodes99.workers.dev",
  // /guide/concepts is built as guide/concepts.html, so URLs stay the same as before.
  trailingSlash: "never",
  build: { format: "file" },
  // The site has no raster images to optimize, so skip sharp.
  image: { service: passthroughImageService() },
  integrations: [
    starlight({
      title: "Tidepush",
      description: "OTA updates for Expo apps. Signed, staged, instantly reversible.",
      logo: { src: "./src/assets/logo.svg", alt: "" },
      favicon: "/favicon.svg",
      head: [{ tag: "meta", attrs: { name: "theme-color", content: "#10263E" } }],
      social: [{ icon: "github", label: "GitHub", href: repo }],
      editLink: { baseUrl: `${repo}/edit/main/apps/website/` },
      lastUpdated: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      customCss: [
        "@fontsource/space-grotesk/latin-500.css",
        "@fontsource/space-grotesk/latin-600.css",
        "@fontsource/space-grotesk/latin-700.css",
        "@fontsource/nunito/latin-400.css",
        "@fontsource/nunito/latin-600.css",
        "@fontsource/nunito/latin-700.css",
        "@fontsource/source-code-pro/latin-500.css",
        "./src/styles/theme.css",
        "./src/styles/docs.css",
      ],
      components: {
        SocialIcons: "./src/components/NavLinks.astro",
        Footer: "./src/components/Footer.astro",
      },
      sidebar: [
        {
          label: "Introduction",
          items: [
            { label: "What is Tidepush?", slug: "guide/what-is-tidepush" },
            { label: "What are OTA updates?", slug: "guide/ota-updates" },
            { label: "Key concepts", slug: "guide/concepts" },
            { label: "How it works", slug: "guide/how-it-works" },
          ],
        },
        {
          label: "Getting started",
          items: [{ label: "Tutorial: zero to first update", slug: "guide/getting-started" }],
        },
        {
          label: "Guides",
          items: [
            { label: "Channels & promoting", slug: "guides/channels" },
            { label: "Staged rollouts", slug: "guides/staged-rollouts" },
            { label: "Rollbacks", slug: "guides/rollbacks" },
            { label: "Code signing & keys", slug: "guides/code-signing" },
            { label: "Team & access", slug: "guides/team-and-access" },
            { label: "CI/CD with GitHub Actions", slug: "guides/ci-cd" },
            { label: "Testing on a device", slug: "guides/testing-on-device" },
            { label: "Moving from EAS Update", slug: "guides/moving-from-eas" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "CLI", slug: "reference/cli" },
            { label: "Protocol details", slug: "reference/protocol" },
            { label: "Security", slug: "reference/security" },
            { label: "Plans & limits", slug: "reference/limits" },
          ],
        },
        {
          label: "Help",
          items: [
            { label: "Troubleshooting", slug: "troubleshooting" },
            { label: "FAQ", slug: "faq" },
          ],
        },
        {
          label: "Project",
          items: [
            { label: "Self-hosting", slug: "self-hosting" },
            { label: "License", slug: "license" },
            { label: "Contributing", slug: "contributing" },
          ],
        },
      ],
    }),
  ],
});
