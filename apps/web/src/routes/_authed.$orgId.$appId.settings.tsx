import { createFileRoute } from "@tanstack/react-router";
import { AppSettingsPage } from "../pages/AppSettings";

export const Route = createFileRoute("/_authed/$orgId/$appId/settings")({
  head: () => ({ meta: [{ title: "App settings · Tidepush" }] }),
  component: AppSettingsPage,
});
