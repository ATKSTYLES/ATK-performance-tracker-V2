import React, { useMemo, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { TradeInspectorDrawer } from '../components/trading/TradeInspectorDrawer';
import { SecondaryButton, SelectInput } from '../components/ui/Controls';
import { PageHeader } from '../components/ui/DataDisplay';
import { useWorkspace } from '../context/WorkspaceContext';
import {
  buildAccountFilterOptions,
  calculateActivityMetrics,
  calculateFinancialMetrics,
  calculateSessionCoverageMetrics,
  CalendarDayStatus,
  getCalendarDaySessionsSummary,
  getCalendarDayStatus,
  getMonthBoundsForYearMonth,
  groupCurrencyNetPnl,
  isActiveTrade,
  isTradingWeekday,
  SessionOutcomeCategory,
} from '../domain/calculations';
import {
  EXIT_OUTCOME_LABELS,
  PLAN_ADHERENCE_LABELS,
  SESSION_ATTENDANCE_LABELS,
  TRADE_DIRECTION_LABELS,
} from '../domain/enums';
import {
  buildMondayCalendarGrid,
  formatDisplayDate,
  getTodayInTimezone,
} from '../domain/timezone';
import { Trade } from '../domain/types';

function shiftYearMonth(ym: string, deltaMonths: number): string {
  const [y, m] = ym.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
  return dt.toISOString().slice(0, 7);
}

const DAY_STATUS_TEXT: Record<CalendarDayStatus, string> = {
  profitable: 'Profitable',
  losing: 'Losing',
  breakeven: 'Breakeven',
  attended_zero_trades: 'Attended · 0 Trades',
  missed_session: 'Missed Session',
  no_session_planned: 'Journal Only',
  no_record: 'No Activity',
};

function getSessionMarkColorClass(outcome: SessionOutcomeCategory): string {
  if (outcome === 'traded') return 'bg-[var(--positive)]';
  if (outcome === 'attended_no_trade') return 'bg-[var(--info)]';
  if (outcome === 'missed') return 'bg-[var(--caution)]';
  return 'bg-[var(--text-muted)]/40';
}

function getSessionOutcomeLabel(outcome: SessionOutcomeCategory, tradeCount: number): string {
  if (outcome === 'traded') {
    return `Traded · ${tradeCount} ${tradeCount === 1 ? 'trade' : 'trades'}`;
  }
  if (outcome === 'attended_no_trade') return 'Attended · 0 trades';
  if (outcome === 'missed') return 'Missed';
  if (outcome === 'cancelled') return 'Cancelled';
  return 'Planned';
}

export function CalendarPage({
  onOpenDateRecords,
  onRequestCloseTrade,
}: {
  onOpenDateRecords: (date: string) => void;
  onRequestCloseTrade?: (trade: Trade) => void;
}) {
  const {
    user,
    accounts,
    dailyJournals,
    sessions,
    activeTrades,
    trades,
    tradeEvents,
    attachments,
    timezone,
    preferredCurrency,
  } = useWorkspace();

  const today = getTodayInTimezone(timezone);
  const [yearMonth, setYearMonth] = useState(today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(today);
  const [accountFilter, setAccountFilter] = useState('all');
  const [inspectedTrade, setInspectedTrade] = useState<Trade | null>(null);

  const grid = useMemo(() => buildMondayCalendarGrid(yearMonth), [yearMonth]);

  const monthWeeks = useMemo(() => {
    const weeks: Array<{ weekNum: number; cells: typeof grid }> = [];
    for (let i = 0; i < grid.length; i += 7) {
      weeks.push({ weekNum: weeks.length + 1, cells: grid.slice(i, i + 7) });
    }
    return weeks;
  }, [grid]);

  const scopedActiveTrades = useMemo(
    () =>
      activeTrades.filter(
        (t) => accountFilter === 'all' || t.accountId === accountFilter
      ),
    [activeTrades, accountFilter]
  );

  const monthBounds = useMemo(() => getMonthBoundsForYearMonth(yearMonth), [yearMonth]);

  const monthJournals = useMemo(
    () => dailyJournals.filter((j) => j.date.startsWith(yearMonth)),
    [dailyJournals, yearMonth]
  );
  const monthSessions = useMemo(
    () => sessions.filter((s) => s.date.startsWith(yearMonth)),
    [sessions, yearMonth]
  );
  const monthTrades = useMemo(
    () => scopedActiveTrades.filter((t) => t.date.startsWith(yearMonth)),
    [scopedActiveTrades, yearMonth]
  );

  const monthFin = useMemo(() => calculateFinancialMetrics(monthTrades), [monthTrades]);
  const monthAct = useMemo(
    () => calculateActivityMetrics(monthSessions, monthTrades),
    [monthSessions, monthTrades]
  );
  const monthCoverage = useMemo(
    () =>
      calculateSessionCoverageMetrics({
        sessions: monthSessions,
        trades: scopedActiveTrades,
        startDate: monthBounds.start,
        endDate: monthBounds.end,
      }),
    [monthSessions, scopedActiveTrades, monthBounds]
  );
  const monthCurrencyTotals = useMemo(
    () => groupCurrencyNetPnl(monthTrades, accounts, preferredCurrency),
    [monthTrades, accounts, preferredCurrency]
  );

  const monthTitle = useMemo(() => {
    const [y, m] = yearMonth.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(y, m - 1, 1)));
  }, [yearMonth]);

  const greenDaysCount = useMemo(() => {
    const inMonth = grid.filter((c) => c.inMonth);
    return inMonth.filter(
      (c) => getCalendarDayStatus(c.date, dailyJournals, sessions, scopedActiveTrades).status === 'profitable'
    ).length;
  }, [grid, dailyJournals, sessions, scopedActiveTrades]);

  const redDaysCount = useMemo(() => {
    const inMonth = grid.filter((c) => c.inMonth);
    return inMonth.filter(
      (c) => getCalendarDayStatus(c.date, dailyJournals, sessions, scopedActiveTrades).status === 'losing'
    ).length;
  }, [grid, dailyJournals, sessions, scopedActiveTrades]);

  const currencyHeadline =
    monthCurrencyTotals.length === 0
      ? 'No monetary P&L'
      : monthCurrencyTotals
          .map((c) => `${c.netPnl >= 0 ? '+' : ''}${c.netPnl.toFixed(2)} ${c.currency}`)
          .join(' · ');

  const selectedDayInfo = useMemo(
    () => getCalendarDayStatus(selectedDate, dailyJournals, sessions, scopedActiveTrades),
    [selectedDate, dailyJournals, sessions, scopedActiveTrades]
  );

  const selectedDayJournal = useMemo(
    () => dailyJournals.find((j) => j.date === selectedDate) ?? null,
    [dailyJournals, selectedDate]
  );

  const selectedDaySessionsSummary = useMemo(
    () => getCalendarDaySessionsSummary(selectedDate, sessions, scopedActiveTrades),
    [selectedDate, sessions, scopedActiveTrades]
  );

  const selectedDayTrades = useMemo(
    () =>
      scopedActiveTrades
        .filter((t) => t.date === selectedDate)
        .sort((a, b) => b.openedAt.localeCompare(a.openedAt)),
    [scopedActiveTrades, selectedDate]
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

  const accountFilterOptions = useMemo(
    () => buildAccountFilterOptions(accounts, activeTrades),
    [accounts, activeTrades]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        subtitle={`${monthTitle} · Monday-start execution calendar with per-session marks, weekly rollups, and 5-day trading week comparatives`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-44">
              <SelectInput
                value={accountFilter}
                onChange={setAccountFilter}
                options={accountFilterOptions}
              />
            </div>
            <SecondaryButton
              size="sm"
              type="button"
              onClick={() => setYearMonth(shiftYearMonth(yearMonth, -1))}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Prev
            </SecondaryButton>
            <SecondaryButton
              size="sm"
              type="button"
              onClick={() => {
                setYearMonth(today.slice(0, 7));
                setSelectedDate(today);
              }}
            >
              Today
            </SecondaryButton>
            <SecondaryButton
              size="sm"
              type="button"
              onClick={() => setYearMonth(shiftYearMonth(yearMonth, 1))}
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </SecondaryButton>
          </div>
        }
      />

      {/* Monthly Performance Summary Strip */}
      <section className="grid grid-cols-2 sm:grid-cols-5 border border-[var(--border)] rounded-lg bg-[var(--surface)] divide-y sm:divide-y-0 sm:divide-x divide-[var(--border)]">
        <div className="p-3.5">
          <div className="text-[11px] font-medium text-[var(--text-muted)]">Month Return %</div>
          <div
            className={`text-base font-semibold font-mono-num mt-0.5 ${
              monthFin.netProfitPercent > 0
                ? 'text-[var(--positive)]'
                : monthFin.netProfitPercent < 0
                ? 'text-[var(--negative)]'
                : 'text-[var(--text-primary)]'
            }`}
          >
            {monthFin.netProfitPercent >= 0 ? '+' : ''}
            {monthFin.netProfitPercent}%
          </div>
          <div className="text-[11px] font-mono-num text-[var(--text-muted)] truncate" title={currencyHeadline}>
            {currencyHeadline}
          </div>
        </div>
        <div className="p-3.5">
          <div className="text-[11px] font-medium text-[var(--text-muted)]">Month Win Rate</div>
          <div className="text-base font-semibold font-mono-num text-[var(--text-primary)] mt-0.5">
            {monthFin.winRate !== null ? `${monthFin.winRate}%` : '—'}
          </div>
          <div className="text-[11px] font-mono-num text-[var(--text-muted)]">
            {monthFin.winCount}W / {monthFin.lossCount}L
          </div>
        </div>
        <div className="p-3.5">
          <div className="text-[11px] font-medium text-[var(--text-muted)]">Month Trades</div>
          <div className="text-base font-semibold font-mono-num text-[var(--text-primary)] mt-0.5">
            {monthFin.totalTrades}
          </div>
          <div className="text-[11px] font-mono-num text-[var(--text-muted)]">
            {monthFin.closedTradesCount} closed · {monthFin.openTradesCount} open
          </div>
        </div>
        <div className="p-3.5">
          <div className="text-[11px] font-medium text-[var(--text-muted)]">P&amp;L Days</div>
          <div className="text-base font-semibold font-mono-num text-[var(--text-primary)] mt-0.5">
            <span className="text-[var(--positive)]">{greenDaysCount}G</span> /{' '}
            <span className="text-[var(--negative)]">{redDaysCount}R</span>
          </div>
          <div className="text-[11px] text-[var(--text-muted)]">
            {monthJournals.length} journal(s)
          </div>
        </div>
        <div className="p-3.5 col-span-2 sm:col-span-1">
          <div className="text-[11px] font-medium text-[var(--text-muted)]">Attendance Rate</div>
          <div className="text-base font-semibold font-mono-num text-[var(--text-primary)] mt-0.5">
            {monthAct.attendanceRate !== null ? `${monthAct.attendanceRate}%` : '—'}
          </div>
          <div className="text-[11px] text-[var(--text-muted)]">
            {monthAct.attendedSessions} attended · {monthAct.missedSessions} missed
          </div>
        </div>
      </section>

      {/* Monthly Session Execution & 5-Day Trading Week Comparative Strip */}
      <section className="grid grid-cols-2 sm:grid-cols-5 border border-[var(--border)] rounded-lg bg-[var(--surface)] divide-y sm:divide-y-0 sm:divide-x divide-[var(--border)]">
        <div className="p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-muted)]">
            <span className="w-2 h-2 rounded-[2px] bg-[var(--positive)]" />
            Sessions Traded
          </div>
          <div className="text-base font-semibold font-mono-num text-[var(--positive)] mt-0.5">
            {monthCoverage.sessionsTraded}
          </div>
          <div className="text-[11px] font-mono-num text-[var(--text-muted)]">
            {monthCoverage.tradesInSessions} trade(s) in sessions
          </div>
        </div>
        <div className="p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-muted)]">
            <span className="w-2 h-2 rounded-[2px] bg-[var(--info)]" />
            Attended (0 Trades)
          </div>
          <div className="text-base font-semibold font-mono-num text-[var(--info)] mt-0.5">
            {monthCoverage.sessionsAttendedNoTrade}
          </div>
          <div className="text-[11px] font-mono-num text-[var(--text-muted)]">
            {monthCoverage.attendedSessions} total attended
          </div>
        </div>
        <div className="p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-muted)]">
            <span className="w-2 h-2 rounded-[2px] bg-[var(--caution)]" />
            Sessions Missed
          </div>
          <div className="text-base font-semibold font-mono-num text-[var(--caution)] mt-0.5">
            {monthCoverage.missedSessions}
          </div>
          <div className="text-[11px] text-[var(--text-muted)]">
            Not attended{monthCoverage.cancelledSessions > 0 ? ` · ${monthCoverage.cancelledSessions} cancelled` : ''}
          </div>
        </div>
        <div className="p-3.5">
          <div className="text-[11px] font-medium text-[var(--text-muted)]">
            5-Day Week Trading Days
          </div>
          <div className="text-base font-semibold font-mono-num text-[var(--text-primary)] mt-0.5">
            {monthCoverage.weekdayDaysAttended} / {monthCoverage.tradingDays}
          </div>
          <div className="text-[11px] font-mono-num text-[var(--text-muted)]">
            {monthCoverage.tradingDayCoverageRate !== null
              ? `${monthCoverage.tradingDayCoverageRate}% of Mon–Fri days`
              : 'No weekdays'}
          </div>
        </div>
        <div className="p-3.5 col-span-2 sm:col-span-1">
          <div className="text-[11px] font-medium text-[var(--text-muted)]">
            Unlogged Weekdays
          </div>
          <div className="text-base font-semibold font-mono-num text-[var(--text-primary)] mt-0.5">
            {monthCoverage.tradingDaysWithoutAttendance}
          </div>
          <div className="text-[11px] text-[var(--text-muted)]">
            {monthCoverage.daysWithTradedSession} day(s) traded · 5d/wk basis
          </div>
        </div>
      </section>

      {/* Legend: Day Shading + Per-Session Marks */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-[var(--text-secondary)]">
        <div className="flex flex-wrap items-center gap-4">
          <span className="font-semibold text-[var(--text-muted)] uppercase tracking-wider text-[10px]">
            Day Cell
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[var(--positive-bg)] border border-[var(--positive)]/50" />
            Profitable
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[var(--negative-bg)] border border-[var(--negative)]/50" />
            Losing
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[var(--info-bg)] border border-[var(--info)]/50" />
            Attended (0 trades)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[var(--caution-bg)] border border-[var(--caution)]/50" />
            Missed
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <span className="font-semibold text-[var(--text-muted)] uppercase tracking-wider text-[10px]">
            Session Marks
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-[2px] bg-[var(--positive)]" />
            Traded Session
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-[2px] bg-[var(--info)]" />
            Attended (No Trade)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-[2px] bg-[var(--caution)]" />
            Missed Session
          </span>
        </div>
      </div>

      {/* Main Layout: 8-col Calendar Grid w/ Weekly Rollup + 4-col Day Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-8 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <div className="min-w-[680px]">
            <div className="grid grid-cols-8 border-b border-[var(--border)] bg-[var(--subtle-surface)]">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Week'].map((d) => (
                <div
                  key={d}
                  className="px-2.5 py-2 text-[11px] font-semibold text-[var(--text-secondary)] text-center border-r last:border-r-0 border-[var(--border)]"
                >
                  {d}
                </div>
              ))}
            </div>

            <div className="divide-y divide-[var(--border)]">
              {monthWeeks.map((week) => {
                const inMonthCells = week.cells.filter((c) => c.inMonth);
                const weekTrades = inMonthCells.flatMap((c) =>
                  scopedActiveTrades.filter((t) => t.date === c.date)
                );
                const weekSessions = inMonthCells.flatMap((c) =>
                  sessions.filter((s) => s.date === c.date)
                );
                const weekFin = calculateFinancialMetrics(weekTrades);
                const weekStart = inMonthCells[0]?.date;
                const weekEnd = inMonthCells[inMonthCells.length - 1]?.date;
                const weekTradingDays = inMonthCells.filter((c) => isTradingWeekday(c.date)).length;
                const weekCoverage = calculateSessionCoverageMetrics({
                  sessions: weekSessions,
                  trades: scopedActiveTrades,
                  startDate: weekStart,
                  endDate: weekEnd,
                });

                return (
                  <div key={week.weekNum} className="grid grid-cols-8">
                    {week.cells.map((cell) => {
                      const info = getCalendarDayStatus(
                        cell.date,
                        dailyJournals,
                        sessions,
                        scopedActiveTrades
                      );
                      const daySessionSummary = getCalendarDaySessionsSummary(
                        cell.date,
                        sessions,
                        scopedActiveTrades
                      );
                      const isToday = cell.date === today;
                      const isSelected = cell.date === selectedDate;
                      const dayNumber = Number(cell.date.slice(8, 10));

                      const cellBg =
                        info.status === 'profitable'
                          ? 'bg-[var(--positive-bg)]'
                          : info.status === 'losing'
                          ? 'bg-[var(--negative-bg)]'
                          : info.status === 'attended_zero_trades'
                          ? 'bg-[var(--info-bg)]'
                          : info.status === 'missed_session'
                          ? 'bg-[var(--caution-bg)]'
                          : 'bg-[var(--surface)]';

                      const sessionTooltip =
                        daySessionSummary.totalSessions > 0
                          ? `${cell.date} · ${daySessionSummary.items
                              .map(
                                (it) =>
                                  `${it.session.sessionName}: ${getSessionOutcomeLabel(
                                    it.outcome,
                                    it.tradeCount
                                  )}`
                              )
                              .join(' | ')}`
                          : cell.date;

                      return (
                        <button
                          key={cell.date}
                          type="button"
                          title={sessionTooltip}
                          onClick={() => {
                            setSelectedDate(cell.date);
                            if (cell.date.slice(0, 7) !== yearMonth) {
                              setYearMonth(cell.date.slice(0, 7));
                            }
                          }}
                          className={`min-h-[92px] p-2 text-left flex flex-col justify-between transition-opacity border-r border-[var(--border)] hover:opacity-90 cursor-pointer ${cellBg} ${
                            cell.inMonth ? '' : 'opacity-45'
                          } ${isSelected ? 'ring-2 ring-inset ring-[var(--text-primary)]' : ''}`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span
                              className={`text-xs font-mono-num ${
                                isToday
                                  ? 'font-bold text-[var(--info)] underline'
                                  : 'font-semibold text-[var(--text-primary)]'
                              }`}
                            >
                              {dayNumber}
                            </span>
                            <div className="flex items-center gap-1 text-[10px] font-mono-num text-[var(--text-muted)]">
                              {daySessionSummary.totalSessions > 0 && (
                                <span>{daySessionSummary.totalSessions}S</span>
                              )}
                              {info.tradeCount > 0 && <span>{info.tradeCount}T</span>}
                            </div>
                          </div>

                          <div className="space-y-1">
                            {/* Per-Session Color Marks */}
                            {daySessionSummary.totalSessions > 0 && (
                              <div className="flex flex-wrap items-center gap-1">
                                {daySessionSummary.items.map((item) => (
                                  <span
                                    key={item.session.id}
                                    title={`${item.session.sessionName}: ${getSessionOutcomeLabel(
                                      item.outcome,
                                      item.tradeCount
                                    )}`}
                                    className={`w-2 h-2 rounded-[2px] ${getSessionMarkColorClass(
                                      item.outcome
                                    )}`}
                                  />
                                ))}
                              </div>
                            )}

                            {info.tradeCount > 0 && (
                              <div
                                className={`text-xs font-mono-num font-semibold ${
                                  info.netProfitPercent > 0
                                    ? 'text-[var(--positive)]'
                                    : info.netProfitPercent < 0
                                    ? 'text-[var(--negative)]'
                                    : 'text-[var(--text-primary)]'
                                }`}
                              >
                                {info.netProfitPercent >= 0 ? '+' : ''}
                                {info.netProfitPercent}%
                              </div>
                            )}
                            {info.tradeCount === 0 && info.attendedSessions > 0 && (
                              <div className="text-[10px] font-medium text-[var(--info)]">
                                0 trades
                              </div>
                            )}
                            {info.tradeCount === 0 &&
                              info.attendedSessions === 0 &&
                              info.missedSessions > 0 && (
                                <div className="text-[10px] font-medium text-[var(--caution)]">
                                  Missed
                                </div>
                              )}
                          </div>
                        </button>
                      );
                    })}

                    {/* Weekly Rollup Cell */}
                    <div
                      className="min-h-[92px] p-2 bg-[var(--subtle-surface)] flex flex-col justify-between text-right"
                      title={`Week ${week.weekNum}: ${weekCoverage.weekdayDaysAttended}/${weekTradingDays} Mon–Fri trading days attended · ${weekCoverage.sessionsTraded} traded · ${weekCoverage.sessionsAttendedNoTrade} attended (0T) · ${weekCoverage.missedSessions} missed`}
                    >
                      <div className="flex items-center justify-between gap-1 text-[10px] font-mono-num text-[var(--text-muted)]">
                        <span className="font-semibold">W{week.weekNum}</span>
                        <span>
                          {weekCoverage.weekdayDaysAttended}/{weekTradingDays}d
                        </span>
                      </div>

                      {weekFin.closedTradesCount > 0 ? (
                        <div>
                          <div
                            className={`text-xs font-mono-num font-semibold ${
                              weekFin.netProfitPercent > 0
                                ? 'text-[var(--positive)]'
                                : weekFin.netProfitPercent < 0
                                ? 'text-[var(--negative)]'
                                : 'text-[var(--text-primary)]'
                            }`}
                          >
                            {weekFin.netProfitPercent >= 0 ? '+' : ''}
                            {weekFin.netProfitPercent}%
                          </div>
                          <div className="text-[10px] font-mono-num text-[var(--text-muted)]">
                            {weekFin.winCount}W / {weekFin.lossCount}L
                          </div>
                        </div>
                      ) : (
                        <div className="text-[11px] font-mono-num text-[var(--text-muted)]">—</div>
                      )}

                      {weekCoverage.totalSessions > 0 && (
                        <div className="flex items-center justify-end gap-1.5 text-[10px] font-mono-num text-[var(--text-secondary)]">
                          <span className="inline-flex items-center gap-0.5" title="Traded sessions">
                            <span className="w-1.5 h-1.5 rounded-[1px] bg-[var(--positive)]" />
                            {weekCoverage.sessionsTraded}
                          </span>
                          <span
                            className="inline-flex items-center gap-0.5"
                            title="Attended sessions (0 trades)"
                          >
                            <span className="w-1.5 h-1.5 rounded-[1px] bg-[var(--info)]" />
                            {weekCoverage.sessionsAttendedNoTrade}
                          </span>
                          <span className="inline-flex items-center gap-0.5" title="Missed sessions">
                            <span className="w-1.5 h-1.5 rounded-[1px] bg-[var(--caution)]" />
                            {weekCoverage.missedSessions}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right 4 cols: Selected Day Inspector */}
        <aside className="xl:col-span-4 p-5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-4 text-xs">
          <div className="flex items-start justify-between gap-2 pb-3 border-b border-[var(--border)]">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                {formatDisplayDate(selectedDate)}
              </h2>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5 font-mono-num">
                {selectedDate} · {DAY_STATUS_TEXT[selectedDayInfo.status]}
              </div>
            </div>
            <SecondaryButton
              size="sm"
              type="button"
              onClick={() => onOpenDateRecords(selectedDate)}
            >
              Open Records
              <ArrowRight className="w-3.5 h-3.5" />
            </SecondaryButton>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="p-2.5 rounded-lg bg-[var(--subtle-surface)]">
              <div className="text-[11px] text-[var(--text-muted)]">Return %</div>
              <div
                className={`font-mono-num font-semibold mt-0.5 ${
                  selectedDayInfo.netProfitPercent > 0
                    ? 'text-[var(--positive)]'
                    : selectedDayInfo.netProfitPercent < 0
                    ? 'text-[var(--negative)]'
                    : 'text-[var(--text-primary)]'
                }`}
              >
                {selectedDayInfo.tradeCount > 0
                  ? `${selectedDayInfo.netProfitPercent >= 0 ? '+' : ''}${selectedDayInfo.netProfitPercent}%`
                  : '—'}
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-[var(--subtle-surface)]">
              <div className="text-[11px] text-[var(--text-muted)]">Trades</div>
              <div className="font-mono-num font-semibold mt-0.5">{selectedDayTrades.length}</div>
            </div>
            <div className="p-2.5 rounded-lg bg-[var(--subtle-surface)]">
              <div className="text-[11px] text-[var(--text-muted)]">Sessions</div>
              <div className="font-mono-num font-semibold mt-0.5">
                {selectedDaySessionsSummary.totalSessions}
              </div>
            </div>
          </div>

          {/* Daily Journal Summary */}
          <div className="space-y-1.5 pt-2 border-t border-[var(--border)]">
            <div className="font-semibold text-[var(--text-primary)]">Daily Journal</div>
            {selectedDayJournal ? (
              <div className="space-y-1 text-[var(--text-secondary)]">
                <div className="font-mono-num text-[11px] text-[var(--text-muted)]">
                  State: {selectedDayJournal.dailyEmotionalState} · Discipline{' '}
                  {selectedDayJournal.disciplineRating}/10
                </div>
                {selectedDayJournal.dailyReflection && (
                  <p className="text-[var(--text-primary)] line-clamp-3">
                    {selectedDayJournal.dailyReflection}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-[var(--text-muted)]">No journal entry recorded for this date.</p>
            )}
          </div>

          {/* Day Sessions */}
          <div className="space-y-2 pt-2 border-t border-[var(--border)]">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-[var(--text-primary)]">
                Sessions ({selectedDaySessionsSummary.totalSessions})
              </div>
              {selectedDaySessionsSummary.totalSessions > 0 && (
                <div className="text-[11px] font-mono-num text-[var(--text-muted)]">
                  {selectedDaySessionsSummary.tradedCount} traded ·{' '}
                  {selectedDaySessionsSummary.attendedNoTradeCount} no-trade ·{' '}
                  {selectedDaySessionsSummary.missedCount} missed
                </div>
              )}
            </div>
            {selectedDaySessionsSummary.totalSessions === 0 ? (
              <p className="text-[var(--text-muted)]">No sessions recorded.</p>
            ) : (
              <div className="space-y-1.5">
                {selectedDaySessionsSummary.items.map(({ session: s, outcome, tradeCount }) => (
                  <div
                    key={s.id}
                    className="px-3 py-2 rounded-lg bg-[var(--subtle-surface)] flex items-center justify-between gap-2"
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      <span
                        className={`w-2 h-2 rounded-[2px] mt-1.5 shrink-0 ${getSessionMarkColorClass(
                          outcome
                        )}`}
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-[var(--text-primary)] truncate">
                          {s.sessionName}
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)]">
                          {getSessionOutcomeLabel(outcome, tradeCount)} ·{' '}
                          {SESSION_ATTENDANCE_LABELS[s.attendance]}
                        </div>
                      </div>
                    </div>
                    <div className="text-[11px] text-[var(--text-secondary)] shrink-0">
                      Plan: {PLAN_ADHERENCE_LABELS[s.planAdherence ?? 'pending']}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Day Trades */}
          <div className="space-y-1.5 pt-2 border-t border-[var(--border)]">
            <div className="font-semibold text-[var(--text-primary)]">
              Executions ({selectedDayTrades.length})
            </div>
            {selectedDayTrades.length === 0 ? (
              <p className="text-[var(--text-muted)]">No trades executed on {selectedDate}.</p>
            ) : (
              <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg">
                {selectedDayTrades.map((t) => {
                  const cur = (
                    t.currency ||
                    accountCurrencyLookup.get(t.accountId) ||
                    preferredCurrency ||
                    'USD'
                  ).toUpperCase();
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setInspectedTrade(t)}
                      className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-[var(--subtle-surface)] cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-[var(--text-primary)] truncate">
                          {t.instrument} · {TRADE_DIRECTION_LABELS[t.direction]}
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)] truncate">
                          {t.accountName} · {EXIT_OUTCOME_LABELS[t.exitOutcome]}
                        </div>
                      </div>
                      <div className="text-right font-mono-num shrink-0">
                        {typeof t.actualProfitPercent === 'number' ? (
                          <div
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
                          </div>
                        ) : (
                          <div className="text-[var(--info)]">Open</div>
                        )}
                        {typeof t.netPnl === 'number' && (
                          <div className="text-[10px] text-[var(--text-muted)]">
                            {t.netPnl >= 0 ? '+' : ''}
                            {t.netPnl.toFixed(2)} {cur}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </div>

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
        onRequestCloseTrade={
          onRequestCloseTrade
            ? (t) => {
                setInspectedTrade(null);
                onRequestCloseTrade(t);
              }
            : undefined
        }
      />
    </div>
  );
}
