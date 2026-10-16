import type { ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./Wordmark";

export function AuthLayout({ children, foot }: { children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-top">
        <Wordmark to="/login" />
        <ThemeToggle />
      </div>
      <main className="auth-card">{children}</main>
      <p className="auth-foot">{foot ?? "OTA updates for Expo apps."}</p>
    </div>
  );
}
