import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';

export interface MenuItem {
  label: string;
  icon?: IconName;
  danger?: boolean;
  hint?: string;
  onSelect: () => void;
}

export function useDismiss(open: boolean, close: () => void, refs: React.RefObject<HTMLElement | null>[]) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (refs.some((ref) => ref.current?.contains(event.target as Node))) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
    };
  }, [open, close, refs]);
}

export function Menu({
  anchor,
  items,
  onClose,
  align = 'end'
}: {
  anchor: { x: number; y: number } | DOMRect;
  items: MenuItem[];
  onClose: () => void;
  align?: 'start' | 'end';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });
  useDismiss(true, onClose, [ref]);
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const isRect = 'width' in anchor;
    let left = isRect ? (align === 'end' ? anchor.right - rect.width : anchor.left) : anchor.x;
    let top = isRect ? anchor.bottom + 6 : anchor.y;
    left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8));
    if (top + rect.height > window.innerHeight - 8) top = Math.max(8, (isRect ? anchor.top - 6 : anchor.y) - rect.height);
    setPosition({ left, top });
  }, [anchor, align]);
  return createPortal(
    <div ref={ref} className="menu" style={position} role="menu">
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          className={`menu-item${item.danger ? ' danger' : ''}`}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.icon && <Icon name={item.icon} size={16} />}
          <span>{item.label}</span>
          {item.hint && <kbd>{item.hint}</kbd>}
        </button>
      ))}
    </div>,
    document.body
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div
      className="backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={ref} className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}

export function Toasts({ toasts, dismiss }: { toasts: { id: number; text: string; tone: 'info' | 'error' }[]; dismiss: (id: number) => void }) {
  return createPortal(
    <div className="toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.tone}`} onClick={() => dismiss(toast.id)}>
          <Icon name={toast.tone === 'error' ? 'alert' : 'check'} size={16} />
          <span>{toast.text}</span>
        </div>
      ))}
    </div>,
    document.body
  );
}
