import React, { useCallback, useEffect, useState } from 'react';
import { AuthGate } from './components/AuthGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { NavPageId, Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { TradeClosureModal } from './components/trading/TradeClosureModal';
import { LoadingState } from './components/ui/DataDisplay';
import { ErrorBanner } from './components/ui/Overlays';
import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext';
import { Trade } from './domain/types';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { CalendarPage } from './pages/CalendarPage';
import { DailyJournalPage } from './pages/DailyJournalPage';
import { DashboardPage } from './pages/DashboardPage';
import { RecordsPage } from './pages/RecordsPage';
import { ReviewsPage } from './pages/ReviewsPage';
import { SettingsExportPage } from './pages/SettingsExportPage';
import { TradesPage } from './pages/TradesPage';

const HASH_TO_PAGE: Record<string, NavPageId> = {
  '': 'daily_journal',
  dashboard: 'dashboard',
  'daily-journal': 'daily_journal',
  daily_journal: 'daily_journal',
  records: 'records',
  trades: 'trades',
  calendar: 'calendar',
  analytics: 'analytics',
  reviews: 'reviews',
  settings: 'settings',
};

const PAGE_TO_HASH: Record<NavPageId, string> = {
  dashboard: '#/dashboard',
  daily_journal: '#/daily-journal',
  records: '#/records',
  trades: '#/trades',
  calendar: '#/calendar',
  analytics: '#/analytics',
  reviews: '#/reviews',
  settings: '#/settings',
};

function resolveInitialRoute(): { page: NavPageId; invalidHash: string | null } {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0].toLowerCase().trim();
  if (raw in HASH_TO_PAGE) {
    return { page: HASH_TO_PAGE[raw], invalidHash: null };
  }
  return { page: 'daily_journal', invalidHash: raw || null };
}

function WorkspaceShell() {
  const {
    user,
    dataLoading,
    syncError,
    dismissSyncError,
    preferences,
    timezone,
    preferredCurrency,
    theme,
    setThemeMode,
    signOutUser,
    liveSession,
    openTrades,
    refreshDiagnostics,
  } = useWorkspace();

  const initialRoute = resolveInitialRoute();
  const [activePage, setActivePage] = useState<NavPageId>(initialRoute.page);
  const [invalidRouteNotice, setInvalidRouteNotice] = useState<string | null>(
    initialRoute.invalidHash
      ? `Unknown route "#/${initialRoute.invalidHash}" redirected to Daily Journal.`
      : null
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [recordsSelectedDate, setRecordsSelectedDate] = useState<string | undefined>(undefined);
  const [globalClosingTrade, setGlobalClosingTrade] = useState<Trade | null>(null);

  const navigateTo = useCallback((page: NavPageId) => {
    setActivePage(page);
    setInvalidRouteNotice(null);
    const targetHash = PAGE_TO_HASH[page];
    if (window.location.hash !== targetHash) {
      window.location.hash = targetHash;
    }
  }, []);

  useEffect(() => {
    if (!window.location.hash) {
      window.history.replaceState(null, '', PAGE_TO_HASH[activePage]);
    } else if (initialRoute.invalidHash) {
      window.history.replaceState(null, '', PAGE_TO_HASH[activePage]);
    }
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0].toLowerCase().trim();
      if (raw in HASH_TO_PAGE) {
        setActivePage(HASH_TO_PAGE[raw]);
        setInvalidRouteNotice(null);
      } else if (raw) {
        setActivePage('daily_journal');
        setInvalidRouteNotice(`Unknown route "#/${raw}" redirected to Daily Journal.`);
        window.history.replaceState(null, '', PAGE_TO_HASH.daily_journal);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const displayName = preferences?.displayName || user?.displayName || 'Trader';

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--text-primary)] flex">
      <Sidebar
        activePage={activePage}
        onNavigate={navigateTo}
        displayName={displayName}
        timezone={timezone}
        preferredCurrency={preferredCurrency}
        theme={theme}
        onThemeChange={(t) => void setThemeMode(t)}
        onSignOut={() => void signOutUser()}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 lg:pl-[248px] flex flex-col min-w-0 min-h-screen">
        <TopBar
          activePage={activePage}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          liveSessionName={liveSession?.sessionName}
          activeTradesCount={openTrades.length}
          onGoToLiveWorkspace={() => navigateTo('daily_journal')}
        />

        <main className="flex-1 w-full max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
          {invalidRouteNotice && (
            <ErrorBanner
              title="Route Notice"
              message={invalidRouteNotice}
              onDismiss={() => setInvalidRouteNotice(null)}
            />
          )}

          {syncError && (
            <ErrorBanner
              title="Workspace Sync Interrupted"
              message={syncError}
              onDismiss={dismissSyncError}
            />
          )}

          {dataLoading ? (
            <LoadingState label="Synchronizing your trading workspace..." />
          ) : (
            <>
              {activePage === 'dashboard' && (
                <DashboardPage
                  onRequestCloseTrade={setGlobalClosingTrade}
                  onNavigate={navigateTo}
                />
              )}
              {activePage === 'daily_journal' && <DailyJournalPage />}
              {activePage === 'records' && (
                <RecordsPage
                  selectedDateProp={recordsSelectedDate}
                  onRequestCloseTrade={setGlobalClosingTrade}
                />
              )}
              {activePage === 'trades' && (
                <TradesPage onRequestCloseTrade={setGlobalClosingTrade} />
              )}
              {activePage === 'calendar' && (
                <CalendarPage
                  onOpenDateRecords={(date) => {
                    setRecordsSelectedDate(date);
                    navigateTo('records');
                  }}
                  onRequestCloseTrade={setGlobalClosingTrade}
                />
              )}
              {activePage === 'analytics' && <AnalyticsPage />}
              {activePage === 'reviews' && <ReviewsPage />}
              {activePage === 'settings' && <SettingsExportPage />}
            </>
          )}
        </main>
      </div>

      <TradeClosureModal
        open={Boolean(globalClosingTrade)}
        trade={globalClosingTrade}
        userId={user?.uid ?? ''}
        onClose={() => setGlobalClosingTrade(null)}
        onSuccess={() => setGlobalClosingTrade(null)}
        onDiagnosticRecorded={refreshDiagnostics}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <WorkspaceProvider>
        <AuthGate>
          <WorkspaceShell />
        </AuthGate>
      </WorkspaceProvider>
    </ErrorBoundary>
  );
}
