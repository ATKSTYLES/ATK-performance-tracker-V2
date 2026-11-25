import React from 'react';
import { Menu } from 'lucide-react';
import { NAV_ITEMS, NavPageId } from './Sidebar';

interface TopBarProps {
  activePage: NavPageId;
  onOpenMobileMenu: () => void;
  liveSessionName?: string;
  activeTradesCount: number;
  onGoToLiveWorkspace: () => void;
}

export function TopBar({
  activePage,
  onOpenMobileMenu,
  liveSessionName,
  activeTradesCount,
  onGoToLiveWorkspace,
}: TopBarProps) {
  const currentTitle = NAV_ITEMS.find((i) => i.id === activePage)?.label ?? 'ATK Deck';
  const hasLive = Boolean(liveSessionName) || activeTradesCount > 0;

  return (
    <header className="sticky top-0 z-20 h-14 bg-[var(--surface)] border-b border-[var(--border)] px-4 sm:px-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 -ml-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--subtle-surface)] cursor-pointer"
          aria-label="Open navigation menu"
        >
          <Menu className="w-4 h-4" />
        </button>
        <span className="text-sm font-medium text-[var(--text-secondary)] truncate">
          {currentTitle}
        </span>
      </div>

      {hasLive && (
        <button
          type="button"
          onClick={onGoToLiveWorkspace}
          className="h-8 px-3 rounded-lg border border-[var(--border)] bg-[var(--subtle-surface)] hover:bg-[var(--surface)] text-xs font-medium text-[var(--text-primary)] whitespace-nowrap shrink-0 flex items-center gap-2 transition-colors cursor-pointer"
        >
          <span className="text-[var(--positive)] font-semibold">Live</span>
          {liveSessionName && (
            <>
              <span className="text-[var(--text-muted)]">·</span>
              <span>{liveSessionName}</span>
            </>
          )}
          {activeTradesCount > 0 && (
            <>
              <span className="text-[var(--text-muted)]">·</span>
              <span className="font-mono-num">
                {activeTradesCount} active {activeTradesCount === 1 ? 'trade' : 'trades'}
              </span>
            </>
          )}
        </button>
      )}
    </header>
  );
}
