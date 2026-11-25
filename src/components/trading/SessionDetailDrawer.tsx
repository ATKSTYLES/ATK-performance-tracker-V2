import React, { useMemo } from 'react';
import { Timeline } from '../ui/DataDisplay';
import { Drawer } from '../ui/Overlays';
import { getSessionLinkedTrades } from '../../domain/calculations';
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
} from '../../domain/enums';
import {
  formatDurationMinutes,
  formatTimestampInTimezone,
} from '../../domain/timezone';
import { SessionEvent, Trade, TradingSession } from '../../domain/types';

/**
 * Read-only session inspection drawer matching Daily / Session Records exactly,
 * allowing Dashboard and Analytics users to verify linked session events and trades.
 */
export function SessionDetailDrawer({
  session,
  sessionEvents,
  trades,
  timezone,
  onClose,
  onSelectTrade,
}: {
  session: TradingSession | null;
  sessionEvents: SessionEvent[];
  trades: Trade[];
  timezone: string;
  onClose: () => void;
  onSelectTrade: (trade: Trade) => void;
}) {
  const eventsForSession = useMemo(() => {
    if (!session) return [];
    return sessionEvents
      .filter((e) => e.sessionId === session.id)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, [sessionEvents, session?.id]);

  const tradesForSession = useMemo(() => {
    if (!session) return [];
    return getSessionLinkedTrades(session.id, trades);
  }, [trades, session?.id]);

  return (
    <Drawer
      open={Boolean(session)}
      onClose={onClose}
      title={session ? `${session.sessionName} Session` : ''}
      subtitle={
        session
          ? `${session.date} · ${SESSION_STATUS_LABELS[session.status]} · ${
              SESSION_ATTENDANCE_LABELS[session.attendance]
            }`
          : ''
      }
    >
      {session && (
        <div className="space-y-6 text-xs">
          <section className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-lg border border-[var(--border)]">
              <div className="text-[var(--text-muted)]">Sitting Location</div>
              <div className="font-semibold mt-0.5">
                {session.sittingLocation === 'other'
                  ? session.sittingLocationCustom
                  : SITTING_LOCATION_LABELS[session.sittingLocation]}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border)]">
              <div className="text-[var(--text-muted)]">Pre-Session Emotion</div>
              <div className="font-semibold mt-0.5">{session.preSessionEmotion}</div>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border)]">
              <div className="text-[var(--text-muted)]">Session Bias</div>
              <div className="font-semibold mt-0.5">
                {session.sessionBias === 'custom'
                  ? session.sessionBiasCustom
                  : SESSION_BIAS_LABELS[session.sessionBias]}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border)]">
              <div className="text-[var(--text-muted)]">Start Timestamp</div>
              <div className="font-mono-num font-semibold mt-0.5">
                {formatTimestampInTimezone(session.actualStartTime, timezone)}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border)]">
              <div className="text-[var(--text-muted)]">End Timestamp</div>
              <div className="font-mono-num font-semibold mt-0.5">
                {formatTimestampInTimezone(session.actualEndTime, timezone)}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border)]">
              <div className="text-[var(--text-muted)]">Duration</div>
              <div className="font-mono-num font-semibold mt-0.5">
                {session.actualStartTime
                  ? formatDurationMinutes(session.actualStartTime, session.actualEndTime)
                  : '—'}
              </div>
            </div>
          </section>

          <section className="space-y-2 border-t border-[var(--border)] pt-4">
            <h3 className="font-semibold text-[var(--text-primary)]">Preparation Notes</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[var(--text-secondary)]">
              <div>
                <span className="text-[var(--text-muted)] block">Key Levels</span>
                {session.keyLevels || '—'}
              </div>
              <div>
                <span className="text-[var(--text-muted)] block">Market Expectations</span>
                {session.marketExpectations || '—'}
              </div>
            </div>
            {session.preparationNotes && (
              <p className="text-[var(--text-primary)] pt-1 whitespace-pre-wrap">
                {session.preparationNotes}
              </p>
            )}
          </section>

          <section className="space-y-2 border-t border-[var(--border)] pt-4">
            <h3 className="font-semibold text-[var(--text-primary)]">Closing &amp; Adherence</h3>
            <div className="grid grid-cols-3 gap-3 text-[var(--text-secondary)]">
              <div>
                Plan Adherence:{' '}
                <strong>{PLAN_ADHERENCE_LABELS[session.planAdherence ?? 'pending']}</strong>
              </div>
              <div>
                Setup Availability:{' '}
                <strong>{SETUP_AVAILABILITY_LABELS[session.setupAvailability ?? 'pending']}</strong>
              </div>
              <div>
                Post Emotion: <strong>{session.postSessionEmotion || '—'}</strong>
              </div>
            </div>
            {session.closingReflection && (
              <p className="text-[var(--text-primary)] pt-1 whitespace-pre-wrap">
                {session.closingReflection}
              </p>
            )}
          </section>

          <section className="space-y-2 border-t border-[var(--border)] pt-4">
            <h3 className="font-semibold text-[var(--text-primary)]">
              Session Event Timeline ({eventsForSession.length})
            </h3>
            <Timeline
              timezone={timezone}
              items={eventsForSession.map((ev) => ({
                id: ev.id,
                timestamp: ev.timestamp,
                label: SESSION_EVENT_LABELS[ev.eventType] ?? ev.eventType,
                description: ev.description,
              }))}
            />
          </section>

          <section className="space-y-2 border-t border-[var(--border)] pt-4">
            <h3 className="font-semibold text-[var(--text-primary)]">
              Linked Trades ({tradesForSession.length})
            </h3>
            {tradesForSession.length === 0 ? (
              <p className="text-[var(--text-muted)]">No trades executed in this session.</p>
            ) : (
              <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg">
                {tradesForSession.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onSelectTrade(t)}
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
  );
}
