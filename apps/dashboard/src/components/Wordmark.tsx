import { Link } from "react-router";

export function LogoMark() {
  return (
    <svg className="wordmark-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="9" fill="#10263E" />
      <path
        d="M5.5 21.5c2.3-2.4 4.7-2.4 7 0s4.7 2.4 7 0 4.7-2.4 7 0"
        stroke="#18D26E"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M16 16V7.5M12.5 11 16 7.5l3.5 3.5"
        stroke="#FFFFFF"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function Wordmark({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="wordmark" aria-label="Tidepush home">
      <LogoMark />
      <span>
        Tide<span className="wordmark-accent">push</span>
      </span>
    </Link>
  );
}
