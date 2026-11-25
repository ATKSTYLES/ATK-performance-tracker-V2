import React from 'react';
import { formatTimestampInTimezone } from '../../domain/timezone';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-5 border-b border-[var(--border)]">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">{title}</h1>
        {subtitle && <p className="text-xs text-[var(--text-muted)] mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}

interface MetricDisplayProps {
  label: string;
  value: string;
  sublabel?: string;
  tone?: 'default' | 'positive' | 'negative' | 'caution' | 'info';
}

export function MetricDisplay({ label, value, sublabel, tone = 'default' }: MetricDisplayProps) {
  const toneClass =
    tone === 'positive'
      ? 'text-[var(--positive)]'
      : tone === 'negative'
      ? 'text-[var(--negative)]'
      : tone === 'caution'
      ? 'text-[var(--caution)]'
      : tone === 'info'
      ? 'text-[var(--info)]'
      : 'text-[var(--text-primary)]';

  return (
    <div className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
      <span className={`text-lg font-semibold font-mono-num tracking-tight ${toneClass}`}>
        {value}
      </span>
      {sublabel && <span className="text-[11px] text-[var(--text-muted)]">{sublabel}</span>}
    </div>
  );
}

interface ChartContainerProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function ChartContainer({ title, subtitle, actions, children }: ChartContainerProps) {
  return (
    <section className="p-5 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-[var(--border)]">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
          {subtitle && <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div className="pt-4">{children}</div>
    </section>
  );
}

export interface DataColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  render: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Array<DataColumn<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  onRowMouseEnter?: (row: T) => void;
  onRowMouseLeave?: (row: T) => void;
  emptyMessage?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowClassName,
  onRowMouseEnter,
  onRowMouseLeave,
  emptyMessage = 'No records available.',
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-[var(--text-muted)] border border-[var(--border)] rounded-lg bg-[var(--surface)]">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--subtle-surface)]">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`h-9 px-3 font-medium text-[var(--text-secondary)] whitespace-nowrap ${
                  col.align === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onMouseEnter={onRowMouseEnter ? () => onRowMouseEnter(row) : undefined}
              onMouseLeave={onRowMouseLeave ? () => onRowMouseLeave(row) : undefined}
              className={`h-10 transition-colors ${
                onRowClick ? 'hover:bg-[var(--subtle-surface)] cursor-pointer' : ''
              } ${rowClassName ? rowClassName(row) : ''}`}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-3 py-2 text-[var(--text-primary)] whitespace-nowrap ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="p-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-center flex flex-col items-center justify-center gap-2">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
      <p className="text-xs text-[var(--text-muted)] max-w-md">{description}</p>
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = 'Loading records...' }: { label?: string }) {
  return (
    <div className="p-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] flex flex-col items-center justify-center gap-2">
      <div className="w-5 h-5 rounded-full border-2 border-[var(--border)] border-t-[var(--text-primary)] animate-spin" />
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
    </div>
  );
}

export interface TimelineItem {
  id: string;
  timestamp: string;
  label: string;
  description: string;
}

export function Timeline({
  items,
  timezone,
  emptyLabel = 'No events recorded yet.',
}: {
  items: TimelineItem[];
  timezone: string;
  emptyLabel?: string;
}) {
  if (items.length === 0) {
    return <p className="text-xs text-[var(--text-muted)] py-3">{emptyLabel}</p>;
  }

  return (
    <ol className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg bg-[var(--surface)]">
      {items.map((item) => (
        <li key={item.id} className="px-3.5 py-2.5 flex items-start justify-between gap-3 text-xs">
          <div className="space-y-0.5 min-w-0">
            <div className="font-medium text-[var(--text-primary)]">{item.label}</div>
            {item.description && (
              <p className="text-[var(--text-secondary)] break-words">{item.description}</p>
            )}
          </div>
          <span className="font-mono-num text-[11px] text-[var(--text-muted)] shrink-0">
            {formatTimestampInTimezone(item.timestamp, timezone)}
          </span>
        </li>
      ))}
    </ol>
  );
}
