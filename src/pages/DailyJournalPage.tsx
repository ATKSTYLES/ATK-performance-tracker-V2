import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Link2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  DEFAULT_DAILY_CHECKLIST,
  DEFAULT_SESSION_CHECKLIST,
  POST_TRADE_EMOTIONS,
  PRE_SESSION_EMOTIONS,
  QUICK_SESSION_EVENT_TYPES,
  QUICK_TRADE_EVENT_TYPES,
  SESSION_BIAS_LABELS,
  SESSION_EVENT_LABELS,
  SessionBias,
  SessionEventType,
  SITTING_LOCATION_LABELS,
  SittingLocation,
  TRADE_DIRECTION_LABELS,
  TRADE_EVENT_LABELS,
  TRADE_STATUS_LABELS,
  TradeDirection,
  TradeEventType,
} from '../domain/enums';
import {
  detectCurrentSessionTemplate,
  formatDisplayDate,
  formatDurationMinutes,
  formatTime12Hour,
  formatTimerHMS,
  formatTimestampInTimezone,
  getTodayInTimezone,
  shiftDateStr,
} from '../domain/timezone';
import { isActiveTrade, summarizeTradesForLedger } from '../domain/calculations';
import {
  PlanAdherence,
  SetupAvailability,
} from '../domain/enums';
import type {
  AppErrorDiagnostic,
  ChecklistItemState as ChecklistItem,
  Trade as TradeType,
} from '../domain/types';
import {
  computeDefaultExpectedProfit,
  generateRecordId,
  validatePreSessionCheckIn,
  validateTradeCreation,
} from '../domain/validation';
import { useWorkspace } from '../context/WorkspaceContext';
import {
  createRecord,
  createTradesForAccountsAtomically,
  endSessionAtomically,
  startSessionAtomically,
  updateRecord,
  upsertDailyJournal,
} from '../storage/repository';
import {
  DatePicker,
  FieldWrapper,
  NumberInput,
  PrimaryButton,
  RangeSlider,
  SecondaryButton,
  SegmentedControl,
  SelectInput,
  TextArea,
  TextInput,
  TimeInput12Hour,
} from '../components/ui/Controls';
import { MetricDisplay, Timeline } from '../components/ui/DataDisplay';
import { ErrorBanner, Modal } from '../components/ui/Overlays';
import { TradeClosureModal } from '../components/trading/TradeClosureModal';

const MAX_QUICK_SESSION_EVENTS = 30;
const MAX_QUICK_EVENT_LABEL_LEN = 120;
const DEFAULT_VISIBLE_QUICK_SESSION_EVENTS: SessionEventType[] = QUICK_SESSION_EVENT_TYPES.filter(
  (t) => t !== 'custom_observation'
);

function isBuiltInQuickSessionEventKey(value: string): value is SessionEventType {
  return (
    value !== 'custom_observation' &&
    Object.prototype.hasOwnProperty.call(SESSION_EVENT_LABELS, value)
  );
}

function getQuickSessionEventLabel(value: string): string {
  return isBuiltInQuickSessionEventKey(value) ? SESSION_EVENT_LABELS[value] : value;
}

const MAX_QUICK_TRADE_EVENTS = 30;
const DEFAULT_QUICK_TRADE_EVENTS: TradeEventType[] = [...QUICK_TRADE_EVENT_TYPES];

function isBuiltInQuickTradeEventKey(value: string): value is TradeEventType {
  return (
    value !== 'trade_opened' &&
    value !== 'trade_closed' &&
    Object.prototype.hasOwnProperty.call(TRADE_EVENT_LABELS, value)
  );
}

function getQuickTradeEventLabel(value: string): string {
  return isBuiltInQuickTradeEventKey(value) ? TRADE_EVENT_LABELS[value] : value;
}

export function DailyJournalPage() {
  const {
    user,
    accounts,
    dailyJournals,
    sessions,
    sessionEvents,
    trades,
    tradeEvents,
    sessionTemplates,
    checklists,
    instruments,
    preferences,
    timezone,
    preferredCurrency,
    liveSession,
    openTrades,
    refreshDiagnostics,
  } = useWorkspace();

  const uid = user?.uid ?? '';
  const today = getTodayInTimezone(timezone);
  const [selectedDate, setSelectedDate] = useState(today);
  const [nowMs, setNowMs] = useState(Date.now());

  // Live clock for session timer and trade durations
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // --- Daily Preparation State ---
  const currentJournal = useMemo(
    () => dailyJournals.find((j) => j.date === selectedDate) ?? null,
    [dailyJournals, selectedDate]
  );
  const defaultDailyItems = useMemo(() => {
    const cfg = checklists.find((c) => c.scope === 'daily');
    return cfg?.items ?? DEFAULT_DAILY_CHECKLIST;
  }, [checklists]);

  const [plannedActivities, setPlannedActivities] = useState('');
  const [morningNotes, setMorningNotes] = useState('');
  const [dailyEmotion, setDailyEmotion] = useState('Calm');
  const [disciplineRating, setDisciplineRating] = useState<number>(8);
  const [dailyReflection, setDailyReflection] = useState('');
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [newChecklistLabel, setNewChecklistLabel] = useState('');
  const [journalSaveState, setJournalSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [journalError, setJournalError] = useState<string | null>(null);

  useEffect(() => {
    if (currentJournal) {
      setPlannedActivities(currentJournal.plannedActivities);
      setMorningNotes(currentJournal.morningNotes);
      setDailyEmotion(currentJournal.dailyEmotionalState || 'Calm');
      setDisciplineRating(currentJournal.disciplineRating || 8);
      setDailyReflection(currentJournal.dailyReflection);
      setChecklistItems(currentJournal.checklistItems);
    } else {
      setPlannedActivities('');
      setMorningNotes('');
      setDailyEmotion('Calm');
      setDisciplineRating(8);
      setDailyReflection('');
      setChecklistItems(
        defaultDailyItems.map((label, idx) => ({
          id: `chk_${idx}_${label.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
          label,
          completed: false,
        }))
      );
    }
    setJournalSaveState('idle');
    setJournalError(null);
  }, [selectedDate, currentJournal?.updatedAt]);

  const persistDailyJournal = async (overrideItems?: ChecklistItem[]) => {
    if (!uid) return;
    setJournalSaveState('saving');
    setJournalError(null);
    try {
      await upsertDailyJournal(uid, selectedDate, {
        date: selectedDate,
        timezone,
        plannedActivities: plannedActivities.trim(),
        morningNotes: morningNotes.trim(),
        dailyEmotionalState: dailyEmotion,
        disciplineRating: Number(disciplineRating) || 0,
        dailyReflection: dailyReflection.trim(),
        checklistItems: overrideItems ?? checklistItems,
      });
      setJournalSaveState('saved');
      refreshDiagnostics();
    } catch (err) {
      setJournalSaveState('error');
      const diag = err as AppErrorDiagnostic;
      setJournalError(diag?.userMessage ?? 'Failed to save Daily Journal.');
      refreshDiagnostics();
    }
  };

  const handleToggleDailyChecklist = async (itemId: string) => {
    const next = checklistItems.map((c) => (c.id === itemId ? { ...c, completed: !c.completed } : c));
    setChecklistItems(next);
    await persistDailyJournal(next);
  };

  const handleAddDailyChecklistItem = async () => {
    const label = newChecklistLabel.trim();
    if (!label) return;
    const next = [
      ...checklistItems,
      { id: generateRecordId('chk'), label, completed: false },
    ];
    setChecklistItems(next);
    setNewChecklistLabel('');
    await persistDailyJournal(next);
  };

  // --- Daily Activity Summary ---
  const daySessions = useMemo(
    () => sessions.filter((s) => s.date === selectedDate),
    [sessions, selectedDate]
  );
  const dayTrades = useMemo(
    () => trades.filter((t) => isActiveTrade(t) && t.date === selectedDate),
    [trades, selectedDate]
  );
  const dayClosed = useMemo(
    () => dayTrades.filter((t) => t.status === 'closed'),
    [dayTrades]
  );
  const dayWins = dayClosed.filter((t) => t.exitOutcome === 'win').length;
  const dayLosses = dayClosed.filter((t) => t.exitOutcome === 'loss').length;
  const dayBreakeven = dayClosed.filter((t) => t.exitOutcome === 'breakeven').length;
  const dayNetPercent = dayClosed.reduce((acc, t) => acc + (t.actualProfitPercent ?? 0), 0);
  const dayLedgerSummary = useMemo(
    () => summarizeTradesForLedger(dayTrades, accounts, preferredCurrency),
    [dayTrades, accounts, preferredCurrency]
  );

  // --- Context Selector: SESSION LOGGER | TRADE LOGGER ---
  const [loggerContext, setLoggerContext] = useState<'session' | 'trade'>('session');

  // --- Session Logger State ---
  const detectedTemplate = useMemo(
    () => detectCurrentSessionTemplate(sessionTemplates, timezone),
    [sessionTemplates, timezone]
  );
  const [selectedTemplateMode, setSelectedTemplateMode] = useState<string>('auto');
  const [customSessionName, setCustomSessionName] = useState('');
  const [customStartTime, setCustomStartTime] = useState('09:00');
  const [customEndTime, setCustomEndTime] = useState('12:00');
  const [customSessionNotes, setCustomSessionNotes] = useState('');

  const [sittingLocation, setSittingLocation] = useState<SittingLocation>('trading_desk');
  const [sittingLocationCustom, setSittingLocationCustom] = useState('');
  const [preSessionEmotion, setPreSessionEmotion] = useState<string>('Calm');
  const [preSessionEmotionNote, setPreSessionEmotionNote] = useState('');
  const [sessionBias, setSessionBias] = useState<SessionBias>('neutral');
  const [sessionBiasCustom, setSessionBiasCustom] = useState('');
  const [keyLevels, setKeyLevels] = useState('');
  const [marketExpectations, setMarketExpectations] = useState('');
  const [preparationNotes, setPreparationNotes] = useState('');

  const defaultSessionItems = useMemo(() => {
    const cfg = checklists.find((c) => c.scope === 'session');
    return cfg?.items ?? DEFAULT_SESSION_CHECKLIST;
  }, [checklists]);

  const [sessionChecklist, setSessionChecklist] = useState<ChecklistItem[]>([]);
  useEffect(() => {
    setSessionChecklist(
      defaultSessionItems.map((label, idx) => ({
        id: `schk_${idx}`,
        label,
        completed: false,
      }))
    );
  }, [defaultSessionItems.join('|')]);

  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionEventBusy, setSessionEventBusy] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionCustomEventText, setSessionCustomEventText] = useState('');

  // Quick Session Events customization state
  const [managingQuickEvents, setManagingQuickEvents] = useState(false);
  const [quickEventSaving, setQuickEventSaving] = useState(false);
  const [quickEventFeedback, setQuickEventFeedback] = useState<string | null>(null);
  const [newQuickEventLabel, setNewQuickEventLabel] = useState('');
  const [editingQuickEventIndex, setEditingQuickEventIndex] = useState<number | null>(null);
  const [editingQuickEventValue, setEditingQuickEventValue] = useState('');

  const configuredQuickEvents = useMemo(() => {
    const source = Array.isArray(preferences?.quickSessionEvents)
      ? preferences.quickSessionEvents
      : DEFAULT_VISIBLE_QUICK_SESSION_EVENTS;
    return source
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0 && item !== 'custom_observation');
  }, [preferences?.quickSessionEvents]);

  // End Session Modal
  const [endSessionModalOpen, setEndSessionModalOpen] = useState(false);
  const [setupAvailability, setSetupAvailability] = useState<SetupAvailability>('available');
  const [planAdherence, setPlanAdherence] = useState<PlanAdherence>('yes');
  const [postSessionEmotion, setPostSessionEmotion] = useState<string>('Calm & Focused');
  const [closingReflection, setClosingReflection] = useState('');
  const [endingSessionBusy, setEndingSessionBusy] = useState(false);
  const [sessionCompletedNotice, setSessionCompletedNotice] = useState<string | null>(null);

  const resolvedSessionTemplate = useMemo(() => {
    if (selectedTemplateMode === 'custom') return null;
    if (selectedTemplateMode === 'auto') return detectedTemplate ?? sessionTemplates[0] ?? null;
    return sessionTemplates.find((t) => t.id === selectedTemplateMode) ?? null;
  }, [selectedTemplateMode, detectedTemplate, sessionTemplates]);

  const resolvedSessionName =
    selectedTemplateMode === 'custom'
      ? customSessionName.trim()
      : resolvedSessionTemplate?.name ?? 'Custom Session';

  const handleStartSession = async () => {
    if (!uid || sessionBusy || liveSession) return;
    setSessionError(null);
    setSessionCompletedNotice(null);

    const maxPerDay = preferences?.maxSessionsPerDay ?? 4;
    if (daySessions.length >= maxPerDay) {
      setSessionError(`Maximum sessions per day (${maxPerDay}) reached for ${selectedDate}.`);
      return;
    }

    const check = validatePreSessionCheckIn({
      sessionName: resolvedSessionName,
      sittingLocation,
      sittingLocationCustom,
      preSessionEmotion,
      sessionBias,
      sessionBiasCustom,
    });
    if (!check.valid) {
      setSessionError(check.errors.join(' '));
      return;
    }

    const sessionId = generateRecordId('ses');
    const nowIso = new Date().toISOString();
    setSessionBusy(true);
    try {
      await startSessionAtomically(
        uid,
        {
          date: selectedDate,
          timezone,
          templateId: resolvedSessionTemplate?.id,
          sessionName: resolvedSessionName,
          scheduledStart:
            selectedTemplateMode === 'custom' ? customStartTime : resolvedSessionTemplate?.startTime,
          scheduledEnd:
            selectedTemplateMode === 'custom' ? customEndTime : resolvedSessionTemplate?.endTime,
          status: 'live',
          attendance: 'attended',
          sittingLocation,
          sittingLocationCustom:
            sittingLocation === 'other' ? sittingLocationCustom.trim() : undefined,
          preSessionEmotion,
          preSessionEmotionNote: preSessionEmotionNote.trim() || undefined,
          sessionBias,
          sessionBiasCustom: sessionBias === 'custom' ? sessionBiasCustom.trim() : undefined,
          keyLevels: keyLevels.trim() || undefined,
          marketExpectations: marketExpectations.trim() || undefined,
          preparationNotes:
            (selectedTemplateMode === 'custom' ? customSessionNotes : preparationNotes).trim() ||
            undefined,
          checklistItems: sessionChecklist,
          actualStartTime: nowIso,
          setupAvailability: 'pending',
          planAdherence: 'pending',
        },
        sessionId
      );
      refreshDiagnostics();
    } catch (err) {
      const diag = err as AppErrorDiagnostic;
      setSessionError(diag?.userMessage ?? 'Failed to start session.');
      refreshDiagnostics();
    } finally {
      setSessionBusy(false);
    }
  };

  const handleRecordSessionEvent = async (
    eventType: SessionEventType,
    customDesc?: string,
    clearCustomInput = true
  ) => {
    if (!uid || !liveSession || sessionEventBusy) return;
    setSessionError(null);
    setSessionEventBusy(true);
    const description = customDesc?.trim() || SESSION_EVENT_LABELS[eventType];
    try {
      await createRecord(
        uid,
        'session_events',
        generateRecordId('se'),
        {
          sessionId: liveSession.id,
          date: liveSession.date,
          eventType,
          description,
          timestamp: new Date().toISOString(),
        },
        'SessionLogger'
      );
      if (eventType === 'custom_observation' && clearCustomInput) {
        setSessionCustomEventText('');
      }
      refreshDiagnostics();
    } catch (err) {
      const diag = err as AppErrorDiagnostic;
      setSessionError(diag?.userMessage ?? 'Failed to record session event.');
      refreshDiagnostics();
    } finally {
      setSessionEventBusy(false);
    }
  };

  const handleTriggerQuickEvent = (item: string) => {
    if (isBuiltInQuickSessionEventKey(item)) {
      void handleRecordSessionEvent(item, undefined, false);
    } else {
      void handleRecordSessionEvent('custom_observation', item, false);
    }
  };

  const persistQuickSessionEvents = async (nextEvents: string[]): Promise<boolean> => {
    if (!uid || !preferences) {
      setQuickEventFeedback('Workspace preferences are not ready yet.');
      return false;
    }
    const sanitized = nextEvents
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && item.length <= MAX_QUICK_EVENT_LABEL_LEN)
      .slice(0, MAX_QUICK_SESSION_EVENTS);

    setQuickEventSaving(true);
    setQuickEventFeedback(null);
    try {
      await updateRecord(
        uid,
        'preferences',
        preferences.id,
        { quickSessionEvents: sanitized },
        'SessionQuickEvents'
      );
      refreshDiagnostics();
      return true;
    } catch (err) {
      const diag = err as AppErrorDiagnostic;
      setQuickEventFeedback(diag?.userMessage ?? 'Failed to save session quick events.');
      refreshDiagnostics();
      return false;
    } finally {
      setQuickEventSaving(false);
    }
  };

  const handleAddQuickEvent = async () => {
    const trimmed = newQuickEventLabel.trim();
    if (!trimmed) {
      setQuickEventFeedback('Enter a quick event label first.');
      return;
    }
    if (trimmed.length > MAX_QUICK_EVENT_LABEL_LEN) {
      setQuickEventFeedback(`Label must be ${MAX_QUICK_EVENT_LABEL_LEN} characters or fewer.`);
      return;
    }
    if (configuredQuickEvents.length >= MAX_QUICK_SESSION_EVENTS) {
      setQuickEventFeedback(`Maximum of ${MAX_QUICK_SESSION_EVENTS} quick events reached.`);
      return;
    }
    const lower = trimmed.toLowerCase();
    const isDuplicate = configuredQuickEvents.some(
      (item) => getQuickSessionEventLabel(item).toLowerCase() === lower
    );
    if (isDuplicate) {
      setQuickEventFeedback('That session quick event already exists.');
      return;
    }
    const matchedBuiltIn = DEFAULT_VISIBLE_QUICK_SESSION_EVENTS.find(
      (key) => SESSION_EVENT_LABELS[key].toLowerCase() === lower
    );
    const saved = await persistQuickSessionEvents([
      ...configuredQuickEvents,
      matchedBuiltIn ?? trimmed,
    ]);
    if (saved) {
      setNewQuickEventLabel('');
    }
  };

  const handleStartEditQuickEvent = (index: number) => {
    const item = configuredQuickEvents[index];
    if (item === undefined) return;
    setEditingQuickEventIndex(index);
    setEditingQuickEventValue(getQuickSessionEventLabel(item));
    setQuickEventFeedback(null);
  };

  const handleCancelEditQuickEvent = () => {
    setEditingQuickEventIndex(null);
    setEditingQuickEventValue('');
    setQuickEventFeedback(null);
  };

  const handleSaveEditQuickEvent = async (index: number) => {
    const trimmed = editingQuickEventValue.trim();
    if (!trimmed) {
      setQuickEventFeedback('Quick event label cannot be empty.');
      return;
    }
    if (trimmed.length > MAX_QUICK_EVENT_LABEL_LEN) {
      setQuickEventFeedback(`Label must be ${MAX_QUICK_EVENT_LABEL_LEN} characters or fewer.`);
      return;
    }
    const currentItem = configuredQuickEvents[index];
    if (currentItem !== undefined && getQuickSessionEventLabel(currentItem) === trimmed) {
      handleCancelEditQuickEvent();
      return;
    }
    const lower = trimmed.toLowerCase();
    const isDuplicate = configuredQuickEvents.some(
      (item, i) => i !== index && getQuickSessionEventLabel(item).toLowerCase() === lower
    );
    if (isDuplicate) {
      setQuickEventFeedback('Another quick event already uses that label.');
      return;
    }
    const matchedBuiltIn = DEFAULT_VISIBLE_QUICK_SESSION_EVENTS.find(
      (key) => SESSION_EVENT_LABELS[key].toLowerCase() === lower
    );
    const nextList = configuredQuickEvents.map((item, i) =>
      i === index ? matchedBuiltIn ?? trimmed : item
    );
    const saved = await persistQuickSessionEvents(nextList);
    if (saved) {
      setEditingQuickEventIndex(null);
      setEditingQuickEventValue('');
    }
  };

  const handleRemoveQuickEvent = async (index: number) => {
    const nextList = configuredQuickEvents.filter((_, i) => i !== index);
    const saved = await persistQuickSessionEvents(nextList);
    if (saved) {
      if (editingQuickEventIndex === index) {
        setEditingQuickEventIndex(null);
        setEditingQuickEventValue('');
      } else if (editingQuickEventIndex !== null && editingQuickEventIndex > index) {
        setEditingQuickEventIndex(editingQuickEventIndex - 1);
      }
    }
  };

  const handleResetDefaultQuickEvents = async () => {
    const saved = await persistQuickSessionEvents([...DEFAULT_VISIBLE_QUICK_SESSION_EVENTS]);
    if (saved) {
      setEditingQuickEventIndex(null);
      setEditingQuickEventValue('');
      setNewQuickEventLabel('');
    }
  };

  const handleConfirmEndSession = async () => {
    if (!uid || !liveSession || endingSessionBusy) return;
    setEndingSessionBusy(true);
    setSessionError(null);
    const activeCount = openTrades.length;
    const endedName = liveSession.sessionName;
    try {
      await endSessionAtomically(uid, liveSession.id, liveSession.date, {
        actualEndTime: new Date().toISOString(),
        setupAvailability,
        planAdherence,
        postSessionEmotion,
        closingReflection: closingReflection.trim(),
      });
      setEndSessionModalOpen(false);
      setClosingReflection('');
      if (activeCount > 0) {
        setSessionCompletedNotice(
          `Session completed — ${activeCount} ${activeCount === 1 ? 'trade' : 'trades'} still active.`
        );
      } else {
        setSessionCompletedNotice(`${endedName} session completed.`);
      }
      refreshDiagnostics();
    } catch (err) {
      const diag = err as AppErrorDiagnostic;
      setSessionError(diag?.userMessage ?? 'Failed to end session.');
      refreshDiagnostics();
    } finally {
      setEndingSessionBusy(false);
    }
  };

  const liveSessionEvents = useMemo(() => {
    if (!liveSession) return [];
    return sessionEvents
      .filter((e) => e.sessionId === liveSession.id)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [sessionEvents, liveSession?.id]);

  const daySessionEvents = useMemo(() => {
    const daySessionIds = new Set(daySessions.map((s) => s.id));
    return sessionEvents
      .filter((e) => e.date === selectedDate || daySessionIds.has(e.sessionId))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [sessionEvents, daySessions, selectedDate]);

  // --- Live Trade Logger State ---
  const activeAccounts = useMemo(() => accounts.filter((a) => a.isActive), [accounts]);
  const activeInstruments = useMemo(() => instruments.filter((i) => i.isActive), [instruments]);
  const timeframes = preferences?.timeframes ?? ['M15', 'H1', 'H4'];
  const entryTypes = preferences?.entryTypes ?? ['Limit Order', 'Market Execution'];
  const setupLabels = preferences?.setupLabels ?? ['HTF Liquidity Sweep'];

  const [connectBothAccounts, setConnectBothAccounts] = useState<boolean>(true);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  useEffect(() => {
    if (activeAccounts.length === 0) {
      setSelectedAccountIds([]);
      return;
    }
    if (connectBothAccounts) {
      setSelectedAccountIds(activeAccounts.map((a) => a.id));
    } else {
      setSelectedAccountIds((prev) => {
        const valid = prev.filter((id) => activeAccounts.some((a) => a.id === id));
        return valid.length > 0 ? valid : [activeAccounts[0].id];
      });
    }
  }, [activeAccounts, connectBothAccounts]);

  const chosenAccounts = useMemo(
    () => activeAccounts.filter((a) => selectedAccountIds.includes(a.id)),
    [activeAccounts, selectedAccountIds]
  );

  interface AccountRiskEntry {
    riskPercent: number | '';
    expectedProfitPercent: number | '';
    manuallyEditedProfit: boolean;
    syncedDefaultRisk: number;
    manuallyEditedRisk: boolean;
  }

  const [accountRiskMap, setAccountRiskMap] = useState<Record<string, AccountRiskEntry>>({});
  useEffect(() => {
    if (activeAccounts.length === 0) return;
    setAccountRiskMap((prev) => {
      let changed = false;
      const next: Record<string, AccountRiskEntry> = { ...prev };
      for (const acc of activeAccounts) {
        const defRisk = typeof acc.defaultRiskPercent === 'number' ? acc.defaultRiskPercent : 1;
        const existing = next[acc.id];
        if (!existing) {
          next[acc.id] = {
            riskPercent: defRisk,
            expectedProfitPercent: computeDefaultExpectedProfit(defRisk),
            manuallyEditedProfit: false,
            syncedDefaultRisk: defRisk,
            manuallyEditedRisk: false,
          };
          changed = true;
        } else if (existing.syncedDefaultRisk !== defRisk && !existing.manuallyEditedRisk) {
          next[acc.id] = {
            ...existing,
            riskPercent: defRisk,
            expectedProfitPercent: existing.manuallyEditedProfit
              ? existing.expectedProfitPercent
              : computeDefaultExpectedProfit(defRisk),
            syncedDefaultRisk: defRisk,
          };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activeAccounts]);

  const getAccountRiskEntry = (acc: { id: string; defaultRiskPercent: number }): AccountRiskEntry => {
    const existing = accountRiskMap[acc.id];
    if (existing) return existing;
    const defRisk = typeof acc.defaultRiskPercent === 'number' ? acc.defaultRiskPercent : 1;
    return {
      riskPercent: defRisk,
      expectedProfitPercent: computeDefaultExpectedProfit(defRisk),
      manuallyEditedProfit: false,
      syncedDefaultRisk: defRisk,
      manuallyEditedRisk: false,
    };
  };

  const handleAccountRiskChange = (accId: string, defRisk: number, nextRisk: number | '') => {
    setAccountRiskMap((prev) => {
      const current = prev[accId] ?? {
        riskPercent: defRisk,
        expectedProfitPercent: computeDefaultExpectedProfit(defRisk),
        manuallyEditedProfit: false,
        syncedDefaultRisk: defRisk,
        manuallyEditedRisk: false,
      };
      return {
        ...prev,
        [accId]: {
          ...current,
          riskPercent: nextRisk,
          manuallyEditedRisk: true,
          expectedProfitPercent: current.manuallyEditedProfit
            ? current.expectedProfitPercent
            : nextRisk === ''
            ? ''
            : computeDefaultExpectedProfit(nextRisk),
        },
      };
    });
  };

  const handleAccountExpectedProfitChange = (
    accId: string,
    defRisk: number,
    nextProfit: number | ''
  ) => {
    setAccountRiskMap((prev) => {
      const current = prev[accId] ?? {
        riskPercent: defRisk,
        expectedProfitPercent: computeDefaultExpectedProfit(defRisk),
        manuallyEditedProfit: false,
        syncedDefaultRisk: defRisk,
        manuallyEditedRisk: false,
      };
      return {
        ...prev,
        [accId]: {
          ...current,
          expectedProfitPercent: nextProfit,
          manuallyEditedProfit: true,
        },
      };
    });
  };

  const handleResetAccountExpectedProfitAuto = (accId: string, defRisk: number) => {
    setAccountRiskMap((prev) => {
      const current = prev[accId] ?? {
        riskPercent: defRisk,
        expectedProfitPercent: computeDefaultExpectedProfit(defRisk),
        manuallyEditedProfit: false,
        syncedDefaultRisk: defRisk,
        manuallyEditedRisk: false,
      };
      return {
        ...prev,
        [accId]: {
          ...current,
          manuallyEditedProfit: false,
          expectedProfitPercent:
            current.riskPercent === ''
              ? ''
              : computeDefaultExpectedProfit(Number(current.riskPercent)),
        },
      };
    });
  };

  const [instrument, setInstrument] = useState('XAUUSD');
  useEffect(() => {
    if (activeInstruments.length > 0 && !activeInstruments.some((i) => i.symbol === instrument)) {
      setInstrument(activeInstruments[0].symbol);
    }
  }, [activeInstruments.length]);

  const [direction, setDirection] = useState<TradeDirection>('long');
  const [setupLabel, setSetupLabel] = useState(setupLabels[0] ?? '');
  const [entryType, setEntryType] = useState(entryTypes[0] ?? '');
  const [timeframe, setTimeframe] = useState(timeframes[0] ?? 'M15');
  const [entryReasoning, setEntryReasoning] = useState('');
  const [expectedOutcome, setExpectedOutcome] = useState('');
  const [preTradeEmotion, setPreTradeEmotion] = useState<string>('Calm');
  const [confidence, setConfidence] = useState<number>(8);
  const [linkToSession, setLinkToSession] = useState<boolean>(true);
  const [tradeStatusInitial, setTradeStatusInitial] = useState<'before_entry' | 'during_trade'>('during_trade');

  const [tradeError, setTradeError] = useState<string | null>(null);
  const [tradeSubmitting, setTradeSubmitting] = useState(false);
  const [tradeEventBusy, setTradeEventBusy] = useState(false);

  // Anti-bias pause state
  const pauseEnabled = preferences?.antiBiasPauseEnabled ?? true;
  const pauseTotalSeconds = preferences?.antiBiasPauseSeconds ?? 5;
  const [pauseModalOpen, setPauseModalOpen] = useState(false);
  const [pauseRemaining, setPauseRemaining] = useState(pauseTotalSeconds);

  useEffect(() => {
    if (!pauseModalOpen) return;
    if (pauseRemaining <= 0) return;
    const t = window.setTimeout(() => setPauseRemaining((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [pauseModalOpen, pauseRemaining]);

  const groupedOpenTrades = useMemo(() => {
    const groups: Array<{ key: string; primary: TradeType; items: TradeType[] }> = [];
    const seenGroup = new Map<string, number>();
    for (const t of openTrades) {
      if (t.tradeGroupId) {
        const existingIdx = seenGroup.get(t.tradeGroupId);
        if (existingIdx !== undefined) {
          groups[existingIdx].items.push(t);
          continue;
        }
        seenGroup.set(t.tradeGroupId, groups.length);
        groups.push({ key: t.tradeGroupId, primary: t, items: [t] });
      } else {
        groups.push({ key: t.id, primary: t, items: [t] });
      }
    }
    return groups;
  }, [openTrades]);

  const groupedDayTrades = useMemo(() => {
    const groups: Array<{ key: string; primary: TradeType; items: TradeType[] }> = [];
    const seenGroup = new Map<string, number>();
    for (const t of dayTrades) {
      if (t.tradeGroupId) {
        const existingIdx = seenGroup.get(t.tradeGroupId);
        if (existingIdx !== undefined) {
          groups[existingIdx].items.push(t);
          continue;
        }
        seenGroup.set(t.tradeGroupId, groups.length);
        groups.push({ key: t.tradeGroupId, primary: t, items: [t] });
      } else {
        groups.push({ key: t.id, primary: t, items: [t] });
      }
    }
    return groups;
  }, [dayTrades]);

  // Trade Event Logger state per active trade / linked group
  const [activeTradeEventTarget, setActiveTradeEventTarget] = useState<string>('');
  useEffect(() => {
    if (groupedOpenTrades.length > 0 && !openTrades.some((t) => t.id === activeTradeEventTarget)) {
      setActiveTradeEventTarget(groupedOpenTrades[0].primary.id);
    }
  }, [groupedOpenTrades, activeTradeEventTarget, openTrades]);

  const [customTradeEventText, setCustomTradeEventText] = useState('');
  const [partialClosePercent, setPartialClosePercent] = useState<number | ''>(50);
  const [tradeEventEmotion, setTradeEventEmotion] = useState<string>('Calm');

  // Quick Trade Events customization state
  const [managingTradeQuickEvents, setManagingTradeQuickEvents] = useState(false);
  const [tradeQuickEventSaving, setTradeQuickEventSaving] = useState(false);
  const [tradeQuickEventFeedback, setTradeQuickEventFeedback] = useState<string | null>(null);
  const [newTradeQuickEventLabel, setNewTradeQuickEventLabel] = useState('');
  const [editingTradeQuickEventIndex, setEditingTradeQuickEventIndex] = useState<number | null>(null);
  const [editingTradeQuickEventValue, setEditingTradeQuickEventValue] = useState('');

  const configuredTradeQuickEvents = useMemo(() => {
    const source = Array.isArray(preferences?.quickTradeEvents)
      ? preferences.quickTradeEvents
      : DEFAULT_QUICK_TRADE_EVENTS;
    return source
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0 && item !== 'trade_opened' && item !== 'trade_closed');
  }, [preferences?.quickTradeEvents]);

  // Trade Closure Modal state
  const [closingTrade, setClosingTrade] = useState<TradeType | null>(null);

  const handleToggleBothAccounts = () => {
    if (connectBothAccounts) {
      if (activeAccounts.length > 1) {
        setConnectBothAccounts(false);
        setSelectedAccountIds([activeAccounts[0].id]);
      }
    } else {
      setConnectBothAccounts(true);
      setSelectedAccountIds(activeAccounts.map((a) => a.id));
    }
  };

  const handleSelectSpecificAccount = (accId: string) => {
    if (connectBothAccounts) {
      setConnectBothAccounts(false);
      setSelectedAccountIds([accId]);
      return;
    }
    setSelectedAccountIds((prev) => {
      const next = prev.includes(accId)
        ? prev.length > 1
          ? prev.filter((x) => x !== accId)
          : prev
        : [...prev, accId];
      if (activeAccounts.length > 1 && next.length === activeAccounts.length) {
        setConnectBothAccounts(true);
      }
      return next;
    });
  };

  const commitTradeCreation = async (guardPassedFlag: boolean) => {
    if (!uid || tradeSubmitting) return;
    const isOutOfSession = !linkToSession || !liveSession;
    const chosenAccounts = activeAccounts.filter((a) => selectedAccountIds.includes(a.id));
    if (chosenAccounts.length === 0) {
      setTradeError('Select at least one active trading account.');
      return;
    }

    setTradeSubmitting(true);
    setTradeError(null);
    try {
      const nowIso = new Date().toISOString();
      const baseDayTradeNumber =
        dayTrades.reduce((max, t) => Math.max(max, t.tradeNumberOfDay || 0), 0) + 1;
      const isMulti = chosenAccounts.length > 1;
      const groupId = isMulti ? generateRecordId('tg') : undefined;

      const tradeInputs = chosenAccounts.map((acc, index) => {
        const tradeId = generateRecordId('tr');
        const entry = getAccountRiskEntry(acc);
        return {
          tradeId,
          data: {
            date: selectedDate,
            timezone,
            tradeNumberOfDay: baseDayTradeNumber + index,
            accountId: acc.id,
            accountName: acc.name,
            sessionId: isOutOfSession ? undefined : liveSession?.id,
            sessionName: isOutOfSession ? undefined : liveSession?.sessionName,
            isOutOfSession,
            tradeGroupId: groupId,
            instrument,
            direction,
            setupLabel: setupLabel || undefined,
            entryType: entryType || undefined,
            timeframe: timeframe || undefined,
            status: tradeStatusInitial,
            riskPercent: Number(entry.riskPercent),
            expectedProfitPercent: Number(entry.expectedProfitPercent),
            entryReasoning: entryReasoning.trim() || undefined,
            expectedOutcome: expectedOutcome.trim() || undefined,
            preTradeEmotion,
            confidence,
            guardPassed: guardPassedFlag,
            openedAt: nowIso,
            exitOutcome: 'pending' as const,
            exitReason: 'pending' as const,
            tpStatus: 'pending' as const,
            slStatus: 'pending' as const,
            currency: acc.currency || preferredCurrency,
            followedPlan: 'na' as const,
            followedRiskRules: 'na' as const,
            impulsiveEntry: 'na' as const,
            exitedPerPlan: 'na' as const,
            mistakes: [],
          },
        };
      });

      const tradeGroup =
        isMulti && groupId
          ? {
              id: groupId,
              date: selectedDate,
              instrument,
              direction,
              setupLabel: setupLabel || undefined,
              tradeIds: tradeInputs.map((i) => i.tradeId),
              accountIds: chosenAccounts.map((a) => a.id),
            }
          : undefined;

      await createTradesForAccountsAtomically(uid, tradeInputs, tradeGroup);

      if (guardPassedFlag && liveSession) {
        await createRecord(
          uid,
          'session_events',
          generateRecordId('se'),
          {
            sessionId: liveSession.id,
            date: liveSession.date,
            eventType: 'guard_passed',
            description: `Anti-bias pause completed before ${instrument} ${direction.toUpperCase()}.`,
            timestamp: nowIso,
          },
          'LiveTradeLogger'
        );
      }

      setEntryReasoning('');
      setExpectedOutcome('');
      setActiveTradeEventTarget(tradeInputs[0].tradeId);
      setLoggerContext('trade');
      refreshDiagnostics();
    } catch (err) {
      const diag = err as AppErrorDiagnostic;
      setTradeError(diag?.userMessage ?? 'Failed to create trade.');
      refreshDiagnostics();
    } finally {
      setTradeSubmitting(false);
    }
  };

  const handleRequestCreateTrade = async () => {
    setTradeError(null);
    if (chosenAccounts.length === 0) {
      setTradeError('Select at least one trading account.');
      return;
    }
    const isOutOfSession = !linkToSession || !liveSession;
    const allErrors: string[] = [];
    chosenAccounts.forEach((acc, idx) => {
      const entry = getAccountRiskEntry(acc);
      const check = validateTradeCreation({
        accountId: acc.id,
        instrument,
        direction,
        riskPercent: entry.riskPercent === '' ? -1 : Number(entry.riskPercent),
        expectedProfitPercent:
          entry.expectedProfitPercent === '' ? Number.NaN : Number(entry.expectedProfitPercent),
        preTradeEmotion,
        confidence,
        isOutOfSession,
        sessionId: liveSession?.id,
      });
      if (!check.valid) {
        if (idx === 0) {
          allErrors.push(...check.errors.map((e) => (chosenAccounts.length > 1 ? `${acc.name}: ${e}` : e)));
        } else {
          for (const err of check.errors) {
            if (err.includes('Risk %') || err.includes('Expected Profit %')) {
              allErrors.push(`${acc.name}: ${err}`);
            }
          }
        }
      }
    });

    if (allErrors.length > 0) {
      setTradeError(allErrors.join(' '));
      return;
    }

    if (pauseEnabled) {
      setPauseRemaining(pauseTotalSeconds);
      setPauseModalOpen(true);
    } else {
      await commitTradeCreation(false);
    }
  };

  const handleCancelAntiBiasPause = async () => {
    setPauseModalOpen(false);
    if (!uid) return;
    if (liveSession) {
      const nowIso = new Date().toISOString();
      try {
        await createRecord(
          uid,
          'session_events',
          generateRecordId('se'),
          {
            sessionId: liveSession.id,
            date: liveSession.date,
            eventType: 'guard_cancelled',
            description: `Anti-bias pause cancelled for ${instrument} ${direction.toUpperCase()}.`,
            timestamp: nowIso,
          },
          'AntiBiasPause'
        );
        await createRecord(
          uid,
          'session_events',
          generateRecordId('se'),
          {
            sessionId: liveSession.id,
            date: liveSession.date,
            eventType: 'stepped_back',
            description: `Stepped back from ${instrument} ${direction.toUpperCase()} during anti-bias pause.`,
            timestamp: new Date().toISOString(),
          },
          'AntiBiasPause'
        );
      } catch {
        // Ignore secondary event failure
      }
    }
  };

  const handleRecordTradeEvent = async (
    eventType: TradeEventType,
    customDescription?: string,
    clearCustomInput = false
  ) => {
    if (!uid || !activeTradeEventTarget || tradeEventBusy) return;
    setTradeError(null);
    const desc =
      customDescription !== undefined
        ? customDescription.trim()
        : eventType === 'partial_close'
        ? `Partial close (${partialClosePercent || 0}%)`
        : eventType === 'emotion_event'
        ? `Emotion check: ${tradeEventEmotion}`
        : TRADE_EVENT_LABELS[eventType];

    if (!desc) {
      setTradeError('Enter a custom trade event before logging.');
      return;
    }

    if (desc.length > 1000) {
      setTradeError('Trade event description must be 1000 characters or fewer.');
      return;
    }

    let parsedPartialClose: number | undefined;
    if (eventType === 'partial_close' && partialClosePercent !== '') {
      const num = Number(partialClosePercent);
      if (!Number.isFinite(num) || num < 0 || num > 100) {
        setTradeError('Partial close percentage must be a valid number between 0 and 100.');
        return;
      }
      parsedPartialClose = num;
    }

    setTradeEventBusy(true);
    const targetGroup = groupedOpenTrades.find((g) =>
      g.items.some((t) => t.id === activeTradeEventTarget)
    );
    const targetTrades = targetGroup ? targetGroup.items : [{ id: activeTradeEventTarget }];
    const nowIso = new Date().toISOString();

    try {
      await Promise.all(
        targetTrades.map((t) =>
          createRecord(
            uid,
            'trade_events',
            generateRecordId('te'),
            {
              tradeId: t.id,
              eventType,
              description: desc,
              partialClosePercent: parsedPartialClose,
              emotion: eventType === 'emotion_event' ? tradeEventEmotion : undefined,
              timestamp: nowIso,
            },
            'TradeEventLogger'
          )
        )
      );
      if (clearCustomInput) {
        setCustomTradeEventText('');
      }
      refreshDiagnostics();
    } catch (err) {
      const diag = err as AppErrorDiagnostic;
      setTradeError(diag?.userMessage ?? 'Failed to record trade event.');
      refreshDiagnostics();
    } finally {
      setTradeEventBusy(false);
    }
  };

  const handleLogCustomTradeEvent = () => {
    if (!customTradeEventText.trim()) return;
    void handleRecordTradeEvent('market_observation', customTradeEventText, true);
  };

  const handleTriggerTradeQuickEvent = (item: string) => {
    if (isBuiltInQuickTradeEventKey(item)) {
      void handleRecordTradeEvent(item);
    } else {
      void handleRecordTradeEvent('market_observation', item, false);
    }
  };

  const persistQuickTradeEvents = async (nextEvents: string[]): Promise<boolean> => {
    if (!uid || !preferences) {
      setTradeQuickEventFeedback('Workspace preferences are not ready yet.');
      return false;
    }
    const sanitized = nextEvents
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && item.length <= MAX_QUICK_EVENT_LABEL_LEN)
      .slice(0, MAX_QUICK_TRADE_EVENTS);

    setTradeQuickEventSaving(true);
    setTradeQuickEventFeedback(null);
    try {
      await updateRecord(
        uid,
        'preferences',
        preferences.id,
        { quickTradeEvents: sanitized },
        'TradeQuickEvents'
      );
      refreshDiagnostics();
      return true;
    } catch (err) {
      const diag = err as AppErrorDiagnostic;
      setTradeQuickEventFeedback(diag?.userMessage ?? 'Failed to save trade quick events.');
      refreshDiagnostics();
      return false;
    } finally {
      setTradeQuickEventSaving(false);
    }
  };

  const handleAddTradeQuickEvent = async () => {
    const trimmed = newTradeQuickEventLabel.trim();
    if (!trimmed) {
      setTradeQuickEventFeedback('Enter a button label first.');
      return;
    }
    if (trimmed.length > MAX_QUICK_EVENT_LABEL_LEN) {
      setTradeQuickEventFeedback(`Label must be ${MAX_QUICK_EVENT_LABEL_LEN} characters or fewer.`);
      return;
    }
    if (configuredTradeQuickEvents.length >= MAX_QUICK_TRADE_EVENTS) {
      setTradeQuickEventFeedback(`Maximum of ${MAX_QUICK_TRADE_EVENTS} quick buttons reached.`);
      return;
    }
    const lower = trimmed.toLowerCase();
    const isDuplicate = configuredTradeQuickEvents.some(
      (item) => getQuickTradeEventLabel(item).toLowerCase() === lower
    );
    if (isDuplicate) {
      setTradeQuickEventFeedback('That trade quick button already exists.');
      return;
    }
    const matchedBuiltIn = DEFAULT_QUICK_TRADE_EVENTS.find(
      (key) => TRADE_EVENT_LABELS[key].toLowerCase() === lower
    );
    const saved = await persistQuickTradeEvents([
      ...configuredTradeQuickEvents,
      matchedBuiltIn ?? trimmed,
    ]);
    if (saved) {
      setNewTradeQuickEventLabel('');
    }
  };

  const handleStartEditTradeQuickEvent = (index: number) => {
    const item = configuredTradeQuickEvents[index];
    if (item === undefined) return;
    setEditingTradeQuickEventIndex(index);
    setEditingTradeQuickEventValue(getQuickTradeEventLabel(item));
    setTradeQuickEventFeedback(null);
  };

  const handleCancelEditTradeQuickEvent = () => {
    setEditingTradeQuickEventIndex(null);
    setEditingTradeQuickEventValue('');
    setTradeQuickEventFeedback(null);
  };

  const handleSaveEditTradeQuickEvent = async (index: number) => {
    const trimmed = editingTradeQuickEventValue.trim();
    if (!trimmed) {
      setTradeQuickEventFeedback('Button label cannot be empty.');
      return;
    }
    if (trimmed.length > MAX_QUICK_EVENT_LABEL_LEN) {
      setTradeQuickEventFeedback(`Label must be ${MAX_QUICK_EVENT_LABEL_LEN} characters or fewer.`);
      return;
    }
    const currentItem = configuredTradeQuickEvents[index];
    if (currentItem !== undefined && getQuickTradeEventLabel(currentItem) === trimmed) {
      handleCancelEditTradeQuickEvent();
      return;
    }
    const lower = trimmed.toLowerCase();
    const isDuplicate = configuredTradeQuickEvents.some(
      (item, i) => i !== index && getQuickTradeEventLabel(item).toLowerCase() === lower
    );
    if (isDuplicate) {
      setTradeQuickEventFeedback('Another quick button already uses that label.');
      return;
    }
    const matchedBuiltIn = DEFAULT_QUICK_TRADE_EVENTS.find(
      (key) => TRADE_EVENT_LABELS[key].toLowerCase() === lower
    );
    const nextList = configuredTradeQuickEvents.map((item, i) =>
      i === index ? matchedBuiltIn ?? trimmed : item
    );
    const saved = await persistQuickTradeEvents(nextList);
    if (saved) {
      setEditingTradeQuickEventIndex(null);
      setEditingTradeQuickEventValue('');
    }
  };

  const handleRemoveTradeQuickEvent = async (index: number) => {
    const nextList = configuredTradeQuickEvents.filter((_, i) => i !== index);
    const saved = await persistQuickTradeEvents(nextList);
    if (saved) {
      if (editingTradeQuickEventIndex === index) {
        setEditingTradeQuickEventIndex(null);
        setEditingTradeQuickEventValue('');
      } else if (editingTradeQuickEventIndex !== null && editingTradeQuickEventIndex > index) {
        setEditingTradeQuickEventIndex(editingTradeQuickEventIndex - 1);
      }
    }
  };

  const handleResetDefaultTradeQuickEvents = async () => {
    const saved = await persistQuickTradeEvents([...DEFAULT_QUICK_TRADE_EVENTS]);
    if (saved) {
      setEditingTradeQuickEventIndex(null);
      setEditingTradeQuickEventValue('');
      setNewTradeQuickEventLabel('');
    }
  };

  const selectedTradeEvents = useMemo(() => {
    if (!activeTradeEventTarget) return [];
    return tradeEvents
      .filter((e) => e.tradeId === activeTradeEventTarget)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [tradeEvents, activeTradeEventTarget]);

  return (
    <div className="space-y-6">
      {/* Daily Header */}
      <section className="p-5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
              Daily Journal
            </h1>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 font-mono-num">
              {formatDisplayDate(selectedDate)} · {timezone}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SecondaryButton
              size="sm"
              type="button"
              onClick={() => setSelectedDate(shiftDateStr(selectedDate, -1))}
              aria-label="Previous date"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Prev
            </SecondaryButton>
            <div className="w-40">
              <DatePicker value={selectedDate} onChange={setSelectedDate} />
            </div>
            <SecondaryButton size="sm" type="button" onClick={() => setSelectedDate(today)}>
              Today
            </SecondaryButton>
            <SecondaryButton
              size="sm"
              type="button"
              onClick={() => setSelectedDate(shiftDateStr(selectedDate, 1))}
              aria-label="Next date"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </SecondaryButton>
          </div>
        </div>

        {/* Daily Activity Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 pt-2 border-t border-[var(--border)]">
          <MetricDisplay label="Sessions" value={String(daySessions.length)} />
          <MetricDisplay label="Trades" value={String(dayTrades.length)} />
          <MetricDisplay label="Wins" value={String(dayWins)} tone={dayWins > 0 ? 'positive' : 'default'} />
          <MetricDisplay label="Losses" value={String(dayLosses)} tone={dayLosses > 0 ? 'negative' : 'default'} />
          <MetricDisplay label="Breakeven" value={String(dayBreakeven)} />
          <MetricDisplay
            label="Net Profit %"
            value={`${dayNetPercent >= 0 ? '+' : ''}${dayNetPercent.toFixed(2)}%`}
            tone={dayNetPercent > 0 ? 'positive' : dayNetPercent < 0 ? 'negative' : 'default'}
          />
          <MetricDisplay
            label="Monetary P&L"
            value={
              dayLedgerSummary.monetaryByCurrency.length === 0
                ? '—'
                : dayLedgerSummary.monetaryByCurrency
                    .map(
                      (c) =>
                        `${c.netPnl >= 0 ? '+' : ''}${c.netPnl.toFixed(2)} ${c.currency}`
                    )
                    .join(' · ')
            }
          />
        </div>
      </section>

      {/* SECTION 1: DAILY PREPARATION */}
      <section className="p-5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">1. Daily Preparation</h2>
            <p className="text-xs text-[var(--text-muted)]">
              Day-level routine, checklist, and reflection ({selectedDate})
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            {journalSaveState === 'saved' && (
              <span className="text-xs text-[var(--positive)] font-medium">Saved</span>
            )}
            <PrimaryButton
              size="sm"
              type="button"
              disabled={journalSaveState === 'saving'}
              onClick={() => persistDailyJournal()}
            >
              {journalSaveState === 'saving' ? 'Saving...' : 'Save Daily Preparation'}
            </PrimaryButton>
          </div>
        </div>

        {journalError && <ErrorBanner title="Daily Journal Save Failed" message={journalError} />}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left 2 cols: fields */}
          <div className="lg:col-span-2 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SelectInput
                label="Daily Emotional State"
                value={dailyEmotion}
                onChange={setDailyEmotion}
                options={PRE_SESSION_EMOTIONS.map((e) => ({ value: e, label: e }))}
              />
              <RangeSlider
                label="Discipline Rating"
                min={1}
                max={10}
                step={1}
                value={disciplineRating}
                onChange={setDisciplineRating}
                valueLabel={`${disciplineRating}/10`}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextArea
                label="Planned Activities"
                value={plannedActivities}
                onChange={(e) => setPlannedActivities(e.target.value)}
                placeholder="Key macro events, focus pairs, non-trading commitments..."
                rows={3}
              />
              <TextArea
                label="Morning Notes"
                value={morningNotes}
                onChange={(e) => setMorningNotes(e.target.value)}
                placeholder="Mental clarity, sleep quality, market structure observations..."
                rows={3}
              />
            </div>

            <TextArea
              label="Daily Reflection"
              value={dailyReflection}
              onChange={(e) => setDailyReflection(e.target.value)}
              placeholder="End-of-day review across all sessions and decisions..."
              rows={2}
            />
          </div>

          {/* Right col: Daily Checklist */}
          <div className="space-y-3 border-t lg:border-t-0 lg:border-l border-[var(--border)] pt-4 lg:pt-0 lg:pl-5">
            <div className="text-xs font-semibold text-[var(--text-primary)]">Daily Checklist</div>
            <div className="space-y-2">
              {checklistItems.map((item) => (
                <label
                  key={item.id}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--subtle-surface)] text-xs cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={item.completed}
                    onChange={() => void handleToggleDailyChecklist(item.id)}
                    className="accent-[var(--positive)]"
                  />
                  <span
                    className={
                      item.completed
                        ? 'line-through text-[var(--text-muted)]'
                        : 'text-[var(--text-primary)]'
                    }
                  >
                    {item.label}
                  </span>
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <TextInput
                value={newChecklistLabel}
                onChange={(e) => setNewChecklistLabel(e.target.value)}
                placeholder="Custom daily item..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleAddDailyChecklistItem();
                  }
                }}
              />
              <SecondaryButton size="sm" type="button" onClick={() => void handleAddDailyChecklistItem()}>
                <Plus className="w-3.5 h-3.5" />
                Add
              </SecondaryButton>
            </div>
          </div>
        </div>
      </section>

      {/* CONTEXT SELECTOR BAR */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)]">
        <div className="text-xs text-[var(--text-secondary)]">
          Quick-Event Context Selector (events remain strictly separated between Session &amp; Trade logs)
        </div>
        <SegmentedControl
          value={loggerContext}
          onChange={setLoggerContext}
          options={[
            { value: 'session', label: 'SESSION LOGGER' },
            { value: 'trade', label: 'TRADE LOGGER' },
          ]}
        />
      </div>

      {/* SECTION 2: SESSION LOGGER (UPPER PANEL — LOGGER LEFT, RECORDER RIGHT) */}
      <section className="p-5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              2. Session Logger
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              {liveSession
                ? `Live Session: ${liveSession.sessionName} · Started ${formatTimestampInTimezone(
                    liveSession.actualStartTime,
                    timezone
                  )}`
                : detectedTemplate
                ? `Auto-detected window: ${detectedTemplate.name} (${formatTime12Hour(
                    detectedTemplate.startTime
                  )}–${formatTime12Hour(detectedTemplate.endTime)} ${timezone})`
                : 'Outside scheduled session windows — select a template or Custom Session'}
            </p>
          </div>
          {liveSession ? (
            <div className="flex items-center gap-3">
              <span className="font-mono-num text-sm font-semibold text-[var(--positive)]">
                {formatTimerHMS(liveSession.actualStartTime, nowMs)}
              </span>
              <PrimaryButton
                size="sm"
                type="button"
                onClick={() => setEndSessionModalOpen(true)}
              >
                End Session
              </PrimaryButton>
            </div>
          ) : (
            <SecondaryButton
              size="sm"
              type="button"
              onClick={() => {
                setManagingQuickEvents((prev) => !prev);
                setQuickEventFeedback(null);
                setEditingQuickEventIndex(null);
              }}
            >
              <Pencil className="w-3.5 h-3.5" />
              {managingQuickEvents ? 'Done Editing Quick-Events' : 'Manage Quick-Events'}
            </SecondaryButton>
          )}
        </div>

        {sessionError && <ErrorBanner title="Session Logger Error" message={sessionError} />}

        {sessionCompletedNotice && (
          <div className="px-4 py-2.5 rounded-lg border border-[var(--info)]/40 bg-[var(--info-bg)] text-xs text-[var(--text-primary)]">
            {sessionCompletedNotice}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* LEFT SIDE: SESSION LOGGER */}
          <div className="lg:col-span-7 space-y-4">
            {!liveSession ? (
              /* Pre-Session Check-In & Start */
              <div className="space-y-4">
                {managingQuickEvents && (
                  <div className="p-3.5 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)] space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-[var(--text-primary)]">
                          Session Quick-Events ({configuredQuickEvents.length}/{MAX_QUICK_SESSION_EVENTS})
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)]">
                          Add, edit, or remove quick-event buttons shown during live sessions.
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <SecondaryButton
                          size="sm"
                          type="button"
                          disabled={quickEventSaving}
                          onClick={() => void handleResetDefaultQuickEvents()}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Reset Defaults
                        </SecondaryButton>
                        <SecondaryButton
                          size="sm"
                          type="button"
                          onClick={() => {
                            setManagingQuickEvents(false);
                            handleCancelEditQuickEvent();
                          }}
                        >
                          Done
                        </SecondaryButton>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <TextInput
                        value={newQuickEventLabel}
                        onChange={(e) => {
                          setNewQuickEventLabel(e.target.value);
                          if (quickEventFeedback) setQuickEventFeedback(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void handleAddQuickEvent();
                          }
                        }}
                        maxLength={MAX_QUICK_EVENT_LABEL_LEN}
                        placeholder="Add new quick event (e.g. News Volatility Pause)..."
                      />
                      <PrimaryButton
                        size="sm"
                        type="button"
                        disabled={quickEventSaving || !newQuickEventLabel.trim()}
                        onClick={() => void handleAddQuickEvent()}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add
                      </PrimaryButton>
                    </div>

                    {quickEventFeedback && (
                      <div className="text-xs text-[var(--negative)]">{quickEventFeedback}</div>
                    )}

                    <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                      {configuredQuickEvents.length === 0 ? (
                        <div className="p-2.5 rounded border border-dashed border-[var(--border)] text-xs text-[var(--text-muted)] text-center">
                          No quick events configured. Add one above or reset defaults.
                        </div>
                      ) : (
                        configuredQuickEvents.map((item, idx) => {
                          const isEditing = editingQuickEventIndex === idx;
                          const label = getQuickSessionEventLabel(item);
                          return (
                            <div
                              key={`${item}_${idx}`}
                              className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-[var(--surface)] border border-[var(--border)] text-xs"
                            >
                              {isEditing ? (
                                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                  <input
                                    type="text"
                                    value={editingQuickEventValue}
                                    onChange={(e) => {
                                      setEditingQuickEventValue(e.target.value);
                                      if (quickEventFeedback) setQuickEventFeedback(null);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        void handleSaveEditQuickEvent(idx);
                                      } else if (e.key === 'Escape') {
                                        e.preventDefault();
                                        handleCancelEditQuickEvent();
                                      }
                                    }}
                                    maxLength={MAX_QUICK_EVENT_LABEL_LEN}
                                    autoFocus
                                    className="flex-1 min-w-0 px-2 py-1 rounded bg-[var(--subtle-surface)] border border-[var(--border-strong)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                                  />
                                  <button
                                    type="button"
                                    disabled={quickEventSaving}
                                    onClick={() => void handleSaveEditQuickEvent(idx)}
                                    title="Save quick event"
                                    aria-label="Save quick event"
                                    className="p-1 rounded text-[var(--positive)] hover:bg-[var(--subtle-surface)] disabled:opacity-50"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={quickEventSaving}
                                    onClick={handleCancelEditQuickEvent}
                                    title="Cancel edit"
                                    aria-label="Cancel edit"
                                    className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--subtle-surface)] disabled:opacity-50"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <span className="truncate text-[var(--text-primary)] font-medium">
                                    {label}
                                  </span>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      type="button"
                                      disabled={quickEventSaving}
                                      onClick={() => handleStartEditQuickEvent(idx)}
                                      title="Edit quick event"
                                      aria-label={`Edit ${label}`}
                                      className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--subtle-surface)] disabled:opacity-50"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={quickEventSaving}
                                      onClick={() => void handleRemoveQuickEvent(idx)}
                                      title="Remove quick event"
                                      aria-label={`Remove ${label}`}
                                      className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--negative)] hover:bg-[var(--subtle-surface)] disabled:opacity-50"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <SelectInput
                    label="Session Window"
                    value={selectedTemplateMode}
                    onChange={setSelectedTemplateMode}
                    options={[
                      {
                        value: 'auto',
                        label: detectedTemplate
                          ? `Auto (${detectedTemplate.name} ${formatTime12Hour(
                              detectedTemplate.startTime
                            )}–${formatTime12Hour(detectedTemplate.endTime)})`
                          : 'Auto (Default)',
                      },
                      ...sessionTemplates.map((t) => ({
                        value: t.id,
                        label: `${t.name} (${formatTime12Hour(t.startTime)}–${formatTime12Hour(t.endTime)})`,
                      })),
                      { value: 'custom', label: 'Custom Session' },
                    ]}
                  />
                  <SelectInput
                    label="Sitting Location"
                    required
                    value={sittingLocation}
                    onChange={(v) => setSittingLocation(v as SittingLocation)}
                    options={(Object.keys(SITTING_LOCATION_LABELS) as SittingLocation[]).map((k) => ({
                      value: k,
                      label: SITTING_LOCATION_LABELS[k],
                    }))}
                  />
                  <SelectInput
                    label="Pre-Session Emotion"
                    required
                    value={preSessionEmotion}
                    onChange={setPreSessionEmotion}
                    options={PRE_SESSION_EMOTIONS.map((e) => ({ value: e, label: e }))}
                  />
                  <SelectInput
                    label="Session Bias"
                    required
                    value={sessionBias}
                    onChange={(v) => setSessionBias(v as SessionBias)}
                    options={(Object.keys(SESSION_BIAS_LABELS) as SessionBias[]).map((k) => ({
                      value: k,
                      label: SESSION_BIAS_LABELS[k],
                    }))}
                  />
                </div>

                {selectedTemplateMode === 'custom' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <TextInput
                      label="Custom Session Name"
                      required
                      value={customSessionName}
                      onChange={(e) => setCustomSessionName(e.target.value)}
                      placeholder="e.g. Pre-NY Overlap"
                    />
                    <TextInput
                      label="Optional Custom Notes"
                      value={customSessionNotes}
                      onChange={(e) => setCustomSessionNotes(e.target.value)}
                    />
                    <TimeInput12Hour
                      label="Start Time"
                      value={customStartTime}
                      onChange={setCustomStartTime}
                    />
                    <TimeInput12Hour
                      label="End Time"
                      value={customEndTime}
                      onChange={setCustomEndTime}
                    />
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {sittingLocation === 'other' && (
                    <TextInput
                      label="Describe Sitting Location"
                      required
                      value={sittingLocationCustom}
                      onChange={(e) => setSittingLocationCustom(e.target.value)}
                      placeholder="e.g. Hotel Desk"
                    />
                  )}
                  {sessionBias === 'custom' && (
                    <TextInput
                      label="Custom Session Bias"
                      required
                      value={sessionBiasCustom}
                      onChange={(e) => setSessionBiasCustom(e.target.value)}
                      placeholder="Describe bias..."
                    />
                  )}
                  <TextInput
                    label="Emotion Note (Optional)"
                    value={preSessionEmotionNote}
                    onChange={(e) => setPreSessionEmotionNote(e.target.value)}
                    placeholder="Any physical or mental context..."
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <TextArea
                    label="Key Levels"
                    value={keyLevels}
                    onChange={(e) => setKeyLevels(e.target.value)}
                    rows={2}
                    placeholder="PDH, PDL, Asia High/Low..."
                  />
                  <TextArea
                    label="Market Expectations"
                    value={marketExpectations}
                    onChange={(e) => setMarketExpectations(e.target.value)}
                    rows={2}
                    placeholder="Expected expansion or range..."
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                  <TextArea
                    label="Other Preparation Observations"
                    value={preparationNotes}
                    onChange={(e) => setPreparationNotes(e.target.value)}
                    rows={3}
                  />
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-[var(--text-secondary)]">
                      Session Checklist
                    </div>
                    <div className="grid grid-cols-1 gap-1.5">
                      {sessionChecklist.map((item) => (
                        <label
                          key={item.id}
                          className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={item.completed}
                            onChange={() =>
                              setSessionChecklist((prev) =>
                                prev.map((x) =>
                                  x.id === item.id ? { ...x, completed: !x.completed } : x
                                )
                              )
                            }
                            className="accent-[var(--positive)]"
                          />
                          <span className="truncate">{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-2 border-t border-[var(--border)]">
                  <PrimaryButton type="button" disabled={sessionBusy} onClick={handleStartSession}>
                    {sessionBusy ? 'Starting Session...' : 'Start Session'}
                  </PrimaryButton>
                </div>
              </div>
            ) : (
              /* Active Live Session Logger */
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)]">
                    <div className="text-[var(--text-muted)]">Bias</div>
                    <div className="font-semibold mt-0.5">
                      {liveSession.sessionBias === 'custom'
                        ? liveSession.sessionBiasCustom
                        : SESSION_BIAS_LABELS[liveSession.sessionBias]}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)]">
                    <div className="text-[var(--text-muted)]">Sitting Location</div>
                    <div className="font-semibold mt-0.5">
                      {liveSession.sittingLocation === 'other'
                        ? liveSession.sittingLocationCustom
                        : SITTING_LOCATION_LABELS[liveSession.sittingLocation]}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)]">
                    <div className="text-[var(--text-muted)]">Pre-Session Emotion</div>
                    <div className="font-semibold mt-0.5">{liveSession.preSessionEmotion}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)]">
                    <div className="text-[var(--text-muted)]">Session Trades</div>
                    <div className="font-mono-num font-semibold mt-0.5">
                      {trades.filter((t) => isActiveTrade(t) && !t.isOutOfSession && t.sessionId === liveSession.id).length}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[var(--text-secondary)]">
                      Session Quick-Events (stored exclusively in session_events)
                    </span>
                    <div className="flex items-center gap-2">
                      {loggerContext !== 'session' && (
                        <span className="text-[11px] text-[var(--text-muted)]">
                          Context set to Trade Logger above
                        </span>
                      )}
                      <SecondaryButton
                        size="sm"
                        type="button"
                        onClick={() => {
                          setManagingQuickEvents((prev) => !prev);
                          setQuickEventFeedback(null);
                          setEditingQuickEventIndex(null);
                        }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        {managingQuickEvents ? 'Done' : 'Edit Events'}
                      </SecondaryButton>
                    </div>
                  </div>

                  {managingQuickEvents ? (
                    <div className="p-3.5 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)] space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-medium text-[var(--text-secondary)]">
                          Customize Quick-Events ({configuredQuickEvents.length}/{MAX_QUICK_SESSION_EVENTS})
                        </span>
                        <SecondaryButton
                          size="sm"
                          type="button"
                          disabled={quickEventSaving}
                          onClick={() => void handleResetDefaultQuickEvents()}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Reset Defaults
                        </SecondaryButton>
                      </div>

                      <div className="flex items-center gap-2">
                        <TextInput
                          value={newQuickEventLabel}
                          onChange={(e) => {
                            setNewQuickEventLabel(e.target.value);
                            if (quickEventFeedback) setQuickEventFeedback(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleAddQuickEvent();
                            }
                          }}
                          maxLength={MAX_QUICK_EVENT_LABEL_LEN}
                          placeholder="Add new quick event (e.g. News Volatility Pause)..."
                        />
                        <PrimaryButton
                          size="sm"
                          type="button"
                          disabled={quickEventSaving || !newQuickEventLabel.trim()}
                          onClick={() => void handleAddQuickEvent()}
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add
                        </PrimaryButton>
                      </div>

                      {quickEventFeedback && (
                        <div className="text-xs text-[var(--negative)]">{quickEventFeedback}</div>
                      )}

                      <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                        {configuredQuickEvents.length === 0 ? (
                          <div className="p-2.5 rounded border border-dashed border-[var(--border)] text-xs text-[var(--text-muted)] text-center">
                            No quick events configured. Add one above or reset defaults.
                          </div>
                        ) : (
                          configuredQuickEvents.map((item, idx) => {
                            const isEditing = editingQuickEventIndex === idx;
                            const label = getQuickSessionEventLabel(item);
                            return (
                              <div
                                key={`${item}_${idx}`}
                                className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-[var(--surface)] border border-[var(--border)] text-xs"
                              >
                                {isEditing ? (
                                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                    <input
                                      type="text"
                                      value={editingQuickEventValue}
                                      onChange={(e) => {
                                        setEditingQuickEventValue(e.target.value);
                                        if (quickEventFeedback) setQuickEventFeedback(null);
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          void handleSaveEditQuickEvent(idx);
                                        } else if (e.key === 'Escape') {
                                          e.preventDefault();
                                          handleCancelEditQuickEvent();
                                        }
                                      }}
                                      maxLength={MAX_QUICK_EVENT_LABEL_LEN}
                                      autoFocus
                                      className="flex-1 min-w-0 px-2 py-1 rounded bg-[var(--subtle-surface)] border border-[var(--border-strong)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                                    />
                                    <button
                                      type="button"
                                      disabled={quickEventSaving}
                                      onClick={() => void handleSaveEditQuickEvent(idx)}
                                      title="Save quick event"
                                      aria-label="Save quick event"
                                      className="p-1 rounded text-[var(--positive)] hover:bg-[var(--subtle-surface)] disabled:opacity-50"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={quickEventSaving}
                                      onClick={handleCancelEditQuickEvent}
                                      title="Cancel edit"
                                      aria-label="Cancel edit"
                                      className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--subtle-surface)] disabled:opacity-50"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <span className="truncate text-[var(--text-primary)] font-medium">
                                      {label}
                                    </span>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        type="button"
                                        disabled={quickEventSaving}
                                        onClick={() => handleStartEditQuickEvent(idx)}
                                        title="Edit quick event"
                                        aria-label={`Edit ${label}`}
                                        className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--subtle-surface)] disabled:opacity-50"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={quickEventSaving}
                                        onClick={() => void handleRemoveQuickEvent(idx)}
                                        title="Remove quick event"
                                        aria-label={`Remove ${label}`}
                                        className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--negative)] hover:bg-[var(--subtle-surface)] disabled:opacity-50"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  ) : configuredQuickEvents.length === 0 ? (
                    <div className="p-3 rounded-lg bg-[var(--subtle-surface)] border border-dashed border-[var(--border)] text-xs text-[var(--text-muted)]">
                      No session quick events configured. Click <span className="font-medium text-[var(--text-primary)]">Edit Events</span> to add your own.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {configuredQuickEvents.map((item, idx) => {
                        const label = getQuickSessionEventLabel(item);
                        return (
                          <SecondaryButton
                            key={`${item}_${idx}`}
                            size="sm"
                            type="button"
                            disabled={sessionEventBusy}
                            onClick={() => handleTriggerQuickEvent(item)}
                            className="justify-start truncate"
                            title={label}
                          >
                            {label}
                          </SecondaryButton>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <TextInput
                      value={sessionCustomEventText}
                      onChange={(e) => setSessionCustomEventText(e.target.value)}
                      placeholder="Custom session observation..."
                    />
                    <SecondaryButton
                      size="sm"
                      type="button"
                      disabled={sessionEventBusy}
                      onClick={() =>
                        void handleRecordSessionEvent('custom_observation', sessionCustomEventText)
                      }
                    >
                      Log Observation
                    </SecondaryButton>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT SIDE: SESSION RECORDER */}
          <div className="lg:col-span-5 lg:border-l lg:border-[var(--border)] lg:pl-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Session Recorder
              </h3>
              <span className="text-xs font-mono-num text-[var(--text-muted)]">
                {liveSession
                  ? `${liveSessionEvents.length} events`
                  : `${daySessions.length} session(s) · ${daySessionEvents.length} events`}
              </span>
            </div>

            {liveSession ? (
              <div className="p-3.5 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)] space-y-3">
                <div className="text-xs font-medium text-[var(--text-secondary)]">
                  Live Session Timeline ({liveSessionEvents.length})
                </div>
                <Timeline
                  timezone={timezone}
                  items={liveSessionEvents.map((e) => ({
                    id: e.id,
                    timestamp: e.timestamp,
                    label: SESSION_EVENT_LABELS[e.eventType] ?? e.eventType,
                    description: e.description,
                  }))}
                />
              </div>
            ) : (
              <div className="space-y-3">
                {daySessions.length > 0 ? (
                  <div className="space-y-2">
                    {daySessions.map((s) => (
                      <div
                        key={s.id}
                        className="p-3 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)] text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-[var(--text-primary)]">
                            {s.sessionName}
                          </span>
                          <span className="font-mono-num text-[11px] text-[var(--text-muted)] uppercase">
                            {s.status}
                          </span>
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)] font-mono-num">
                          {formatTimestampInTimezone(s.actualStartTime, timezone)}
                          {s.actualEndTime
                            ? ` → ${formatTimestampInTimezone(s.actualEndTime, timezone)}`
                            : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)] text-xs text-[var(--text-muted)]">
                    No active session. Start a session on the left to record live session events here.
                  </div>
                )}

                <div className="p-3.5 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)] space-y-2">
                  <div className="text-xs font-medium text-[var(--text-secondary)]">
                    Recorded Events ({daySessionEvents.length})
                  </div>
                  <Timeline
                    timezone={timezone}
                    items={daySessionEvents.map((e) => ({
                      id: e.id,
                      timestamp: e.timestamp,
                      label: SESSION_EVENT_LABELS[e.eventType] ?? e.eventType,
                      description: e.description,
                    }))}
                    emptyLabel="No session events recorded for this date yet."
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* SECTION 3: LIVE TRADE LOGGER (LOWER PANEL — LOGGER LEFT, RECORDER RIGHT) */}
      <section className="p-5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              3. Live Trade Logger
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Percentage-first execution &amp; management. Works in-session or explicitly Out-of-Session.
            </p>
          </div>
          <div className="text-xs font-mono-num text-[var(--text-secondary)]">
            Open trades: <strong>{openTrades.length}</strong>
          </div>
        </div>

        {tradeError && <ErrorBanner title="Trade Logger Error" message={tradeError} />}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* LEFT SIDE: LIVE TRADE LOGGER (ORDER PUNCHING FORM) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Log New Trade</h3>
              <SegmentedControl
                value={linkToSession && liveSession ? 'in_session' : 'out_of_session'}
                onChange={(val) => setLinkToSession(val === 'in_session')}
                options={[
                  {
                    value: 'in_session',
                    label: liveSession ? `Link: ${liveSession.sessionName}` : 'No Live Session',
                  },
                  { value: 'out_of_session', label: 'Out-of-Session' },
                ]}
              />
            </div>

            {/* Connected Accounts Bar (Both Accounts Connected by Default) */}
            <div className="p-3 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)] space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-[var(--text-secondary)]">
                  Trading Account(s) — records on both connected accounts by default
                </span>
                <button
                  type="button"
                  aria-pressed={connectBothAccounts}
                  onClick={handleToggleBothAccounts}
                  className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                    connectBothAccounts
                      ? 'bg-[var(--text-primary)] text-[var(--surface)] border-[var(--text-primary)]'
                      : 'bg-[var(--surface)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--canvas)]'
                  }`}
                >
                  <Link2 className="w-3.5 h-3.5" />
                  {activeAccounts.length <= 1
                    ? 'All Accounts Connected (Default)'
                    : connectBothAccounts
                    ? activeAccounts.length === 2
                      ? 'Both Accounts Connected (Default)'
                      : `All ${activeAccounts.length} Accounts Connected`
                    : activeAccounts.length === 2
                    ? 'Connect Both Accounts'
                    : `Connect All ${activeAccounts.length} Accounts`}
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {activeAccounts.map((acc) => {
                  const selected = selectedAccountIds.includes(acc.id);
                  return (
                    <button
                      key={acc.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => handleSelectSpecificAccount(acc.id)}
                      className={`h-8 px-3 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                        selected
                          ? 'bg-[var(--text-primary)] text-[var(--surface)] border-[var(--text-primary)]'
                          : 'bg-[var(--surface)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--subtle-surface)]'
                      }`}
                    >
                      {acc.name} ({acc.currency})
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Aligned Execution Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
              <SelectInput
                label="Instrument"
                required
                value={instrument}
                onChange={setInstrument}
                options={activeInstruments.map((i) => ({ value: i.symbol, label: i.symbol }))}
              />
              <FieldWrapper label="Direction" required>
                <button
                  type="button"
                  role="switch"
                  aria-checked={direction === 'long'}
                  aria-label={`Direction: ${direction === 'long' ? 'Long' : 'Short'}. Click to switch.`}
                  onClick={() => setDirection((prev) => (prev === 'long' ? 'short' : 'long'))}
                  className={`w-full h-9 px-3 rounded-lg border flex items-center justify-between gap-2 text-sm font-semibold transition-colors cursor-pointer ${
                    direction === 'long'
                      ? 'bg-[var(--positive-bg)] border-[var(--positive)]/50 text-[var(--positive)]'
                      : 'bg-[var(--negative-bg)] border-[var(--negative)]/50 text-[var(--negative)]'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {direction === 'long' ? (
                      <TrendingUp className="w-4 h-4" />
                    ) : (
                      <TrendingDown className="w-4 h-4" />
                    )}
                    <span>{direction === 'long' ? 'LONG' : 'SHORT'}</span>
                  </span>
                  <span
                    className={`w-9 h-5 rounded-full p-0.5 flex items-center transition-colors ${
                      direction === 'long'
                        ? 'bg-[var(--positive)] justify-start'
                        : 'bg-[var(--negative)] justify-end'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full bg-white" />
                  </span>
                </button>
              </FieldWrapper>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <SelectInput
                label="Setup Label"
                value={setupLabel}
                onChange={setSetupLabel}
                options={setupLabels.map((s) => ({ value: s, label: s }))}
              />
              <SelectInput
                label="Entry Type"
                value={entryType}
                onChange={setEntryType}
                options={entryTypes.map((e) => ({ value: e, label: e }))}
              />
              <SelectInput
                label="Timeframe"
                value={timeframe}
                onChange={setTimeframe}
                options={timeframes.map((tf) => ({ value: tf, label: tf }))}
              />
            </div>

            {/* Per-Account Risk Management (Auto-populated from Settings Default Risk %, 3x Expected Profit) */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[var(--text-secondary)]">
                  Risk Management{chosenAccounts.length > 1 ? ' (Per Connected Account)' : ''}
                </span>
                <span className="text-[11px] text-[var(--text-muted)]">
                  Pre-filled from Account Default Risk %
                </span>
              </div>
              {chosenAccounts.map((acc) => {
                const entry = getAccountRiskEntry(acc);
                const defRisk =
                  typeof acc.defaultRiskPercent === 'number' ? acc.defaultRiskPercent : 1;
                return (
                  <div
                    key={acc.id}
                    className="p-3 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)] space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-[var(--text-primary)]">
                        {acc.name} ({acc.currency})
                      </span>
                      <span className="font-mono-num text-[11px] text-[var(--text-muted)]">
                        Default Risk: {defRisk}%
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                      <NumberInput
                        label="Risk %"
                        required
                        value={entry.riskPercent}
                        onChange={(val) => handleAccountRiskChange(acc.id, defRisk, val)}
                        placeholder={String(defRisk)}
                      />
                      <NumberInput
                        label="Expected Profit %"
                        required
                        value={entry.expectedProfitPercent}
                        onChange={(val) => handleAccountExpectedProfitChange(acc.id, defRisk, val)}
                        placeholder={String(computeDefaultExpectedProfit(defRisk))}
                        labelAction={
                          entry.manuallyEditedProfit ? (
                            <button
                              type="button"
                              onClick={() => handleResetAccountExpectedProfitAuto(acc.id, defRisk)}
                              className="text-[11px] font-mono-num text-[var(--info)] hover:underline cursor-pointer"
                            >
                              Reset 3×
                            </button>
                          ) : (
                            <span className="text-[11px] font-mono-num text-[var(--text-muted)]">
                              3× Risk (Auto)
                            </span>
                          )
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
              <SelectInput
                label="Pre-Trade Emotion"
                required
                value={preTradeEmotion}
                onChange={setPreTradeEmotion}
                options={PRE_SESSION_EMOTIONS.map((e) => ({ value: e, label: e }))}
              />
              <RangeSlider
                label="Confidence (1-10)"
                required
                min={1}
                max={10}
                step={1}
                value={confidence}
                onChange={setConfidence}
                valueLabel={`${confidence}/10`}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextArea
                label="Entry Reasoning"
                value={entryReasoning}
                onChange={(e) => setEntryReasoning(e.target.value)}
                rows={2}
                placeholder="Why is this setup valid according to your plan?"
              />
              <TextArea
                label="Expected Outcome"
                value={expectedOutcome}
                onChange={(e) => setExpectedOutcome(e.target.value)}
                rows={2}
                placeholder="Target liquidity, management plan, invalidation..."
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[var(--border)]">
              <SegmentedControl
                value={tradeStatusInitial}
                onChange={setTradeStatusInitial}
                options={[
                  { value: 'before_entry', label: 'Stage: Before Entry' },
                  { value: 'during_trade', label: 'Stage: During Trade' },
                ]}
              />
              <PrimaryButton
                type="button"
                disabled={tradeSubmitting}
                onClick={handleRequestCreateTrade}
              >
                {tradeSubmitting
                  ? 'Logging Trade...'
                  : selectedAccountIds.length > 1
                  ? `Log Trade (${selectedAccountIds.length} Accounts)`
                  : 'Log Trade'}
              </PrimaryButton>
            </div>
          </div>

          {/* RIGHT SIDE: LIVE TRADE RECORDER */}
          <div className="lg:col-span-5 lg:border-l lg:border-[var(--border)] lg:pl-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Trade Recorder
              </h3>
              <span className="text-xs font-mono-num text-[var(--text-muted)]">
                {groupedOpenTrades.length} Active · {groupedDayTrades.length} Today
              </span>
            </div>

            {groupedOpenTrades.length > 0 ? (
              <div className="space-y-4">
                <div className="space-y-2.5">
                  {groupedOpenTrades.map((group) => {
                    const t = group.primary;
                    const isLinked = group.items.length > 1;
                    const numbersLabel = isLinked
                      ? `#${group.items.map((x) => x.tradeNumberOfDay).join(' & #')}`
                      : `#${t.tradeNumberOfDay}`;
                    return (
                      <div
                        key={group.key}
                        className="p-3.5 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)] space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                              <span className="font-mono-num">{numbersLabel}</span>
                              <span>{t.instrument}</span>
                              <span
                                className={
                                  t.direction === 'long'
                                    ? 'text-[var(--positive)]'
                                    : 'text-[var(--negative)]'
                                }
                              >
                                {TRADE_DIRECTION_LABELS[t.direction]}
                              </span>
                              {isLinked && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--positive)]">
                                  <Link2 className="w-3 h-3" />
                                  {group.items.length} Accounts Linked
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                              {group.items.map((x) => x.accountName).join(' + ')} ·{' '}
                              {t.isOutOfSession ? 'Out-of-Session' : t.sessionName ?? 'Session'} ·{' '}
                              {TRADE_STATUS_LABELS[t.status]}
                            </div>
                          </div>
                          <PrimaryButton
                            size="sm"
                            type="button"
                            onClick={() => setClosingTrade(t)}
                          >
                            {isLinked ? 'Close Both' : 'Close Trade'}
                          </PrimaryButton>
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <span className="text-[var(--text-muted)] block">Setup / TF</span>
                            <span className="truncate block">
                              {t.setupLabel || '—'} · {t.timeframe || '—'}
                            </span>
                          </div>
                          <div>
                            <span className="text-[var(--text-muted)] block">Duration</span>
                            <span className="font-mono-num">
                              {formatTimerHMS(t.openedAt, nowMs)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[var(--text-muted)] block">Confidence</span>
                            <span className="font-mono-num">{t.confidence}/10</span>
                          </div>
                        </div>

                        <div className="space-y-1 text-xs pt-1 border-t border-[var(--border)]">
                          {group.items.map((accTrade) => (
                            <div
                              key={accTrade.id}
                              className="flex items-center justify-between gap-2 text-[11px]"
                            >
                              <span className="text-[var(--text-secondary)] truncate">
                                {accTrade.accountName}
                              </span>
                              <span className="font-mono-num text-[var(--text-primary)] shrink-0">
                                Risk {accTrade.riskPercent}% / Target {accTrade.expectedProfitPercent}%
                              </span>
                            </div>
                          ))}
                        </div>

                        <div className="text-[11px] text-[var(--text-secondary)]">
                          Emotion: {t.preTradeEmotion}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Trade Event Recorder */}
                <div className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--subtle-surface)] space-y-3">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[var(--text-primary)]">
                        Trade Event Recorder (trade_events)
                      </span>
                      <SecondaryButton
                        size="sm"
                        type="button"
                        onClick={() => {
                          setManagingTradeQuickEvents((prev) => !prev);
                          setTradeQuickEventFeedback(null);
                          setEditingTradeQuickEventIndex(null);
                        }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        {managingTradeQuickEvents ? 'Done' : 'Edit'}
                      </SecondaryButton>
                    </div>
                    <SelectInput
                      value={activeTradeEventTarget}
                      onChange={setActiveTradeEventTarget}
                      options={groupedOpenTrades.map((group) => ({
                        value: group.primary.id,
                        label:
                          group.items.length > 1
                            ? `#${group.items.map((x) => x.tradeNumberOfDay).join('/#')} ${
                                group.primary.instrument
                              } (${group.items.map((x) => x.accountName).join(' + ')})`
                            : `#${group.primary.tradeNumberOfDay} ${group.primary.instrument} (${group.primary.accountName})`,
                      }))}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <NumberInput
                      label="Partial-Close %"
                      value={partialClosePercent}
                      onChange={setPartialClosePercent}
                    />
                    <SelectInput
                      label="Emotion Selector"
                      value={tradeEventEmotion}
                      onChange={setTradeEventEmotion}
                      options={PRE_SESSION_EMOTIONS.map((e) => ({ value: e, label: e }))}
                    />
                  </div>

                  {managingTradeQuickEvents ? (
                    <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-medium text-[var(--text-secondary)]">
                          Custom Quick Buttons ({configuredTradeQuickEvents.length}/{MAX_QUICK_TRADE_EVENTS})
                        </span>
                        <SecondaryButton
                          size="sm"
                          type="button"
                          disabled={tradeQuickEventSaving}
                          onClick={() => void handleResetDefaultTradeQuickEvents()}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Reset Defaults
                        </SecondaryButton>
                      </div>

                      <div className="flex items-center gap-2">
                        <TextInput
                          value={newTradeQuickEventLabel}
                          onChange={(e) => {
                            setNewTradeQuickEventLabel(e.target.value);
                            if (tradeQuickEventFeedback) setTradeQuickEventFeedback(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleAddTradeQuickEvent();
                            }
                          }}
                          maxLength={MAX_QUICK_EVENT_LABEL_LEN}
                          placeholder="Add new quick button (e.g. Moved SL to BE)..."
                        />
                        <PrimaryButton
                          size="sm"
                          type="button"
                          disabled={tradeQuickEventSaving || !newTradeQuickEventLabel.trim()}
                          onClick={() => void handleAddTradeQuickEvent()}
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add
                        </PrimaryButton>
                      </div>

                      {tradeQuickEventFeedback && (
                        <div className="text-xs text-[var(--negative)]">{tradeQuickEventFeedback}</div>
                      )}

                      <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                        {configuredTradeQuickEvents.length === 0 ? (
                          <div className="p-2.5 rounded border border-dashed border-[var(--border)] text-xs text-[var(--text-muted)] text-center">
                            No quick buttons configured. Add one above or reset defaults.
                          </div>
                        ) : (
                          configuredTradeQuickEvents.map((item, idx) => {
                            const isEditing = editingTradeQuickEventIndex === idx;
                            const label = getQuickTradeEventLabel(item);
                            return (
                              <div
                                key={`${item}_${idx}`}
                                className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-[var(--subtle-surface)] border border-[var(--border)] text-xs"
                              >
                                {isEditing ? (
                                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                    <input
                                      type="text"
                                      value={editingTradeQuickEventValue}
                                      onChange={(e) => {
                                        setEditingTradeQuickEventValue(e.target.value);
                                        if (tradeQuickEventFeedback) setTradeQuickEventFeedback(null);
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          void handleSaveEditTradeQuickEvent(idx);
                                        } else if (e.key === 'Escape') {
                                          e.preventDefault();
                                          handleCancelEditTradeQuickEvent();
                                        }
                                      }}
                                      maxLength={MAX_QUICK_EVENT_LABEL_LEN}
                                      autoFocus
                                      className="flex-1 min-w-0 px-2 py-1 rounded bg-[var(--surface)] border border-[var(--border-strong)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                                    />
                                    <button
                                      type="button"
                                      disabled={tradeQuickEventSaving}
                                      onClick={() => void handleSaveEditTradeQuickEvent(idx)}
                                      title="Save quick button"
                                      aria-label="Save quick button"
                                      className="p-1 rounded text-[var(--positive)] hover:bg-[var(--surface)] disabled:opacity-50"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={tradeQuickEventSaving}
                                      onClick={handleCancelEditTradeQuickEvent}
                                      title="Cancel edit"
                                      aria-label="Cancel edit"
                                      className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)] disabled:opacity-50"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <span className="truncate text-[var(--text-primary)] font-medium">
                                      {label}
                                    </span>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        type="button"
                                        disabled={tradeQuickEventSaving}
                                        onClick={() => handleStartEditTradeQuickEvent(idx)}
                                        title="Edit quick button"
                                        aria-label={`Edit ${label}`}
                                        className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)] disabled:opacity-50"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={tradeQuickEventSaving}
                                        onClick={() => void handleRemoveTradeQuickEvent(idx)}
                                        title="Remove quick button"
                                        aria-label={`Remove ${label}`}
                                        className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--negative)] hover:bg-[var(--surface)] disabled:opacity-50"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  ) : configuredTradeQuickEvents.length === 0 ? (
                    <div className="p-3 rounded-lg bg-[var(--surface)] border border-dashed border-[var(--border)] text-xs text-[var(--text-muted)]">
                      No quick buttons configured. Click <span className="font-medium text-[var(--text-primary)]">Edit</span> to add your custom buttons.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {configuredTradeQuickEvents.map((item, idx) => {
                        const label = getQuickTradeEventLabel(item);
                        return (
                          <SecondaryButton
                            key={`${item}_${idx}`}
                            size="sm"
                            type="button"
                            disabled={tradeEventBusy}
                            onClick={() => handleTriggerTradeQuickEvent(item)}
                            className="justify-start truncate"
                            title={label}
                          >
                            {label}
                          </SecondaryButton>
                        );
                      })}
                    </div>
                  )}

                  <div className="space-y-1.5 pt-1 border-t border-[var(--border)]">
                    <span className="text-xs font-medium text-[var(--text-secondary)] block">
                      Custom Event Entry
                    </span>
                    <div className="flex items-center gap-2">
                      <TextInput
                        value={customTradeEventText}
                        onChange={(e) => setCustomTradeEventText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleLogCustomTradeEvent();
                          }
                        }}
                        maxLength={1000}
                        placeholder="Type a custom trade event and press Enter..."
                      />
                      <SecondaryButton
                        size="sm"
                        type="button"
                        disabled={tradeEventBusy || !customTradeEventText.trim()}
                        onClick={handleLogCustomTradeEvent}
                      >
                        Log Event
                      </SecondaryButton>
                    </div>
                  </div>

                  <Timeline
                    timezone={timezone}
                    items={selectedTradeEvents.map((ev) => ({
                      id: ev.id,
                      timestamp: ev.timestamp,
                      label: TRADE_EVENT_LABELS[ev.eventType] ?? ev.eventType,
                      description: ev.description,
                    }))}
                    emptyLabel="No in-trade management events recorded yet."
                  />
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)] text-xs text-[var(--text-muted)]">
                No active open trades. Punched orders and trade management events record here automatically.
              </div>
            )}

            {groupedDayTrades.length > 0 && (
              <div className="p-3.5 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)] space-y-2">
                <div className="text-xs font-medium text-[var(--text-secondary)]">
                  Recorded Today ({groupedDayTrades.length})
                </div>
                <div className="space-y-1.5">
                  {groupedDayTrades.map((group) => {
                    const t = group.primary;
                    const isLinked = group.items.length > 1;
                    return (
                      <div
                        key={group.key}
                        className="flex items-center justify-between gap-2 text-xs py-1 border-b last:border-b-0 border-[var(--border)]"
                      >
                        <div className="min-w-0 truncate">
                          <span className="font-mono-num text-[var(--text-muted)] mr-1.5">
                            {isLinked
                              ? `#${group.items.map((x) => x.tradeNumberOfDay).join('/')}`
                              : `#${t.tradeNumberOfDay}`}
                          </span>
                          <span className="font-medium text-[var(--text-primary)]">
                            {t.instrument}
                          </span>{' '}
                          <span
                            className={
                              t.direction === 'long'
                                ? 'text-[var(--positive)]'
                                : 'text-[var(--negative)]'
                            }
                          >
                            {t.direction.toUpperCase()}
                          </span>{' '}
                          <span className="text-[var(--text-muted)]">
                            · {group.items.map((x) => x.accountName).join(' + ')}
                          </span>
                        </div>
                        <span className="font-mono-num text-[11px] shrink-0 text-[var(--text-secondary)]">
                          {group.items.every((x) => x.status === 'closed')
                            ? group.items
                                .map(
                                  (x) =>
                                    `${(x.actualProfitPercent ?? 0) >= 0 ? '+' : ''}${
                                      x.actualProfitPercent ?? 0
                                    }%`
                                )
                                .join(' / ')
                            : TRADE_STATUS_LABELS[
                                (group.items.find((x) => x.status !== 'closed') ?? t).status
                              ]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Anti-Bias Pause Modal */}
      <Modal
        open={pauseModalOpen}
        onClose={handleCancelAntiBiasPause}
        title="Anti-Bias Pause"
        subtitle="Verify alignment with your trading plan before committing risk."
        maxWidthClass="max-w-md"
        footer={
          <>
            <SecondaryButton type="button" onClick={handleCancelAntiBiasPause}>
              Step Back (Cancel)
            </SecondaryButton>
            <PrimaryButton
              type="button"
              disabled={pauseRemaining > 0 || tradeSubmitting}
              onClick={async () => {
                setPauseModalOpen(false);
                await commitTradeCreation(true);
              }}
            >
              {pauseRemaining > 0
                ? `Wait ${pauseRemaining}s...`
                : 'Proceed & Log Trade'}
            </PrimaryButton>
          </>
        }
      >
        <div className="space-y-3 text-xs text-[var(--text-secondary)]">
          <p>
            Reviewing <strong className="text-[var(--text-primary)]">{instrument}</strong>{' '}
            {direction.toUpperCase()} · Risk{' '}
            <strong className="font-mono-num text-[var(--text-primary)]">
              {chosenAccounts
                .map((acc) => `${acc.name}: ${getAccountRiskEntry(acc).riskPercent}%`)
                .join(' · ')}
            </strong>{' '}
            · Emotion: <strong className="text-[var(--text-primary)]">{preTradeEmotion}</strong>
          </p>
          <div className="p-4 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)] text-center font-mono-num text-2xl font-semibold text-[var(--text-primary)]">
            {pauseRemaining > 0 ? `${pauseRemaining}s` : 'Ready'}
          </div>
          <p className="text-[var(--text-muted)]">
            Cancelling will record a Stepped Back event without opening any financial trade.
          </p>
        </div>
      </Modal>

      {/* End Session Modal */}
      <Modal
        open={endSessionModalOpen}
        onClose={() => !endingSessionBusy && setEndSessionModalOpen(false)}
        title={`End Session · ${liveSession?.sessionName ?? ''}`}
        subtitle={
          openTrades.length > 0
            ? `${openTrades.length} open trade(s) will remain active and independently closable.`
            : 'Record session outcome and reflection.'
        }
        maxWidthClass="max-w-lg"
        footer={
          <>
            <SecondaryButton
              type="button"
              disabled={endingSessionBusy}
              onClick={() => setEndSessionModalOpen(false)}
            >
              Cancel
            </SecondaryButton>
            <PrimaryButton
              type="button"
              disabled={endingSessionBusy}
              onClick={handleConfirmEndSession}
            >
              {endingSessionBusy ? 'Completing Session...' : 'Complete Session'}
            </PrimaryButton>
          </>
        }
      >
        <div className="space-y-4">
          {openTrades.length > 0 && (
            <div className="p-3 rounded-lg bg-[var(--caution-bg)] border border-[var(--caution)]/40 text-xs text-[var(--text-primary)]">
              Session completed notice: {openTrades.length} trade(s) are still active. Ending this
              session will preserve all trade relationships without closing open trades.
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SelectInput
              label="Setup Availability"
              value={setupAvailability}
              onChange={(v) => setSetupAvailability(v as SetupAvailability)}
              options={[
                { value: 'available', label: 'Available' },
                { value: 'limited', label: 'Limited' },
                { value: 'none', label: 'No Valid Setup' },
              ]}
            />
            <SelectInput
              label="Plan Adherence"
              value={planAdherence}
              onChange={(v) => setPlanAdherence(v as PlanAdherence)}
              options={[
                { value: 'yes', label: 'Yes' },
                { value: 'partial', label: 'Partial' },
                { value: 'no', label: 'No' },
              ]}
            />
          </div>
          <SelectInput
            label="Post-Session Emotion"
            value={postSessionEmotion}
            onChange={setPostSessionEmotion}
            options={POST_TRADE_EMOTIONS.map((e) => ({ value: e, label: e }))}
          />
          <TextArea
            label="Closing Reflection"
            value={closingReflection}
            onChange={(e) => setClosingReflection(e.target.value)}
            rows={3}
            placeholder="How was your execution, patience, and emotional discipline during this session?"
          />
        </div>
      </Modal>

      {/* Trade Closure Modal */}
      <TradeClosureModal
        open={Boolean(closingTrade)}
        trade={closingTrade}
        userId={uid}
        onClose={() => setClosingTrade(null)}
        onSuccess={() => setClosingTrade(null)}
        onDiagnosticRecorded={refreshDiagnostics}
      />
    </div>
  );
}
