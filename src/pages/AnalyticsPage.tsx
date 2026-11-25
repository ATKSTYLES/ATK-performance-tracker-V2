import React, { useMemo, useState } from 'react';
import { EquityCurveChart } from '../components/charts/EquityCurveChart';
import { SessionDetailDrawer } from '../components/trading/SessionDetailDrawer';
import { TradeInspectorDrawer } from '../components/trading/TradeInspectorDrawer';
import {
  DatePicker,
  SegmentedControl,
  SelectInput,
} from '../components/ui/Controls';
import {
  ChartContainer,
  DataColumn,
  DataTable,
  MetricDisplay,
  PageHeader,
} from '../components/ui/DataDisplay';
import { useWorkspace } from '../context/WorkspaceContext';
import {
  buildAccountFilterOptions,
  calculateActivityMetrics,
  calculateDirectionBreakdown,
  calculateDisciplineMetrics,
  calculateFinancialMetrics,
  calculateInstrumentBreakdown,
  calculateMistakesBreakdown,
  calculatePsychologyMetrics,
  calculateSetupBreakdown,
  computeDateRangeBounds,
  DateRangePreset,
  DimensionBreakdownRow,
  getSessionLinkedTrades,
  groupCurrencyNetPnl,
  isActiveTrade,
  MistakeBreakdownRow,
  scopeWorkspaceRecords,
} from '../domain/calculations';
import {
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

type AnalyticsTab = 'financial' | 'activity' | 'discipline' | 'psychology';

function describeRangeScope(
  preset: DateRangePreset,
  bounds: { start: string; end: string }
): string {
  if (preset === 'all') return 'All Dates';
  if (preset === 'today') return `Today (${bounds.start})`;
  if (preset === 'custom') return `${bounds.start || 'Start'} to ${bounds.end || 'End'}`;
  return `${preset.toUpperCase()} (${bounds.start} to ${bounds.end})`;
}

export function AnalyticsPage() {
  const {
    user,
    accounts,
    dailyJournals,
    sessions,
    sessionEvents,
    activeTrades,
    trades,
    tradeEvents,
    attachments,
    timezone,
    preferredCurrency,
  } = useWorkspace();

  const today = getTodayInTimezone(timezone);
  const [tab, setTab] = useState<AnalyticsTab>('financial');
  const {
    rangePreset,
    customStart,
    customEnd,
    accountId: accountFilter,
    setRangePreset,
    setCustomStart,
    setCustomEnd,
    setAccountId: setAccountFilter,
  } = useSyncedAnalyticsScope(today);

  const [selectedSession, setSelectedSession] = useState<TradingSession | null>(null);
  const [inspectedTrade, setInspectedTrade] = useState<Trade | null>(null);

  const rangeBounds = useMemo(
    () => computeDateRangeBounds(rangePreset, today, customStart, customEnd),
    [rangePreset, today, customStart, customEnd]
  );

  const {
    accountScopedTrades,
    rangeTrades: filteredTrades,
    rangeSessions: filteredSessions,
    rangeSessionEvents: filteredSessionEvents,
    rangeJournals: filteredJournals,
  } = useMemo(
    () =>
      scopeWorkspaceRecords({
        sessions,
        sessionEvents,
        trades: activeTrades,
        dailyJournals,
        bounds: rangeBounds,
        accountId: accountFilter,
      }),
    [sessions, sessionEvents, activeTrades, dailyJournals, rangeBounds, accountFilter]
  );

  const fin = useMemo(() => calculateFinancialMetrics(filteredTrades), [filteredTrades]);
  const currencyTotals = useMemo(
    () => groupCurrencyNetPnl(filteredTrades, accounts, preferredCurrency),
    [filteredTrades, accounts, preferredCurrency]
  );
  const instrumentBreakdown = useMemo(
    () => calculateInstrumentBreakdown(filteredTrades),
    [filteredTrades]
  );
  const setupBreakdown = useMemo(
    () => calculateSetupBreakdown(filteredTrades),
    [filteredTrades]
  );
  const directionBreakdown = useMemo(
    () => calculateDirectionBreakdown(filteredTrades),
    [filteredTrades]
  );
  const mistakesBreakdown = useMemo(
    () => calculateMistakesBreakdown(filteredTrades),
    [filteredTrades]
  );

  const act = useMemo(
    () => calculateActivityMetrics(filteredSessions, filteredTrades),
    [filteredSessions, filteredTrades]
  );
  const disc = useMemo(
    () =>
      calculateDisciplineMetrics(filteredTrades, filteredSessionEvents, filteredJournals),
    [filteredTrades, filteredSessionEvents, filteredJournals]
  );
  const psych = useMemo(
    () => calculatePsychologyMetrics(filteredTrades),
    [filteredTrades]
  );

  const activeDrawerSession = selectedSession
    ? sessions.find((s) => s.id === selectedSession.id) ?? selectedSession
    : null;

  const profitFactorText =
    fin.closedTradesCount === 0
      ? '—'
      : fin.profitFactor === null
      ? 'No Losses Yet'
      : fin.profitFactor.toFixed(2);

  const currencySublabel =
    currencyTotals.length === 0
      ? 'No monetary net P&L recorded'
      : currencyTotals
          .map(
            (c) =>
              `${c.netPnl >= 0 ? '+' : ''}${c.netPnl.toFixed(2)} ${c.currency}`
          )
          .join(' · ');

  const scopeSummaryText = describeRangeScope(rangePreset, rangeBounds);

  const breakdownColumns = (dimensionLabel: string): Array<DataColumn<DimensionBreakdownRow>> => [
    {
      key: 'key',
      header: dimensionLabel,
      render: (r) => <span className="font-semibold text-[var(--text-primary)]">{r.key}</span>,
    },
    {
      key: 'trades',
      header: 'Closed / Total',
      align: 'right',
      render: (r) => (
        <span className="font-mono-num text-[var(--text-secondary)]">
          {r.closedTrades} / {r.totalTrades}
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
      key: 'pf',
      header: 'Profit Factor',
      align: 'right',
      render: (r) => (
        <span className="font-mono-num">
          {r.closedTrades === 0 ? '—' : r.profitFactor === null ? 'No Loss' : r.profitFactor.toFixed(2)}
        </span>
      ),
    },
    {
      key: 'avgR',
      header: 'Avg R',
      align: 'right',
      render: (r) => (
        <span className="font-mono-num">
          {r.averageR !== null ? `${r.averageR}R` : '—'}
        </span>
      ),
    },
    {
      key: 'net',
      header: 'Net %',
      align: 'right',
      render: (r) => (
        <span
          className={`font-mono-num font-semibold ${
            r.netProfitPercent > 0
              ? 'text-[var(--positive)]'
              : r.netProfitPercent < 0
              ? 'text-[var(--negative)]'
              : ''
          }`}
        >
          {r.netProfitPercent >= 0 ? '+' : ''}
          {r.netProfitPercent}%
        </span>
      ),
    },
  ];

  const sessionRecordColumns: Array<DataColumn<TradingSession>> = [
    {
      key: 'date',
      header: 'Date',
      render: (s) => <span className="font-mono-num text-[var(--text-secondary)]">{s.date}</span>,
    },
    {
      key: 'session',
      header: 'Session',
      render: (s) => <span className="font-medium">{s.sessionName}</span>,
    },
    {
      key: 'start',
      header: 'Start',
      render: (s) => (
        <span className="font-mono-num">
          {formatTimestampInTimezone(s.actualStartTime, timezone)}
        </span>
      ),
    },
    {
      key: 'end',
      header: 'End',
      render: (s) => (
        <span className="font-mono-num">
          {formatTimestampInTimezone(s.actualEndTime, timezone)}
        </span>
      ),
    },
    {
      key: 'duration',
      header: 'Duration',
      render: (s) => (
        <span className="font-mono-num">
          {s.actualStartTime ? formatDurationMinutes(s.actualStartTime, s.actualEndTime) : '—'}
        </span>
      ),
    },
    {
      key: 'attendance',
      header: 'Attendance',
      render: (s) => <span>{SESSION_ATTENDANCE_LABELS[s.attendance]}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (s) => <span>{SESSION_STATUS_LABELS[s.status]}</span>,
    },
    {
      key: 'trades',
      header: 'Trades',
      align: 'right',
      render: (s) => (
        <span className="font-mono-num">
          {getSessionLinkedTrades(s.id, accountScopedTrades).length}
        </span>
      ),
    },
  ];

  const accountFilterOptions = useMemo(
    () => buildAccountFilterOptions(accounts, activeTrades),
    [accounts, activeTrades]
  );

  const inSessionStats = useMemo(() => {
    const inFin = calculateFinancialMetrics(filteredTrades.filter((t) => !t.isOutOfSession));
    const outFin = calculateFinancialMetrics(filteredTrades.filter((t) => t.isOutOfSession));
    return {
      inSess: {
        total: inFin.totalTrades,
        closed: inFin.closedTradesCount,
        open: inFin.openTradesCount,
        winRate: inFin.winRate,
        net: inFin.netProfitPercent,
      },
      outSess: {
        total: outFin.totalTrades,
        closed: outFin.closedTradesCount,
        open: outFin.openTradesCount,
        winRate: outFin.winRate,
        net: outFin.netProfitPercent,
      },
    };
  }, [filteredTrades]);

  const mistakeColumns: Array<DataColumn<MistakeBreakdownRow>> = [
    {
      key: 'mistake',
      header: 'Recorded Mistake',
      render: (r) => <span className="font-medium text-[var(--negative)]">{r.mistake}</span>,
    },
    {
      key: 'count',
      header: 'Occurrences',
      align: 'right',
      render: (r) => <span className="font-mono-num">{r.count}</span>,
    },
    {
      key: 'winRate',
      header: 'Win Rate',
      align: 'right',
      render: (r) => (
        <span className="font-mono-num">{r.winRate !== null ? `${r.winRate}%` : '—'}</span>
      ),
    },
    {
      key: 'net',
      header: 'Net % Impact',
      align: 'right',
      render: (r) => (
        <span
          className={`font-mono-num font-semibold ${
            r.netProfitPercent > 0
              ? 'text-[var(--positive)]'
              : r.netProfitPercent < 0
              ? 'text-[var(--negative)]'
              : ''
          }`}
        >
          {r.netProfitPercent >= 0 ? '+' : ''}
          {r.netProfitPercent}%
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        subtitle={`Synced scope: ${scopeSummaryText} · ${act.totalSessions} session(s) · ${fin.totalTrades} trade(s) (${fin.closedTradesCount} closed, ${fin.openTradesCount} open)`}
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="w-44">
              <SelectInput
                value={accountFilter}
                onChange={setAccountFilter}
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

      <div className="overflow-x-auto pb-1">
        <SegmentedControl
          value={tab}
          onChange={setTab}
          options={[
            { value: 'financial', label: 'Financial Edge' },
            { value: 'activity', label: 'Session Activity' },
            { value: 'discipline', label: 'Process & Discipline' },
            { value: 'psychology', label: 'Psychology' },
          ]}
        />
      </div>

      {/* 1. FINANCIAL TAB */}
      {tab === 'financial' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricDisplay
              label="Net Profit %"
              value={`${fin.netProfitPercent >= 0 ? '+' : ''}${fin.netProfitPercent}%`}
              sublabel={currencySublabel}
              tone={
                fin.netProfitPercent > 0
                  ? 'positive'
                  : fin.netProfitPercent < 0
                  ? 'negative'
                  : 'default'
              }
            />
            <MetricDisplay
              label="Win Rate (Closed)"
              value={fin.winRate !== null ? `${fin.winRate}%` : '—'}
              sublabel={`${fin.winCount}W / ${fin.lossCount}L / ${fin.breakevenCount}BE · ${fin.closedTradesCount}/${fin.totalTrades} closed`}
            />
            <MetricDisplay
              label="Profit Factor"
              value={profitFactorText}
              sublabel={`Expectancy: ${
                fin.expectancyPercent !== null
                  ? `${fin.expectancyPercent >= 0 ? '+' : ''}${fin.expectancyPercent}%`
                  : '—'
              } · Avg R: ${fin.averageR !== null ? `${fin.averageR}R` : '—'}`}
            />
            <MetricDisplay
              label="Max Drawdown %"
              value={`-${fin.maxDrawdownPercent}%`}
              sublabel={`Streaks: +${fin.maxWinningStreak}W / -${fin.maxLosingStreak}L`}
              tone={fin.maxDrawdownPercent > 0 ? 'negative' : 'default'}
            />
          </div>

          <ChartContainer
            title="Equity Curve (Percentage-First)"
            subtitle={`Based on ${fin.closedTradesCount} closed trades`}
          >
            <EquityCurveChart points={fin.equityCurve} />
          </ChartContainer>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricDisplay
              label="Avg Win %"
              value={fin.averageWinPercent !== null ? `+${fin.averageWinPercent}%` : '—'}
              tone="positive"
            />
            <MetricDisplay
              label="Avg Loss %"
              value={fin.averageLossPercent !== null ? `${fin.averageLossPercent}%` : '—'}
              tone="negative"
            />
            <MetricDisplay
              label="Best Closed Trade"
              value={fin.largestWinPercent !== null ? `+${fin.largestWinPercent}%` : '—'}
              tone="positive"
            />
            <MetricDisplay
              label="Worst Closed Trade"
              value={fin.largestLossPercent !== null ? `${fin.largestLossPercent}%` : '—'}
              tone="negative"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <section className="space-y-2.5">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Performance by Instrument
              </h2>
              <DataTable
                columns={breakdownColumns('Instrument')}
                rows={instrumentBreakdown}
                rowKey={(r) => r.key}
                emptyMessage="No trades executed across instruments yet."
              />
            </section>

            <section className="space-y-2.5">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Performance by Setup
              </h2>
              <DataTable
                columns={breakdownColumns('Setup Label')}
                rows={setupBreakdown}
                rowKey={(r) => r.key}
                emptyMessage="No setup-tagged trades recorded yet."
              />
            </section>
          </div>

          <section className="space-y-2.5">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Long vs Short Bias</h2>
            <DataTable
              columns={breakdownColumns('Direction')}
              rows={directionBreakdown}
              rowKey={(r) => r.key}
              emptyMessage="No directional data available yet."
            />
          </section>
        </div>
      )}

      {/* 2. ACTIVITY TAB */}
      {tab === 'activity' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricDisplay
              label="Total Sessions"
              value={String(act.totalSessions)}
              sublabel={`${act.attendedSessions} attended · ${act.missedSessions} missed · ${act.cancelledSessions} cancelled${
                act.plannedSessions > 0 ? ` · ${act.plannedSessions} planned` : ''
              }`}
            />
            <MetricDisplay
              label="Attendance Rate"
              value={act.attendanceRate !== null ? `${act.attendanceRate}%` : '—'}
            />
            <MetricDisplay
              label="On-Time Start (≤15m)"
              value={act.onTimeRate !== null ? `${act.onTimeRate}%` : '—'}
              sublabel={`${act.onTimeSampleSize} scheduled sample`}
            />
            <MetricDisplay
              label="Zero-Trade Sessions"
              value={String(act.zeroTradeSessions)}
              sublabel={`Valid setup availability: ${
                act.validSetupRate !== null ? `${act.validSetupRate}%` : '—'
              }`}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] flex items-center justify-between text-xs">
              <div>
                <div className="font-semibold text-[var(--text-primary)]">In-Session Trades</div>
                <div className="text-[var(--text-muted)] mt-0.5">
                  {inSessionStats.inSess.total} total ({inSessionStats.inSess.closed} closed
                  {inSessionStats.inSess.open > 0 ? ` · ${inSessionStats.inSess.open} open` : ''}) ·{' '}
                  {inSessionStats.inSess.winRate !== null
                    ? `${inSessionStats.inSess.winRate}% win rate`
                    : 'No closed sample'}
                </div>
              </div>
              <div
                className={`font-mono-num text-base font-semibold ${
                  inSessionStats.inSess.net > 0
                    ? 'text-[var(--positive)]'
                    : inSessionStats.inSess.net < 0
                    ? 'text-[var(--negative)]'
                    : ''
                }`}
              >
                {inSessionStats.inSess.net >= 0 ? '+' : ''}
                {inSessionStats.inSess.net}%
              </div>
            </div>

            <div className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] flex items-center justify-between text-xs">
              <div>
                <div className="font-semibold text-[var(--text-primary)]">Out-of-Session Trades</div>
                <div className="text-[var(--text-muted)] mt-0.5">
                  {inSessionStats.outSess.total} total ({inSessionStats.outSess.closed} closed
                  {inSessionStats.outSess.open > 0 ? ` · ${inSessionStats.outSess.open} open` : ''}) ·{' '}
                  {inSessionStats.outSess.winRate !== null
                    ? `${inSessionStats.outSess.winRate}% win rate`
                    : 'No closed sample'}
                </div>
              </div>
              <div
                className={`font-mono-num text-base font-semibold ${
                  inSessionStats.outSess.net > 0
                    ? 'text-[var(--positive)]'
                    : inSessionStats.outSess.net < 0
                    ? 'text-[var(--negative)]'
                    : ''
                }`}
              >
                {inSessionStats.outSess.net >= 0 ? '+' : ''}
                {inSessionStats.outSess.net}%
              </div>
            </div>
          </div>

          <section className="space-y-2.5">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Session Performance Breakdown
            </h2>
            <DataTable
              columns={[
                {
                  key: 'name',
                  header: 'Session',
                  render: (r) => <span className="font-semibold">{r.sessionName}</span>,
                },
                {
                  key: 'sessions',
                  header: 'Sessions Held',
                  align: 'right',
                  render: (r) => <span className="font-mono-num">{r.sessionCount}</span>,
                },
                {
                  key: 'trades',
                  header: 'In-Session Trades',
                  align: 'right',
                  render: (r) => (
                    <span className="font-mono-num">
                      {r.tradeCount}
                      {r.closedTradeCount !== r.tradeCount
                        ? ` (${r.closedTradeCount} closed)`
                        : ''}
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
                  key: 'net',
                  header: 'Net %',
                  align: 'right',
                  render: (r) => (
                    <span
                      className={`font-mono-num font-semibold ${
                        r.netProfitPercent > 0
                          ? 'text-[var(--positive)]'
                          : r.netProfitPercent < 0
                          ? 'text-[var(--negative)]'
                          : ''
                      }`}
                    >
                      {r.netProfitPercent >= 0 ? '+' : ''}
                      {r.netProfitPercent}%
                    </span>
                  ),
                },
              ]}
              rows={act.sessionBreakdown}
              rowKey={(r) => r.sessionName}
              emptyMessage="No session breakdown records in this window."
            />
          </section>

          <section className="space-y-2.5">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Session Records ({filteredSessions.length})
            </h2>
            <DataTable
              columns={sessionRecordColumns}
              rows={filteredSessions}
              rowKey={(s) => s.id}
              onRowClick={(s) => setSelectedSession(s)}
              emptyMessage="No trading sessions recorded in this window."
            />
          </section>
        </div>
      )}

      {/* 3. DISCIPLINE TAB */}
      {tab === 'discipline' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <MetricDisplay
              label="Followed Plan"
              value={disc.followedPlanRate !== null ? `${disc.followedPlanRate}%` : '—'}
              sublabel={`${disc.followedPlanYes}/${disc.followedPlanTotal}`}
            />
            <MetricDisplay
              label="Risk Rules"
              value={disc.followedRiskRate !== null ? `${disc.followedRiskRate}%` : '—'}
              sublabel={`${disc.followedRiskYes}/${disc.followedRiskTotal}`}
            />
            <MetricDisplay
              label="Impulsive Entry"
              value={disc.impulsiveEntryRate !== null ? `${disc.impulsiveEntryRate}%` : '—'}
              sublabel={`${disc.impulsiveEntryYes}/${disc.impulsiveEntryTotal}`}
            />
            <MetricDisplay
              label="Exited Per Plan"
              value={disc.exitedPerPlanRate !== null ? `${disc.exitedPerPlanRate}%` : '—'}
              sublabel={`${disc.exitedPerPlanYes}/${disc.exitedPerPlanTotal}`}
            />
            <MetricDisplay
              label="Stepped Back"
              value={String(disc.steppedBackCount)}
              sublabel="Capital saved"
              tone="info"
            />
            <MetricDisplay
              label="Checklist Rate"
              value={
                disc.checklistCompletionRate !== null
                  ? `${disc.checklistCompletionRate}%`
                  : '—'
              }
              sublabel={`${disc.checklistSampleDays} day(s)`}
            />
          </div>

          <section className="p-5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                2×2 Process vs Outcome Matrix
              </h2>
              <span className="text-xs font-mono-num text-[var(--text-muted)]">
                Sample: {disc.processOutcomeMatrix.sampleSize} classified closed trade(s)
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-4 rounded-lg bg-[var(--positive-bg)] border border-[var(--positive)]/35">
                <div className="font-semibold text-[var(--positive)]">
                  Good Process + Good Outcome
                </div>
                <div className="font-mono-num text-xl font-semibold mt-1">
                  {disc.processOutcomeMatrix.goodProcessGoodOutcome}
                </div>
                <p className="text-[var(--text-secondary)] mt-1">
                  Plan &amp; risk rules followed without impulse; profitable exit.
                </p>
              </div>
              <div className="p-4 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)]">
                <div className="font-semibold text-[var(--text-primary)]">
                  Good Process + Loss
                </div>
                <div className="font-mono-num text-xl font-semibold mt-1">
                  {disc.processOutcomeMatrix.goodProcessBadOutcome}
                </div>
                <p className="text-[var(--text-secondary)] mt-1">
                  Normal statistical variance inside system rules.
                </p>
              </div>
              <div className="p-4 rounded-lg bg-[var(--caution-bg)] border border-[var(--caution)]/35">
                <div className="font-semibold text-[var(--caution)]">
                  Bad Process + Good Outcome
                </div>
                <div className="font-mono-num text-xl font-semibold mt-1">
                  {disc.processOutcomeMatrix.badProcessGoodOutcome}
                </div>
                <p className="text-[var(--text-secondary)] mt-1">
                  Rule break rewarded by short-term market luck — review carefully.
                </p>
              </div>
              <div className="p-4 rounded-lg bg-[var(--negative-bg)] border border-[var(--negative)]/35">
                <div className="font-semibold text-[var(--negative)]">
                  Bad Process + Bad Outcome
                </div>
                <div className="font-mono-num text-xl font-semibold mt-1">
                  {disc.processOutcomeMatrix.badProcessBadOutcome}
                </div>
                <p className="text-[var(--text-secondary)] mt-1">
                  Preventable rule breaches directly causing capital drawdown.
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-2.5">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Mistakes Impact Breakdown
            </h2>
            <DataTable
              columns={mistakeColumns}
              rows={mistakesBreakdown}
              rowKey={(r) => r.mistake}
              emptyMessage="No execution mistakes tagged in this period."
            />
          </section>
        </div>
      )}

      {/* 4. PSYCHOLOGY TAB */}
      {tab === 'psychology' && (
        <div className="space-y-6">
          <div className="px-4 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--subtle-surface)] text-xs text-[var(--text-secondary)]">
            Statistical sample comparison based strictly on your recorded emotional tags. No causal claims are inferred.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              {
                title: 'Focused / Present vs Distracted / Fatigued',
                left: psych.focusedVsDistracted.focused,
                right: psych.focusedVsDistracted.distracted,
              },
              {
                title: 'Calm vs Anxious / Impatient',
                left: psych.calmVsAnxious.calm,
                right: psych.calmVsAnxious.anxious,
              },
              {
                title: 'Planned vs Impulsive Entries',
                left: psych.impulsiveVsPlanned.planned,
                right: psych.impulsiveVsPlanned.impulsive,
              },
            ].map((pair) => (
              <div
                key={pair.title}
                className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-3 text-xs"
              >
                <div className="font-semibold text-[var(--text-primary)]">{pair.title}</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-[var(--subtle-surface)]">
                    <div className="text-[var(--text-muted)]">{pair.left.label}</div>
                    <div className="font-mono-num text-sm font-semibold mt-1">
                      {pair.left.winRate !== null ? `${pair.left.winRate}% Win` : '—'}
                    </div>
                    <div className="font-mono-num text-[var(--text-secondary)]">
                      {pair.left.count} trades · {pair.left.netProfitPercent >= 0 ? '+' : ''}
                      {pair.left.netProfitPercent}%
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-[var(--subtle-surface)]">
                    <div className="text-[var(--text-muted)]">{pair.right.label}</div>
                    <div className="font-mono-num text-sm font-semibold mt-1">
                      {pair.right.winRate !== null ? `${pair.right.winRate}% Win` : '—'}
                    </div>
                    <div className="font-mono-num text-[var(--text-secondary)]">
                      {pair.right.count} trades · {pair.right.netProfitPercent >= 0 ? '+' : ''}
                      {pair.right.netProfitPercent}%
                    </div>
                  </div>
                </div>
              </div>
            ))}

            <div className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-2 text-xs">
              <div className="font-semibold text-[var(--text-primary)]">
                Revenge-Risk: Trades Immediately After a Loss
              </div>
              <div className="font-mono-num text-lg font-semibold">
                {psych.tradesAfterLoss.winRate !== null
                  ? `${psych.tradesAfterLoss.winRate}% Win Rate`
                  : '—'}
              </div>
              <div className="text-[var(--text-secondary)] font-mono-num">
                Sample: {psych.tradesAfterLoss.count} closed trade(s) · Net{' '}
                {psych.tradesAfterLoss.netProfitPercent >= 0 ? '+' : ''}
                {psych.tradesAfterLoss.netProfitPercent}%
              </div>
            </div>
          </div>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Pre-Trade Confidence Calibration vs Results
            </h2>
            <DataTable
              columns={[
                { key: 'bucket', header: 'Confidence Band', render: (r) => r.bucket },
                {
                  key: 'count',
                  header: 'Closed Trades',
                  align: 'right',
                  render: (r) => <span className="font-mono-num">{r.count}</span>,
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
                  key: 'avg',
                  header: 'Avg Return %',
                  align: 'right',
                  render: (r) => (
                    <span className="font-mono-num">
                      {r.avgReturnPercent !== null
                        ? `${r.avgReturnPercent >= 0 ? '+' : ''}${r.avgReturnPercent}%`
                        : '—'}
                    </span>
                  ),
                },
              ]}
              rows={psych.confidenceVsResults}
              rowKey={(r) => r.bucket}
            />
          </section>

          {psych.postExitEmotions.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Post-Exit Emotions Distribution
              </h2>
              <DataTable
                columns={[
                  { key: 'emotion', header: 'Post-Trade Emotion', render: (r) => r.emotion },
                  {
                    key: 'count',
                    header: 'Total',
                    align: 'right',
                    render: (r) => <span className="font-mono-num">{r.count}</span>,
                  },
                  {
                    key: 'wins',
                    header: 'Wins',
                    align: 'right',
                    render: (r) => <span className="font-mono-num text-[var(--positive)]">{r.winCount}</span>,
                  },
                  {
                    key: 'losses',
                    header: 'Losses',
                    align: 'right',
                    render: (r) => <span className="font-mono-num text-[var(--negative)]">{r.lossCount}</span>,
                  },
                ]}
                rows={psych.postExitEmotions}
                rowKey={(r) => r.emotion}
              />
            </section>
          )}
        </div>
      )}

      <SessionDetailDrawer
        session={activeDrawerSession}
        sessionEvents={sessionEvents}
        trades={accountScopedTrades}
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
      />
    </div>
  );
}

