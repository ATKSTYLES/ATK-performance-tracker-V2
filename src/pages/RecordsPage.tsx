import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { TradeInspectorDrawer } from '../components/trading/TradeInspectorDrawer';
import {
  DatePicker,
  DestructiveButton,
  SecondaryButton,
  SegmentedControl,
} from '../components/ui/Controls';
import {
  DataColumn,
  DataTable,
  EmptyState,
  MetricDisplay,
  PageHeader,
  Timeline,
} from '../components/ui/DataDisplay';
import { Drawer, ErrorBanner } from '../components/ui/Overlays';
import { useWorkspace } from '../context/WorkspaceContext';
import {
  calculateSessionCoverageMetrics,
  classifySessionOutcome,
  getMonthBoundsForYearMonth,
  getWeekBoundsForDate,
  isActiveTrade,
  isDateInRange,
  SessionPeriodComparativeRow,
} from '../domain/calculations';
import {
  EXIT_OUTCOME_LABELS,
  PLAN_ADHERENCE_LABELS,
  SESSION_ATTENDANCE_LABELS,
  SESSION_BIAS_LABELS,
  SESSION_EVENT_LABELS,
  SESSION_STATUS_LABELS,
  SETUP_AVAILABILITY_LABELS,
  SITTING_LOCATION_LABELS,
  TRADE_DIRECTION_LABELS,
} from '../domain/enums';
import {
  formatDisplayDate,
  formatDurationMinutes,
  formatTimestampInTimezone,
  getTodayInTimezone,
  shiftDateStr,
} from '../domain/timezone';
import { AppErrorDiagnostic, Trade, TradingSession } from '../domain/types';
import { deleteSessionCascade } from '../storage/repository';

type AllDatesTimeframe = 'all' | 'weekly' | 'monthly' | 'custom';

function shiftYearMonth(ym: string, deltaMonths: number): string {
  const [y, m] = ym.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
  return dt.toISOString().slice(0, 7);
}

export function RecordsPage({
  selectedDateProp,
  onRequestCloseTrade,
}: {
  selectedDateProp?: string;
  onRequestCloseTrade: (trade: Trade) => void;
}) {
  const {
    user,
    dailyJournals,
    sessions,
    sessionEvents,
    trades,
    tradeEvents,
    attachments,
    timezone,
    refreshDiagnostics,
  } = useWorkspace();

  const today = getTodayInTimezone(timezone);
  const [selectedDate, setSelectedDate] = useState(selectedDateProp || today);
  const [scope, setScope] = useState<'date' | 'all'>('date');
  const [allDatesTimeframe, setAllDatesTimeframe] = useState<AllDatesTimeframe>('all');
  const [weekAnchorDate, setWeekAnchorDate] = useState(today);
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));
  const [customStart, setCustomStart] = useState(shiftDateStr(today, -29));
  const [customEnd, setCustomEnd] = useState(today);
  const [breakdownView, setBreakdownView] = useState<'weekly' | 'monthly'>('weekly');
  const [selectedSession, setSelectedSession] = useState<TradingSession | null>(null);
  const [inspectedTrade, setInspectedTrade] = useState<Trade | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  React.useEffect(() => {
    if (selectedDateProp) {
      setSelectedDate(selectedDateProp);
      setScope('date');
    }
  }, [selectedDateProp]);

  const activeAllDatesRange = useMemo(() => {
    if (allDatesTimeframe === 'weekly') {
      return getWeekBoundsForDate(weekAnchorDate);
    }
    if (allDatesTimeframe === 'monthly') {
      return getMonthBoundsForYearMonth(selectedMonth);
    }
    if (allDatesTimeframe === 'custom') {
      const start = customStart || '';
      const end = customEnd || '';
      const label =
        start && end
          ? `${formatDisplayDate(start)} – ${formatDisplayDate(end)}`
          : start
          ? `From ${formatDisplayDate(start)}`
          : end
          ? `Until ${formatDisplayDate(end)}`
          : 'Custom Range';
      return { start, end, label };
    }
    return { start: '', end: '', label: 'All Recorded Dates' };
  }, [allDatesTimeframe, weekAnchorDate, selectedMonth, customStart, customEnd]);

  const journalForDate = useMemo(
    () => dailyJournals.find((j) => j.date === selectedDate) ?? null,
    [dailyJournals, selectedDate]
  );

  const visibleSessions = useMemo(() => {
    const base =
      scope === 'all'
        ? sessions.filter((s) =>
            isDateInRange(s.date, {
              start: activeAllDatesRange.start,
              end: activeAllDatesRange.end,
            })
          )
        : sessions.filter((s) => s.date === selectedDate);
    return [...base].sort((a, b) =>
      (b.actualStartTime ?? b.date).localeCompare(a.actualStartTime ?? a.date)
    );
  }, [sessions, scope, selectedDate, activeAllDatesRange]);

  const sessionCoverage = useMemo(
    () =>
      calculateSessionCoverageMetrics({
        sessions,
        trades,
        startDate: activeAllDatesRange.start || undefined,
        endDate: activeAllDatesRange.end || undefined,
      }),
    [sessions, trades, activeAllDatesRange]
  );

  const handleDeleteSession = async (session: TradingSession) => {
    if (!user || deletingSessionId) return;
    setDeletingSessionId(session.id);
    setDeleteError(null);
    try {
      await deleteSessionCascade(user.uid, session, sessionEvents, attachments);
      if (selectedSession?.id === session.id) {
        setSelectedSession(null);
      }
    } catch (err) {
      const diag = err as Partial<AppErrorDiagnostic> & { message?: string };
      setDeleteError(
        diag.userMessage || diag.message || 'Unable to delete the selected session.'
      );
      refreshDiagnostics();
    } finally {
      setDeletingSessionId(null);
    }
  };

  const sessionColumns: Array<DataColumn<TradingSession>> = [
    {
      key: 'date',
      header: 'Date',
      render: (s) => <span className="font-mono-num text-[var(--text-secondary)]">{s.date}</span>,
    },
    {
      key: 'session',
      header: 'Session',
      render: (s) => {
        const { outcome } = classifySessionOutcome(s, trades);
        const dotClass =
          outcome === 'traded'
            ? 'bg-[var(--positive)]'
            : outcome === 'attended_no_trade'
            ? 'bg-[var(--info)]'
            : outcome === 'missed'
            ? 'bg-[var(--caution)]'
            : 'bg-[var(--text-muted)]/40';
        return (
          <span className="inline-flex items-center gap-2 font-medium">
            <span className={`w-2 h-2 rounded-[2px] shrink-0 ${dotClass}`} />
            <span>{s.sessionName}</span>
          </span>
        );
      },
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
          {trades.filter((t) => isActiveTrade(t) && !t.isOutOfSession && t.sessionId === s.id).length}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (s) => (
        <button
          type="button"
          disabled={deletingSessionId === s.id}
          onClick={(e) => {
            e.stopPropagation();
            void handleDeleteSession(s);
          }}
          title={`Delete ${s.sessionName} session (${s.date})`}
          aria-label={`Delete ${s.sessionName} session on ${s.date}`}
          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--border)] text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--negative)] hover:border-[var(--negative)]/50 hover:bg-[var(--negative-bg)] disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          <Trash2 className="w-3 h-3" />
          <span>{deletingSessionId === s.id ? 'Deleting...' : 'Delete'}</span>
        </button>
      ),
    },
  ];

  const comparativeColumns: Array<DataColumn<SessionPeriodComparativeRow>> = [
    {
      key: 'period',
      header: breakdownView === 'weekly' ? 'Week (Mon–Sun)' : 'Month',
      render: (r) => <span className="font-medium text-[var(--text-primary)]">{r.label}</span>,
    },
    {
      key: 'tradingDays',
      header: '5d/Wk Days',
      align: 'right',
      render: (r) => <span className="font-mono-num text-[var(--text-secondary)]">{r.tradingDays}</span>,
    },
    {
      key: 'attended',
      header: 'Attended',
      align: 'right',
      render: (r) => <span className="font-mono-num font-medium">{r.attendedSessions}</span>,
    },
    {
      key: 'traded',
      header: 'Traded Sessions',
      align: 'right',
      render: (r) => (
        <span
          className={`font-mono-num font-semibold ${
            r.sessionsTraded > 0 ? 'text-[var(--positive)]' : 'text-[var(--text-muted)]'
          }`}
        >
          {r.sessionsTraded}
        </span>
      ),
    },
    {
      key: 'tradesInSessions',
      header: 'Trades Taken',
      align: 'right',
      render: (r) => <span className="font-mono-num">{r.tradesInSessions}</span>,
    },
    {
      key: 'noTrade',
      header: 'Attended (0T)',
      align: 'right',
      render: (r) => (
        <span
          className={`font-mono-num ${
            r.sessionsAttendedNoTrade > 0 ? 'text-[var(--info)]' : 'text-[var(--text-muted)]'
          }`}
        >
          {r.sessionsAttendedNoTrade}
        </span>
      ),
    },
    {
      key: 'missed',
      header: 'Not Attended',
      align: 'right',
      render: (r) => (
        <span
          className={`font-mono-num ${
            r.missedSessions > 0 ? 'text-[var(--caution)] font-medium' : 'text-[var(--text-muted)]'
          }`}
        >
          {r.missedSessions}
        </span>
      ),
    },
    {
      key: 'coverage',
      header: 'Day Coverage (5d/Wk)',
      align: 'right',
      render: (r) => (
        <span className="font-mono-num text-[var(--text-secondary)]">
          {r.weekdayDaysAttended}/{r.tradingDays}
          {r.tradingDayCoverageRate !== null ? ` (${r.tradingDayCoverageRate}%)` : ''}
        </span>
      ),
    },
  ];

  const activeSession = selectedSession
    ? sessions.find((s) => s.id === selectedSession.id) ?? selectedSession
    : null;

  const eventsForDrawerSession = useMemo(() => {
    if (!activeSession) return [];
    return sessionEvents
      .filter((e) => e.sessionId === activeSession.id)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, [sessionEvents, activeSession?.id]);

  const tradesForDrawerSession = useMemo(() => {
    if (!activeSession) return [];
    return trades
      .filter((t) => isActiveTrade(t) && !t.isOutOfSession && t.sessionId === activeSession.id)
      .sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  }, [trades, activeSession?.id]);

  const breakdownRows =
    breakdownView === 'weekly' ? sessionCoverage.weeklyBreakdown : sessionCoverage.monthlyBreakdown;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Daily / Session Records"
        subtitle="Historical viewer for daily journals, session timelines, attendance comparatives, and linked trades."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              value={scope}
              onChange={setScope}
              options={[
                { value: 'date', label: 'Selected Date' },
                { value: 'all', label: 'All Dates' },
              ]}
            />
            {scope === 'date' && (
              <>
                <SecondaryButton
                  size="sm"
                  type="button"
                  onClick={() => setSelectedDate(shiftDateStr(selectedDate, -1))}
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Prev
                </SecondaryButton>
                <div className="w-40">
                  <DatePicker value={selectedDate} onChange={setSelectedDate} />
                </div>
                <SecondaryButton
                  size="sm"
                  type="button"
                  onClick={() => setSelectedDate(shiftDateStr(selectedDate, 1))}
                >
                  Next
                  <ChevronRight className="w-3.5 h-3.5" />
                </SecondaryButton>
              </>
            )}
          </div>
        }
      />

      {deleteError && (
        <ErrorBanner
          title="Session Deletion Failed"
          message={deleteError}
          onDismiss={() => setDeleteError(null)}
        />
      )}

      {/* All Dates Timeframe Controls + Weekly / Monthly 5-Day Trading Comparative */}
      {scope === 'all' && (
        <div className="space-y-5">
          <section className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-xs font-medium text-[var(--text-secondary)]">Timeframe</span>
              <SegmentedControl
                value={allDatesTimeframe}
                onChange={(val) => {
                  setAllDatesTimeframe(val);
                  if (val === 'weekly') setBreakdownView('weekly');
                  if (val === 'monthly') setBreakdownView('monthly');
                }}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'weekly', label: 'Weekly' },
                  { value: 'monthly', label: 'Monthly' },
                  { value: 'custom', label: 'Custom' },
                ]}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {allDatesTimeframe === 'weekly' && (
                <>
                  <SecondaryButton
                    size="sm"
                    type="button"
                    onClick={() => setWeekAnchorDate(shiftDateStr(weekAnchorDate, -7))}
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Prev Week
                  </SecondaryButton>
                  <div className="w-36">
                    <DatePicker value={weekAnchorDate} onChange={setWeekAnchorDate} />
                  </div>
                  <SecondaryButton
                    size="sm"
                    type="button"
                    onClick={() => setWeekAnchorDate(shiftDateStr(weekAnchorDate, 7))}
                  >
                    Next Week
                    <ChevronRight className="w-3.5 h-3.5" />
                  </SecondaryButton>
                  <span className="text-xs font-mono-num text-[var(--text-secondary)] pl-1">
                    {activeAllDatesRange.label}
                  </span>
                </>
              )}

              {allDatesTimeframe === 'monthly' && (
                <>
                  <SecondaryButton
                    size="sm"
                    type="button"
                    onClick={() => setSelectedMonth(shiftYearMonth(selectedMonth, -1))}
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Prev Month
                  </SecondaryButton>
                  <input
                    type="month"
                    value={selectedMonth}
                    onChange={(e) => {
                      if (e.target.value) setSelectedMonth(e.target.value);
                    }}
                    className="h-8 px-2.5 text-xs font-mono-num rounded-lg bg-[var(--surface)] text-[var(--text-primary)] border border-[var(--border)] focus:outline-none focus:border-[var(--text-secondary)]"
                  />
                  <SecondaryButton
                    size="sm"
                    type="button"
                    onClick={() => setSelectedMonth(shiftYearMonth(selectedMonth, 1))}
                  >
                    Next Month
                    <ChevronRight className="w-3.5 h-3.5" />
                  </SecondaryButton>
                  <span className="text-xs font-mono-num text-[var(--text-secondary)] pl-1">
                    {activeAllDatesRange.start} → {activeAllDatesRange.end}
                  </span>
                </>
              )}

              {allDatesTimeframe === 'custom' && (
                <>
                  <span className="text-xs text-[var(--text-muted)]">From</span>
                  <div className="w-36">
                    <DatePicker value={customStart} onChange={setCustomStart} />
                  </div>
                  <span className="text-xs text-[var(--text-muted)]">To</span>
                  <div className="w-36">
                    <DatePicker value={customEnd} onChange={setCustomEnd} />
                  </div>
                </>
              )}

              {allDatesTimeframe === 'all' && (
                <span className="text-xs font-mono-num text-[var(--text-muted)]">
                  {sessionCoverage.startDate && sessionCoverage.endDate
                    ? `${sessionCoverage.startDate} → ${sessionCoverage.endDate} · ${sessionCoverage.tradingDays} Mon–Fri trading days`
                    : 'All recorded sessions'}
                </span>
              )}
            </div>
          </section>

          {/* Session Attendance & 5-Day Trading Week Summary KPIs */}
          <section className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Session Performance &amp; 5-Day Trading Week Comparative · {activeAllDatesRange.label}
              </h2>
              <span className="text-[11px] font-mono-num text-[var(--text-muted)]">
                5 trading days/week (Mon–Fri) baseline
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <MetricDisplay
                label="Sessions Traded"
                value={String(sessionCoverage.sessionsTraded)}
                sublabel={`${sessionCoverage.tradesInSessions} trade(s) taken in sessions`}
                tone={sessionCoverage.sessionsTraded > 0 ? 'positive' : 'default'}
              />
              <MetricDisplay
                label="Sessions Attended"
                value={String(sessionCoverage.attendedSessions)}
                sublabel={`${sessionCoverage.sessionsTraded} traded · ${sessionCoverage.sessionsAttendedNoTrade} no-trade`}
                tone="info"
              />
              <MetricDisplay
                label="Sessions Not Attended"
                value={String(sessionCoverage.missedSessions)}
                sublabel={`${
                  sessionCoverage.attendanceRate !== null
                    ? `${sessionCoverage.attendanceRate}% attendance`
                    : 'No sessions logged'
                }${sessionCoverage.cancelledSessions > 0 ? ` · ${sessionCoverage.cancelledSessions} cancelled` : ''}`}
                tone={sessionCoverage.missedSessions > 0 ? 'caution' : 'default'}
              />
              <MetricDisplay
                label="5-Day Week Trading Days"
                value={`${sessionCoverage.weekdayDaysAttended} / ${sessionCoverage.tradingDays}`}
                sublabel={`${
                  sessionCoverage.tradingDayCoverageRate !== null
                    ? `${sessionCoverage.tradingDayCoverageRate}% of Mon–Fri days`
                    : 'No weekdays in range'
                }`}
              />
              <MetricDisplay
                label="Unlogged Trading Days"
                value={String(sessionCoverage.tradingDaysWithoutAttendance)}
                sublabel={`${sessionCoverage.daysWithTradedSession} day(s) traded · ${sessionCoverage.daysWithAttendedSession} day(s) attended`}
                tone={
                  sessionCoverage.tradingDaysWithoutAttendance > 0 ? 'caution' : 'positive'
                }
              />
            </div>
          </section>

          {/* Weekly & Monthly Comparative Breakdown Table */}
          <section className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  Weekly &amp; Monthly Session Comparative
                </h2>
                <p className="text-xs text-[var(--text-muted)]">
                  Compares attended, traded, and missed sessions against expected 5-day trading weeks. Click a row to focus that period.
                </p>
              </div>
              <SegmentedControl
                value={breakdownView}
                onChange={setBreakdownView}
                options={[
                  { value: 'weekly', label: 'Weekly Basis' },
                  { value: 'monthly', label: 'Monthly Basis' },
                ]}
              />
            </div>

            <DataTable
              columns={comparativeColumns}
              rows={breakdownRows}
              rowKey={(r) => r.key}
              onRowClick={(r) => {
                if (breakdownView === 'weekly') {
                  setAllDatesTimeframe('weekly');
                  setWeekAnchorDate(r.startDate);
                } else {
                  setAllDatesTimeframe('monthly');
                  setSelectedMonth(r.key);
                }
              }}
              emptyMessage="No weekly or monthly session records in this timeframe."
            />
          </section>
        </div>
      )}

      {/* Daily Journal Historical Record */}
      {scope === 'date' && (
        <section className="p-5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-4">
          <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Daily Journal · {formatDisplayDate(selectedDate)}
            </h2>
            {journalForDate && (
              <span className="text-xs font-mono-num text-[var(--text-secondary)]">
                Emotion: {journalForDate.dailyEmotionalState} · Discipline:{' '}
                {journalForDate.disciplineRating}/10
              </span>
            )}
          </div>

          {!journalForDate ? (
            <EmptyState
              title="No Daily Journal Record"
              description={`No day-level preparation or reflection was recorded for ${selectedDate}.`}
            />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 text-xs">
              <div className="lg:col-span-2 space-y-3">
                <div>
                  <div className="text-[var(--text-muted)] mb-1">Planned Activities</div>
                  <p className="text-[var(--text-primary)] whitespace-pre-wrap">
                    {journalForDate.plannedActivities || '—'}
                  </p>
                </div>
                <div>
                  <div className="text-[var(--text-muted)] mb-1">Morning Notes</div>
                  <p className="text-[var(--text-primary)] whitespace-pre-wrap">
                    {journalForDate.morningNotes || '—'}
                  </p>
                </div>
                <div>
                  <div className="text-[var(--text-muted)] mb-1">Daily Reflection</div>
                  <p className="text-[var(--text-primary)] whitespace-pre-wrap">
                    {journalForDate.dailyReflection || '—'}
                  </p>
                </div>
              </div>
              <div className="space-y-2 border-t lg:border-t-0 lg:border-l border-[var(--border)] pt-3 lg:pt-0 lg:pl-5">
                <div className="font-semibold text-[var(--text-primary)]">Daily Checklist</div>
                <ul className="space-y-1.5">
                  {journalForDate.checklistItems.map((c) => (
                    <li
                      key={c.id}
                      className={`flex items-center gap-2 ${
                        c.completed ? 'text-[var(--positive)]' : 'text-[var(--text-muted)]'
                      }`}
                    >
                      <span className="font-mono-num">{c.completed ? '[x]' : '[ ]'}</span>
                      <span>{c.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Sessions Table */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {scope === 'all'
              ? `Sessions · ${activeAllDatesRange.label} (${visibleSessions.length})`
              : `Sessions for ${selectedDate}`}
          </h2>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-[var(--text-muted)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-[2px] bg-[var(--positive)]" />
              Traded
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-[2px] bg-[var(--info)]" />
              Attended (0 trades)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-[2px] bg-[var(--caution)]" />
              Not Attended
            </span>
          </div>
        </div>
        <DataTable
          columns={sessionColumns}
          rows={visibleSessions}
          rowKey={(s) => s.id}
          onRowClick={(s) => setSelectedSession(s)}
          emptyMessage="No trading sessions recorded for this selection."
        />
      </section>

      {/* Session Detail Drawer */}
      <Drawer
        open={Boolean(activeSession)}
        onClose={() => setSelectedSession(null)}
        title={activeSession ? `${activeSession.sessionName} Session` : ''}
        subtitle={
          activeSession
            ? `${activeSession.date} · ${SESSION_STATUS_LABELS[activeSession.status]} · ${
                SESSION_ATTENDANCE_LABELS[activeSession.attendance]
              }`
            : ''
        }
      >
        {activeSession && (
          <div className="space-y-6 text-xs">
            <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)]">
              <span className="text-[11px] text-[var(--text-secondary)]">
                Deleting this session removes its session timeline while keeping trade records intact.
              </span>
              <DestructiveButton
                size="sm"
                type="button"
                disabled={deletingSessionId === activeSession.id}
                onClick={() => void handleDeleteSession(activeSession)}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deletingSessionId === activeSession.id ? 'Deleting...' : 'Delete Session'}
              </DestructiveButton>
            </div>
            <section className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-lg border border-[var(--border)]">
                <div className="text-[var(--text-muted)]">Sitting Location</div>
                <div className="font-semibold mt-0.5">
                  {activeSession.sittingLocation === 'other'
                    ? activeSession.sittingLocationCustom
                    : SITTING_LOCATION_LABELS[activeSession.sittingLocation]}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-[var(--border)]">
                <div className="text-[var(--text-muted)]">Pre-Session Emotion</div>
                <div className="font-semibold mt-0.5">{activeSession.preSessionEmotion}</div>
              </div>
              <div className="p-3 rounded-lg border border-[var(--border)]">
                <div className="text-[var(--text-muted)]">Session Bias</div>
                <div className="font-semibold mt-0.5">
                  {activeSession.sessionBias === 'custom'
                    ? activeSession.sessionBiasCustom
                    : SESSION_BIAS_LABELS[activeSession.sessionBias]}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-[var(--border)]">
                <div className="text-[var(--text-muted)]">Start Timestamp</div>
                <div className="font-mono-num font-semibold mt-0.5">
                  {formatTimestampInTimezone(activeSession.actualStartTime, timezone)}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-[var(--border)]">
                <div className="text-[var(--text-muted)]">End Timestamp</div>
                <div className="font-mono-num font-semibold mt-0.5">
                  {formatTimestampInTimezone(activeSession.actualEndTime, timezone)}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-[var(--border)]">
                <div className="text-[var(--text-muted)]">Duration</div>
                <div className="font-mono-num font-semibold mt-0.5">
                  {activeSession.actualStartTime
                    ? formatDurationMinutes(
                        activeSession.actualStartTime,
                        activeSession.actualEndTime
                      )
                    : '—'}
                </div>
              </div>
            </section>

            <section className="space-y-2 border-t border-[var(--border)] pt-4">
              <h3 className="font-semibold text-[var(--text-primary)]">Preparation Notes</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[var(--text-secondary)]">
                <div>
                  <span className="text-[var(--text-muted)] block">Key Levels</span>
                  {activeSession.keyLevels || '—'}
                </div>
                <div>
                  <span className="text-[var(--text-muted)] block">Market Expectations</span>
                  {activeSession.marketExpectations || '—'}
                </div>
                <div>
                  <span className="text-[var(--text-muted)] block">Liquidity Targets</span>
                  {activeSession.liquidityTargets || '—'}
                </div>
                <div>
                  <span className="text-[var(--text-muted)] block">Invalidation</span>
                  {activeSession.invalidationConditions || '—'}
                </div>
              </div>
              {activeSession.preparationNotes && (
                <p className="text-[var(--text-primary)] pt-1 whitespace-pre-wrap">
                  {activeSession.preparationNotes}
                </p>
              )}
            </section>

            <section className="space-y-2 border-t border-[var(--border)] pt-4">
              <h3 className="font-semibold text-[var(--text-primary)]">Closing &amp; Adherence</h3>
              <div className="grid grid-cols-3 gap-3 text-[var(--text-secondary)]">
                <div>
                  Plan Adherence:{' '}
                  <strong>
                    {PLAN_ADHERENCE_LABELS[activeSession.planAdherence ?? 'pending']}
                  </strong>
                </div>
                <div>
                  Setup Availability:{' '}
                  <strong>
                    {SETUP_AVAILABILITY_LABELS[activeSession.setupAvailability ?? 'pending']}
                  </strong>
                </div>
                <div>
                  Post Emotion: <strong>{activeSession.postSessionEmotion || '—'}</strong>
                </div>
              </div>
              {activeSession.closingReflection && (
                <p className="text-[var(--text-primary)] pt-1 whitespace-pre-wrap">
                  {activeSession.closingReflection}
                </p>
              )}
            </section>

            <section className="space-y-2 border-t border-[var(--border)] pt-4">
              <h3 className="font-semibold text-[var(--text-primary)]">
                Session Event Timeline ({eventsForDrawerSession.length})
              </h3>
              <Timeline
                timezone={timezone}
                items={eventsForDrawerSession.map((ev) => ({
                  id: ev.id,
                  timestamp: ev.timestamp,
                  label: SESSION_EVENT_LABELS[ev.eventType] ?? ev.eventType,
                  description: ev.description,
                }))}
              />
            </section>

            <section className="space-y-2 border-t border-[var(--border)] pt-4">
              <h3 className="font-semibold text-[var(--text-primary)]">
                Linked Trades ({tradesForDrawerSession.length})
              </h3>
              {tradesForDrawerSession.length === 0 ? (
                <p className="text-[var(--text-muted)]">No trades executed in this session.</p>
              ) : (
                <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg">
                  {tradesForDrawerSession.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setInspectedTrade(t)}
                      className="w-full px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-[var(--subtle-surface)] text-left cursor-pointer"
                    >
                      <div>
                        <span className="font-semibold">{t.instrument}</span>{' '}
                        <span className="text-[var(--text-muted)]">
                          · {TRADE_DIRECTION_LABELS[t.direction]} · {t.accountName}
                        </span>
                      </div>
                      <div className="font-mono-num">
                        {t.status === 'closed'
                          ? `${EXIT_OUTCOME_LABELS[t.exitOutcome]} (${
                              typeof t.actualProfitPercent === 'number'
                                ? `${t.actualProfitPercent >= 0 ? '+' : ''}${t.actualProfitPercent}%`
                                : '—'
                            })`
                          : 'Open'}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </Drawer>

      <TradeInspectorDrawer
        trade={inspectedTrade ? trades.find((t) => t.id === inspectedTrade.id) ?? inspectedTrade : null}
        tradeEvents={tradeEvents}
        attachments={attachments.filter((a) => a.relatedType === 'trade' && a.relatedId === inspectedTrade?.id)}
        allAttachments={attachments}
        userId={user?.uid ?? ''}
        timezone={timezone}
        onClose={() => setInspectedTrade(null)}
        onSelectTrade={(t) => setInspectedTrade(t)}
        onRequestCloseTrade={(t) => {
          setInspectedTrade(null);
          onRequestCloseTrade(t);
        }}
      />
    </div>
  );
}
