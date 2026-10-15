import { useThemePreference, type ThemePreference } from "../theme";
import { Icon, type IconName } from "./Icon";

const OPTIONS: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: "system", label: "System theme", icon: "monitor" },
  { value: "light", label: "Light theme", icon: "sun" },
  { value: "dark", label: "Dark theme", icon: "moon" },
];

export function ThemeToggle() {
  const [pref, setPref] = useThemePreference();
  return (
    <div className="segmented theme-toggle" role="radiogroup" aria-label="Theme">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={pref === o.value}
          aria-label={o.label}
          title={o.label}
          onClick={() => setPref(o.value)}
        >
          <Icon name={o.icon} size={16} />
        </button>
      ))}
    </div>
  );
}
