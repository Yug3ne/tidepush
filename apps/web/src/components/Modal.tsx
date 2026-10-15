import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import { Icon } from "./Icon";
import { Notice } from "./Notice";

interface ModalProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  /** When given, the body + footer are a <form> and Enter submits. */
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  /** Block closing (Esc / backdrop / x) while a request is in flight. */
  busy?: boolean;
}

/**
 * Native <dialog> opened with showModal(): the browser provides the focus trap,
 * inert background, Esc handling and top layer. Focus returns to the opener on close.
 */
export function Modal({ open, title, description, onClose, children, footer, onSubmit, busy }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
      // Return focus to the opener; if it disappeared (e.g. its row changed), to the main region.
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
      else document.getElementById("main")?.focus();
    }
  }, [open]);

  const inner = (
    <>
      <div className="modal-header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descId}>{description}</p>}
        </div>
        <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label="Close">
          <Icon name="x" />
        </button>
      </div>
      <div className="modal-body">{children}</div>
      <div className="modal-footer">{footer}</div>
    </>
  );

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself, outside its content box).
        if (e.target === ref.current && !busy) {
          const r = ref.current.getBoundingClientRect();
          const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
          if (!inside) onClose();
        }
      }}
    >
      {open &&
        (onSubmit ? (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit(e);
            }}
          >
            {inner}
          </form>
        ) : (
          inner
        ))}
    </dialog>
  );
}

interface ConfirmProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmModal({ open, title, children, confirmLabel, danger, busy, error, onConfirm, onClose }: ConfirmProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      busy={busy}
      onSubmit={onConfirm}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={`btn ${danger ? "btn-danger" : "btn-primary"}`} disabled={busy} autoFocus>
            {busy && <span className="spinner" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      {children}
      {error && <Notice tone="error">{error}</Notice>}
    </Modal>
  );
}
