import React from 'react';
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  ClipboardList,
  History,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Monitor,
  Moon,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import { ThemeMode } from '../../domain/enums';

export type NavPageId =
  | 'dashboard'
  | 'daily_journal'
  | 'records'
  | 'trades'
  | 'calendar'
  | 'analytics'
  | 'reviews'
  | 'settings';

export const NAV_ITEMS: Array<{ id: NavPageId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'daily_journal', label: 'Daily Journal', icon: BookOpen },
  { id: 'records', label: 'Daily / Session Records', icon: History },
  { id: 'trades', label: 'Trades', icon: ListChecks },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'reviews', label: 'Reviews', icon: ClipboardList },
  { id: 'settings', label: 'Settings & Export', icon: Settings },
];

interface SidebarProps {
  activePage: NavPageId;
  onNavigate: (page: NavPageId) => void;
  displayName: string;
  timezone: string;
  preferredCurrency: string;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  onSignOut: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  activePage,
  onNavigate,
  displayName,
  timezone,
  preferredCurrency,
  theme,
  onThemeChange,
  onSignOut,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const navContent = (
    <div className="flex flex-col h-full bg-[var(--surface)] border-r border-[var(--border)] w-[248px]">
      <div className="h-14 px-4 flex items-center justify-between border-b border-[var(--border)] shrink-0">
        <span className="font-heading text-base font-semibold tracking-tight text-[var(--text-primary)] whitespace-nowrap">
          ATK Deck
        </span>
        <button
          type="button"
          onClick={onCloseMobile}
          className="lg:hidden p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
          aria-label="Close navigation menu"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1" aria-label="Main Navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activePage === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onNavigate(item.id);
                onCloseMobile();
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors cursor-pointer text-left ${
                active
                  ? 'bg-[var(--subtle-surface)] text-[var(--text-primary)] border border-[var(--border)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--subtle-surface)]/60 border border-transparent'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="shrink-0 p-3.5 border-t border-[var(--border)] space-y-3 text-xs">
        <div className="space-y-0.5">
          <div className="font-medium text-[var(--text-primary)] truncate">{displayName}</div>
          <div className="text-[11px] text-[var(--text-muted)] font-mono-num truncate">
            {timezone} · {preferredCurrency}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-[var(--text-muted)]">Theme</span>
          <div className="inline-flex items-center p-0.5 rounded-md bg-[var(--subtle-surface)] border border-[var(--border)]">
            {(
              [
                { value: 'light', icon: Sun, label: 'Light theme' },
                { value: 'dark', icon: Moon, label: 'Dark theme' },
                { value: 'system', icon: Monitor, label: 'System theme' },
              ] as const
            ).map((opt) => {
              const Icon = opt.icon;
              const selected = theme === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onThemeChange(opt.value)}
                  aria-label={opt.label}
                  title={opt.label}
                  className={`p-1.5 rounded cursor-pointer transition-colors ${
                    selected
                      ? 'bg-[var(--surface)] text-[var(--text-primary)] border border-[var(--border)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={onSignOut}
          className="w-full h-8 px-2.5 flex items-center gap-2 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--subtle-surface)] border border-[var(--border)] transition-colors cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block fixed inset-y-0 left-0 z-30 w-[248px]">{navContent}</aside>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex bg-black/45">
          {navContent}
          <div className="flex-1" onClick={onCloseMobile} />
        </div>
      )}
    </>
  );
}
