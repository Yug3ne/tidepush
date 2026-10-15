import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import Landing from "./components/Landing.vue";
import ArchDiagram from "./components/ArchDiagram.vue";
import "@fontsource/space-grotesk/latin-500.css";
import "@fontsource/space-grotesk/latin-600.css";
import "@fontsource/space-grotesk/latin-700.css";
import "@fontsource/nunito/latin-400.css";
import "@fontsource/nunito/latin-600.css";
import "@fontsource/nunito/latin-700.css";
import "@fontsource/source-code-pro/latin-500.css";
import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("Landing", Landing);
    app.component("ArchDiagram", ArchDiagram);
  },
} satisfies Theme;
