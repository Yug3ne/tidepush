import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "../pages/Settings";

export const Route = createFileRoute("/_authed/$orgId/settings")({
  head: () => ({ meta: [{ title: "Settings · Tidepush" }] }),
  component: SettingsPage,
});
