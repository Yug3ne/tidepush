import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

interface FieldShellProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
}

function FieldShell({ label, hint, error, children, className }: FieldShellProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field ${className ?? ""}`}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {hint && (
        <span className="field-hint" id={hintId}>
          {hint}
        </span>
      )}
      {error && (
        <span className="field-error" id={errId}>
          {error}
        </span>
      )}
    </div>
  );
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  mono?: boolean;
};

export function TextField({ label, hint, error, mono, className, ...rest }: InputProps) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          className={`input ${mono ? "mono" : ""} ${className ?? ""}`}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

export function PasswordField({ label, hint, error, className, ...rest }: Omit<InputProps, "type" | "mono">) {
  const [shown, setShown] = useState(false);
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <div className="input-group">
          <input
            id={id}
            type={shown ? "text" : "password"}
            className={`input ${className ?? ""}`}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            spellCheck={false}
            autoCapitalize="off"
            {...rest}
          />
          <button
            type="button"
            className="input-addon"
            aria-pressed={shown}
            aria-label={shown ? "Hide password" : "Show password"}
            onClick={() => setShown((s) => !s)}
          >
            {shown ? "Hide" : "Show"}
          </button>
        </div>
      )}
    </FieldShell>
  );
}

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  options: { value: string; label: string }[];
};

export function SelectField({ label, hint, error, options, className, ...rest }: SelectProps) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          className={`select ${className ?? ""}`}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          {...rest}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;

export function validatePassword(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (pw.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  return null;
}

export function validateEmail(email: string): string | null {
  const e = email.trim();
  if (!e) return "Enter an email address.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "Enter a valid email address.";
  return null;
}

/** After a failed submit, move focus to the first invalid field (once React has rendered the errors). */
export function focusFirstInvalid(form: HTMLFormElement | null) {
  requestAnimationFrame(() => form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}
