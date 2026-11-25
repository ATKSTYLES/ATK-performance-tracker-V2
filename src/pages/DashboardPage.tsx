import React, { useMemo, useState } from 'react';
import { ArrowRight, PlayCircle } from 'lucide-react';
import { EquityCurveChart } from '../components/charts/EquityCurveChart';
import { NavPageId } from '../components/layout/Sidebar';
import { SessionDetailDrawer } from '../components/trading/SessionDetailDrawer';
import { TradeInspectorDrawer } from '../components/trading/TradeInspectorDrawer';
import {
  DatePicker,
  PrimaryButton,
  SecondaryButton,
  SegmentedControl,
  SelectInput,
} from '../components/ui/Controls';
import {
  ChartContainer,
  DataColumn,
  DataTable,
  PageHeader,
} from '../components/ui/DataDisplay';
import { useWorkspace } from '../context/WorkspaceContext';
import {
  AccountBreakdownRow,
  buildAccountFilterOptions,
  calculateAccountBreakdown,
  calculateActivityMetrics,
  calculateDisciplineMetrics,
  calculateFinancialMetrics,
  computeDateRangeBounds,
  DateRangePreset,
  getSessionLinkedTrades,
  groupCurrencyNetPnl,
  isActiveTrade,
  scopeWorkspaceRecords,
} from '../domain/calculations';
import {
  EXIT_OUTCOME_LABELS,
  SESSION_ATTENDANCE_LABELS,
  SESSION_STATUS_LABELS,
} from '../domain/enums';
import {
  formatDurationMinutes,
  formatTimestampInTimezone,
  getTodayInTimezone,
} from '../domain/timezone';
import { Trade, TradingSession } from '../domain/types';
import { useSyncedAnalyticsScope } from '../hooks/useSyncedAnalyticsScope';

function describeRangeScope(
  preset: DateRangePreset,
  bounds: { start: string; end: string }
): string {
  if (preset === 'all') return 'All Dates';
  if (preset === 'today') return `Today (${bounds.start})`;
  if (preset === 'custom') return `${bounds.start || 'Start'} to ${bounds.end || 'End'}`;
  return `${preset.toUpperCase()} (${bounds.start} to ${bounds.end})`;
}

export function DashboardPage({
  onRequestCloseTrade,
  onNavigate,
}: {
  onRequestCloseTrade: (trade: Trade) => void;
  onNavigate?: (page: NavPageId) => void;
}) {
  const {
    user,
    accounts,
    dailyJournals,
    sessions,
    sessionEvents,
    activeTrades,
    openTrades,
    trades,
    tradeEvents,
    attachments,
    liveSession,
    timezone,
    preferredCurrency,
  } = useWorkspace();

  const today = getTodayInTimezone(timezone);
  const currentMonth = today.slice(0, 7);
  const {
    rangePreset,
    customStart,
    customEnd,
    accountId: selectedAccountId,
    setRangePreset,
    setCustomStart,
    setCustomEnd,
    setAccountId: setSelectedAccountId,
  } = useSyncedAnalyticsScope(today);

  const [inspectedTrade, setInspectedTrade] = useState<Trade | null>(null);
  const [selectedSession, setSelectedSession] = useState<TradingSession | null>(null);

  const rangeBounds = useMemo(
    () => computeDateRangeBounds(rangePreset, today, customStart, customEnd),
    [rangePreset, today, customStart, customEnd]
  );

  const {
    accountScopedTrades: accountScopedActiveTrades,
    rangeTrades,
    rangeSessions,
    rangeSessionEvents,
    rangeJournals,
  } = useMemo(
    () =>
      scopeWorkspaceRecords({
        sessions,
        sessionEvents,
        trades: activeTrades,
        dailyJournals,
        bounds: rangeBounds,
        accountId: selectedAccountId,
      }),
    [sessions, sessionEvents, activeTrades, dailyJournals, rangeBounds, selectedAccountId]
  );

  const accountFilterOptions = useMemo(
    () => buildAccountFilterOptions(accounts, activeTrades),
    [accounts, activeTrades]
  );

  const todayFin = useMemo(
    () =>
      calculateFinancialMetrics(
        accountScopedActiveTrades.filter((t) => t.date === today)
      ),
    [accountScopedActiveTrades, today]
  );

  const monthFin = useMemo(
    () =>
      calculateFinancialMetrics(
        accountScopedActiveTrades.filter((t) => t.date.startsWith(currentMonth))
      ),
    [accountScopedActiveTrades, currentMonth]
  );

  const fin = useMemo(() => calculateFinancialMetrics(rangeTrades), [rangeTrades]);
  const act = useMemo(
    () => calculateActivityMetrics(rangeSessions, rangeTrades),
    [rangeSessions, rangeTrades]
  );
  const disc = useMemo(
    () => calculateDisciplineMetrics(rangeTrades, rangeSessionEvents, rangeJournals),
    [rangeTrades, rangeSessionEvents, rangeJournals]
  );

  const rangeMonetaryByCurrency = useMemo(
    () => groupCurrencyNetPnl(rangeTrades, accounts, preferredCurrency),
    [rangeTrades, accounts, preferredCurrency]
  );

  const accountBreakdown = useMemo(
    () => calculateAccountBreakdown(rangeTrades, accounts, preferredCurrency),
    [rangeTrades, accounts, preferredCurrency]
  );

  const accountCurrencyLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const acc of accounts) {
      if (acc.id && acc.currency) {
        map.set(acc.id, acc.currency.toUpperCase());
      }
    }
    return map;
  }, [accounts]);

  const scopedOpenTrades = useMemo(
    () =>
      openTrades.filter(
        (t) => selectedAccountId === 'all' || t.accountId === selectedAccountId
      ),
    [openTrades, selectedAccountId]
  );

  const recentTrades = useMemo(
    () =>
      [...rangeTrades]
        .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
        .slice(0, 8),
    [rangeTrades]
  );

  const recentSessions = useMemo(
    () => rangeSessions.slice(0, 6),
    [rangeSessions]
  );

  const activeDrawerSession = selectedSession
    ? sessions.find((s) => s.id === selectedSession.id) ?? selectedSession
    : null;

  const profitFactorText =
    fin.closedTradesCount === 0
      ? '—'
      : fin.profitFactor === null
      ? 'No Losses'
      : fin.profitFactor.toFixed(2);

  const currencyHeadline =
    rangeMonetaryByCurrency.length === 0
      ? 'No monetary P&L logged'
      : rangeMonetaryByCurrency
          .map(
            (c) =>
              `${c.netPnl >= 0 ? '+' : ''}${c.netPnl.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} ${c.currency}`
          )
          .join(' · ');

  const scopeSummaryText = describeRangeScope(rangePreset, rangeBounds);

  const accountColumns: Array<DataColumn<AccountBreakdownRow>> = [
    {
      key: 'account',
      header: 'Account',
      render: (r) => (
        <div>
          <div className="font-semibold text-[var(--text-primary)]">{r.accountName}</div>
          <div className="text-[11px] font-mono-num text-[var(--text-muted)]">{r.currency}</div>
        </div>
      ),
    },
    {
      key: 'closed',
      header: 'Trades',
      align: 'right',
      render: (r) => (
        <span className="font-mono-num text-[var(--text-secondary)]">
          {r.closedTrades}
          {r.openTrades > 0 ? ` (+${r.openTrades})` : ''}
        </span>
      ),
    },
    {
      key: 'winRate',
      header: 'Win Rate',
      align: 'right',
      render: (r) => (
        <span className="font-mono-num">
          {r.winRate !== null ? `${r.winRate}%` : '—'}
        </span>
      ),
    },
    {
      key: 'netPercent',
      header: 'Net %',
      align: 'right',
      render: (r) => (
        <span
          className={`font-mono-num font-semibold ${
            r.netProfitPercent > 0
              ? 'text-[var(--positive)]'
              : r.netProfitPercent < 0
              ? 'text-[var(--negative)]'
              : 'text-[var(--text-primary)]'
          }`}
        >
          {r.netProfitPercent >= 0 ? '+' : ''}
          {r.netProfitPercent}%
        </span>
      ),
    },
    {
      key: 'netPnl',
      header: 'Monetary P&L',
      align: 'right',
      render: (r) => (
        <span className="font-mono-num text-[var(--text-secondary)]">
          {r.netMonetaryPnl !== null
            ? `${r.netMonetaryPnl >= 0 ? '+' : ''}${r.netMonetaryPnl.toFixed(2)} ${r.currency}`
            : '—'}
        </span>
      ),
    },
  ];

  const recentTradeColumns: Array<DataColumn<Trade>> = [
    {
      key: 'date',
      header: 'Date',
      render: (t) => <span className="font-mono-num text-[var(--text-muted)]">{t.date}</span>,
    },
    {
      key: 'pair',
      header: 'Instrument',
      render: (t) => (
        <div>
          <span className="font-semibold text-[var(--text-primary)]">{t.instrument}</span>{' '}
          <span
            className={`text-[11px] font-medium ${
              t.direction === 'long' ? 'text-[var(--positive)]' : 'text-[var(--negative)]'
            }`}
          >
            {t.direction === 'long' ? 'Buy' : 'Sell'}
          </span>
        </div>
      ),
    },
    {
      key: 'account',
      header: 'Account',
      render: (t) => <span className="text-[var(--text-secondary)]">{t.accountName}</span>,
    },
    {
      key: 'outcome',
      header: 'Outcome',
      render: (t) => (
        <span
          className={
            t.exitOutcome === 'win'
              ? 'text-[var(--positive)] font-medium'
              : t.exitOutcome === 'loss'
              ? 'text-[var(--negative)] font-medium'
              : 'text-[var(--text-muted)]'
          }
        >
          {EXIT_OUTCOME_LABELS[t.exitOutcome]}
        </span>
      ),
    },
    {
      key: 'return',
      header: 'Return',
      align: 'right',
      render: (t) => {
        const cur = (
          t.currency ||
          accountCurrencyLookup.get(t.accountId) ||
          preferredCurrency ||
          'USD'
        ).toUpperCase();
        return (
          <div className="text-right font-mono-num">
            <div>
              {typeof t.actualProfitPercent === 'number' ? (
                <span
                  className={
                    t.actualProfitPercent > 0
                      ? 'text-[var(--positive)] font-semibold'
                      : t.actualProfitPercent < 0
                      ? 'text-[var(--negative)] font-semibold'
                      : ''
                  }
                >
                  {t.actualProfitPercent >= 0 ? '+' : ''}
                  {t.actualProfitPercent}%
                </span>
              ) : (
                <span className="text-[var(--text-muted)]">Open</span>
              )}
            </div>
            {typeof t.netPnl === 'number' && (
              <div className="text-[11px] text-[var(--text-muted)]">
                {t.netPnl >= 0 ? '+' : ''}
                {t.netPnl.toFixed(2)} {cur}
              </div>
            )}
          </div>
        );
      },
    },
  ];

  const recentSessionColumns: Array<DataColumn<TradingSession>> = [
    {
      key: 'date',
      header: 'Date',
      render: (s) => <span className="font-mono-num text-[var(--text-muted)]">{s.date}</span>,
    },
    {
      key: 'name',
      header: 'Session',
      render: (s) => (
        <div>
          <div className="font-medium text-[var(--text-primary)]">{s.sessionName}</div>
          {s.actualStartTime && (
            <div className="text-[11px] font-mono-num text-[var(--text-muted)]">
              {formatTimestampInTimezone(s.actualStartTime, timezone)}
              {s.actualEndTime
                ? ` – ${formatTimestampInTimezone(s.actualEndTime, timezone)}`
                : ''}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (s) => (
        <div className="text-[var(--text-secondary)]">
          <div>{SESSION_STATUS_LABELS[s.status]}</div>
          <div className="text-[11px] text-[var(--text-muted)]">
            {SESSION_ATTENDANCE_LABELS[s.attendance]}
          </div>
        </div>
      ),
    },
    {
      key: 'duration',
      header: 'Duration',
      align: 'right',
      render: (s) => (
        <span className="font-mono-num text-[var(--text-muted)]">
          {s.actualStartTime ? formatDurationMinutes(s.actualStartTime, s.actualEndTime) : '—'}
        </span>
      ),
    },
    {
      key: 'trades',
      header: 'Trades',
      align: 'right',
      render: (s) => (
        <span className="font-mono-num">
          {getSessionLinkedTrades(s.id, accountScopedActiveTrades).length}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle={`Synced scope: ${scopeSummaryText} · ${act.totalSessions} session(s) · ${fin.totalTrades} trade(s) (${timezone})`}
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="w-44">
              <SelectInput
                value={selectedAccountId}
                onChange={setSelectedAccountId}
                options={accountFilterOptions}
              />
            </div>
            <SegmentedControl
              value={rangePreset}
              onChange={setRangePreset}
              options={[
                { value: 'today', label: 'Today' },
                { value: '7d', label: '7D' },
                { value: '30d', label: '30D' },
                { value: '90d', label: '90D' },
                { value: 'all', label: 'All' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
          </div>
        }
      />

      {rangePreset === 'custom' && (
        <section className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
          <DatePicker label="From" value={customStart} onChange={setCustomStart} />
          <DatePicker label="To" value={customEnd} onChange={setCustomEnd} />
        </section>
      )}

      {/* Live Desk Command Strip */}
      <section className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs font-medium text-[var(--text-muted)]">Live Desk Status</div>
          {liveSession ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-[var(--positive)]">
                Session Live: {liveSession.sessionName}
              </span>
              <span className="text-[var(--text-muted)]">·</span>
              <span className="font-mono-num text-xs text-[var(--text-secondary)]">
                Started {formatTimestampInTimezone(liveSession.actualStartTime, timezone)} (
                {formatDurationMinutes(liveSession.actualStartTime)})
              </span>
            </div>
          ) : (
            <div className="text-sm text-[var(--text-secondary)]">
              No live trading session active right now.
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="text-xs font-mono-num text-[var(--text-secondary)]">
            Active Positions:{' '}
            <strong className="text-[var(--text-primary)]">{scopedOpenTrades.length}</strong>
          </div>
          {onNavigate && (
            <SecondaryButton size="sm" type="button" onClick={() => onNavigate('daily_journal')}>
              <PlayCircle className="w-3.5 h-3.5" />
              {liveSession ? 'Return to Live Logger' : 'Open Daily Journal'}
            </SecondaryButton>
          )}
          {onNavigate && (
            <SecondaryButton size="sm" type="button" onClick={() => onNavigate('trades')}>
              Master Ledger
              <ArrowRight className="w-3.5 h-3.5" />
            </SecondaryButton>
          )}
        </div>
      </section>

      {/* Active Open Positions (Quick Inspection & Closure) */}
      {scopedOpenTrades.length > 0 && (
        <section className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Active Open Positions ({scopedOpenTrades.length})
            </h2>
            <span className="text-xs text-[var(--text-muted)]">
              Excluded from closed-trade win rate &amp; realized P&amp;L
            </span>
          </div>
          <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg">
            {scopedOpenTrades.map((t) => (
              <div
                key={t.id}
                className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs hover:bg-[var(--subtle-surface)]"
              >
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="font-semibold text-[var(--text-primary)]">{t.instrument}</span>
                  <span
                    className={
                      t.direction === 'long'
                        ? 'text-[var(--positive)] font-medium'
                        : 'text-[var(--negative)] font-medium'
                    }
                  >
                    {t.direction === 'long' ? 'Buy' : 'Sell'}
                  </span>
                  <span className="text-[var(--text-muted)]">·</span>
                  <span className="text-[var(--text-secondary)]">{t.accountName}</span>
                  <span className="text-[var(--text-muted)]">·</span>
                  <span className="font-mono-num text-[var(--text-muted)]">
                    Risk {t.riskPercent}% / Target {t.expectedProfitPercent}% · Open{' '}
                    {formatDurationMinutes(t.openedAt)}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <SecondaryButton size="sm" type="button" onClick={() => setInspectedTrade(t)}>
                    Inspect
                  </SecondaryButton>
                  <PrimaryButton size="sm" type="button" onClick={() => onRequestCloseTrade(t)}>
                    Close Trade
                  </PrimaryButton>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Primary KPI Grid (Single Precision Financial Band + Discipline Context) */}
      <section className="grid grid-cols-2 sm:grid-cols-4 border border-[var(--border)] rounded-lg bg-[var(--surface)] divide-y sm:divide-y-0 sm:divide-x divide-[var(--border)]">
        <div className="p-4">
          <div className="text-xs text-[var(--text-muted)]">Selected Range Return</div>
          <div
            className={`text-lg font-semibold font-mono-num mt-1 ${
              fin.netProfitPercent > 0
                ? 'text-[var(--positive)]'
                : fin.netProfitPercent < 0
                ? 'text-[var(--negative)]'
                : 'text-[var(--text-primary)]'
            }`}
          >
            {fin.netProfitPercent >= 0 ? '+' : ''}
            {fin.netProfitPercent}%
          </div>
          <div
            className="text-[11px] font-mono-num text-[var(--text-muted)] mt-0.5 truncate"
            title={currencyHeadline}
          >
            {currencyHeadline}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-[var(--text-muted)]">Win Rate &amp; Sample</div>
          <div className="text-lg font-semibold font-mono-num text-[var(--text-primary)] mt-1">
            {fin.winRate !== null ? `${fin.winRate}%` : '—'}
          </div>
          <div className="text-[11px] font-mono-num text-[var(--text-muted)] mt-0.5">
            {fin.winCount}W / {fin.lossCount}L / {fin.breakevenCount}BE · {fin.closedTradesCount}/
            {fin.totalTrades} closed
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-[var(--text-muted)]">Profit Factor &amp; Avg R</div>
          <div className="text-lg font-semibold font-mono-num text-[var(--text-primary)] mt-1">
            {profitFactorText}
          </div>
          <div className="text-[11px] font-mono-num text-[var(--text-muted)] mt-0.5">
            Expectancy:{' '}
            {fin.expectancyPercent !== null
              ? `${fin.expectancyPercent >= 0 ? '+' : ''}${fin.expectancyPercent}%`
              : '—'}{' '}
            · Avg R: {fin.averageR !== null ? `${fin.averageR}R` : '—'}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-[var(--text-muted)]">Risk &amp; Consistency</div>
          <div className="text-lg font-semibold font-mono-num text-[var(--negative)] mt-1">
            -{fin.maxDrawdownPercent}% Max DD
          </div>
          <div className="text-[11px] font-mono-num text-[var(--text-muted)] mt-0.5">
            Today {todayFin.netProfitPercent >= 0 ? '+' : ''}
            {todayFin.netProfitPercent}% · Month {monthFin.netProfitPercent >= 0 ? '+' : ''}
            {monthFin.netProfitPercent}%
          </div>
        </div>
      </section>

      {/* Secondary Discipline & Process Bar */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="p-3.5 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
          <div className="text-[var(--text-muted)]">Session Attendance</div>
          <div className="font-mono-num font-semibold text-sm text-[var(--text-primary)] mt-0.5">
            {act.attendanceRate !== null ? `${act.attendanceRate}%` : '—'}
          </div>
          <div className="text-[11px] text-[var(--text-muted)]">
            {act.totalSessions} total · {act.attendedSessions} attended · {act.missedSessions}{' '}
            missed
          </div>
        </div>
        <div className="p-3.5 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
          <div className="text-[var(--text-muted)]">Followed Plan</div>
          <div className="font-mono-num font-semibold text-sm text-[var(--text-primary)] mt-0.5">
            {disc.followedPlanRate !== null ? `${disc.followedPlanRate}%` : '—'}
          </div>
          <div className="text-[11px] text-[var(--text-muted)]">
            {disc.followedPlanYes} of {disc.followedPlanTotal} closed trades
          </div>
        </div>
        <div className="p-3.5 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
          <div className="text-[var(--text-muted)]">Risk Rule Adherence</div>
          <div className="font-mono-num font-semibold text-sm text-[var(--text-primary)] mt-0.5">
            {disc.followedRiskRate !== null ? `${disc.followedRiskRate}%` : '—'}
          </div>
          <div className="text-[11px] text-[var(--text-muted)]">
            {disc.followedRiskYes} of {disc.followedRiskTotal} closed trades
          </div>
        </div>
        <div className="p-3.5 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
          <div className="text-[var(--text-muted)]">Out-of-Session Trades</div>
          <div className="font-mono-num font-semibold text-sm text-[var(--text-primary)] mt-0.5">
            {act.outOfSessionTrades}
          </div>
          <div className="text-[11px] text-[var(--text-muted)]">
            {act.inSessionTrades} in-session · {fin.totalTrades} total
          </div>
        </div>
      </section>

      {/* Main Analytics Split: 7 cols Equity Curve / 5 cols Currency-Safe Account Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7">
          <ChartContainer
            title="Cumulative Percentage Return Curve"
            subtitle="Percentage-normalized across selected scope (excludes open and trashed executions)"
          >
            <EquityCurveChart points={fin.equityCurve} />
          </ChartContainer>
        </div>

        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Performance by Account
            </h2>
            <span className="text-[11px] text-[var(--text-muted)]">Currencies isolated</span>
          </div>
          <DataTable
            columns={accountColumns}
            rows={accountBreakdown}
            rowKey={(r) => r.accountId}
            emptyMessage="No account executions recorded in this date range."
          />
        </div>
      </div>

      {/* Bottom Operational Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Recent Executions (
              {rangeTrades.length > recentTrades.length
                ? `${recentTrades.length} of ${rangeTrades.length}`
                : rangeTrades.length}
              )
            </h2>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('trades')}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                View All Trades →
              </button>
            )}
          </div>
          <DataTable
            columns={recentTradeColumns}
            rows={recentTrades}
            rowKey={(t) => t.id}
            onRowClick={(t) => setInspectedTrade(t)}
            emptyMessage="No trades executed in this window."
          />
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Recent Sessions (
              {rangeSessions.length > recentSessions.length
                ? `${recentSessions.length} of ${rangeSessions.length}`
                : rangeSessions.length}
              )
            </h2>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('records')}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                View All Records →
              </button>
            )}
          </div>
          <DataTable
            columns={recentSessionColumns}
            rows={recentSessions}
            rowKey={(s) => s.id}
            onRowClick={(s) => setSelectedSession(s)}
            emptyMessage="No sessions recorded in this window."
          />
        </section>
      </div>

      <SessionDetailDrawer
        session={activeDrawerSession}
        sessionEvents={sessionEvents}
        trades={accountScopedActiveTrades}
        timezone={timezone}
        onClose={() => setSelectedSession(null)}
        onSelectTrade={(t) => setInspectedTrade(t)}
      />

      <TradeInspectorDrawer
        trade={
          inspectedTrade
            ? trades.find((t) => t.id === inspectedTrade.id && isActiveTrade(t)) ?? inspectedTrade
            : null
        }
        tradeEvents={tradeEvents}
        attachments={attachments.filter(
          (a) => a.relatedType === 'trade' && a.relatedId === inspectedTrade?.id
        )}
        allAttachments={attachments}
        userId={user?.uid ?? ''}
        timezone={timezone}
        onClose={() => setInspectedTrade(null)}
        onSelectTrade={(sib) => setInspectedTrade(sib)}
        onRequestCloseTrade={(t) => {
          setInspectedTrade(null);
          onRequestCloseTrade(t);
        }}
      />
    </div>
  );
}

