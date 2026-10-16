import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type Tone = "error" | "warning" | "info" | "success";
const ICONS: Record<Tone, IconName> = { error: "alert", warning: "alert", info: "info", success: "check" };

export function Notice({ tone, children, live = true }: { tone: Tone; children: ReactNode; live?: boolean }) {
  return (
    <div className={`notice notice-${tone}`} role={live ? (tone === "error" ? "alert" : "status") : undefined}>
      <Icon name={ICONS[tone]} size={16} />
      <div>{children}</div>
    </div>
  );
}
