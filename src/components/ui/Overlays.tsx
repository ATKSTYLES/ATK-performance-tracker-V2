import React, { useEffect } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { DestructiveButton, PrimaryButton, SecondaryButton } from './Controls';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidthClass?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  maxWidthClass = 'max-w-2xl',
  footer,
  children,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`w-full ${maxWidthClass} max-h-[90vh] flex flex-col rounded-lg bg-[var(--surface)] border border-[var(--border)] overflow-hidden`}
      >
        <div className="shrink-0 flex items-start justify-between gap-4 px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>
            {subtitle && <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--subtle-surface)] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div className="shrink-0 flex items-center justify-end gap-3 px-5 py-3.5 border-t border-[var(--border)] bg-[var(--subtle-surface)]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  widthClass?: string;
  children: React.ReactNode;
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  widthClass = 'max-w-2xl',
  children,
}: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/45" role="dialog" aria-modal="true">
      <div className="flex-1" onClick={onClose} />
      <div
        className={`w-full ${widthClass} h-full flex flex-col bg-[var(--surface)] border-l border-[var(--border)]`}
      >
        <div className="shrink-0 flex items-start justify-between gap-4 px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>
            {subtitle && <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--subtle-surface)] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

interface ConfirmationDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
}

export function ConfirmationDialog({
  open,
  onCancel,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  destructive = false,
  busy = false,
}: ConfirmationDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      maxWidthClass="max-w-md"
      footer={
        <>
          <SecondaryButton type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </SecondaryButton>
          {destructive ? (
            <DestructiveButton type="button" onClick={onConfirm} disabled={busy}>
              {busy ? 'Working...' : confirmLabel}
            </DestructiveButton>
          ) : (
            <PrimaryButton type="button" onClick={onConfirm} disabled={busy}>
              {busy ? 'Working...' : confirmLabel}
            </PrimaryButton>
          )}
        </>
      }
    >
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{message}</p>
    </Modal>
  );
}

interface ErrorBannerProps {
  title?: string;
  message: string;
  details?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}

export function ErrorBanner({
  title = 'Operation Error',
  message,
  details,
  onRetry,
  onDismiss,
  className = '',
}: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className={`rounded-lg border border-[var(--negative)]/40 bg-[var(--negative-bg)] px-4 py-3 text-sm ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-[var(--negative)] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-semibold text-[var(--negative)]">{title}</div>
            <p className="text-[var(--text-primary)] text-xs leading-relaxed">{message}</p>
            {details && (
              <pre className="text-[11px] font-mono-num text-[var(--text-secondary)] whitespace-pre-wrap break-all pt-1">
                {details}
              </pre>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onRetry && (
            <SecondaryButton size="sm" type="button" onClick={onRetry}>
              Retry
            </SecondaryButton>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss error"
              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
