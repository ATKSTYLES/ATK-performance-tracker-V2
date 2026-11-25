import React, { useEffect, useMemo, useState } from 'react';
import { Link2, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import { computeRealisedR, isActiveTrade } from '../../domain/calculations';
import {
  ATTACHMENT_CATEGORY_LABELS,
  AttachmentCategory,
  EXIT_OUTCOME_LABELS,
  EXIT_REASON_LABELS,
  ExitOutcome,
  ExitReason,
  POST_TRADE_EMOTIONS,
  PRE_SESSION_EMOTIONS,
  SL_STATUS_LABELS,
  SlStatus,
  TP_STATUS_LABELS,
  TpStatus,
  TRADE_DIRECTION_LABELS,
  TRADE_EVENT_LABELS,
  TRADE_MISTAKES,
  TRADE_STATUS_LABELS,
  TradeDirection,
  TradeStatus,
  YES_NO_NA_LABELS,
  YesNoNa,
} from '../../domain/enums';
import { formatDurationMinutes, formatTimestampInTimezone } from '../../domain/timezone';
import { AttachmentMeta, Trade, TradeEvent } from '../../domain/types';
import { DATE_PATTERN, isValidId, validateCompleteTradeDocument } from '../../domain/validation';
import { useWorkspace } from '../../context/WorkspaceContext';
import {
  deleteAttachmentIfUnreferenced,
  deleteTradeCascade,
  getAttachmentDownloadUrl,
  restoreTrade,
  restoreTradeGroup,
  softDeleteTrade,
  softDeleteTradeGroup,
  updateTradeDetails,
  uploadAttachment,
} from '../../storage/repository';
import {
  DatePicker,
  DestructiveButton,
  FieldWrapper,
  NumberInput,
  PrimaryButton,
  RangeSlider,
  SecondaryButton,
  SegmentedControl,
  SelectInput,
  TextArea,
  TextInput,
} from '../ui/Controls';
import { Timeline } from '../ui/DataDisplay';
import { ConfirmationDialog, Drawer, ErrorBanner } from '../ui/Overlays';

type InspectorTab = 'overview' | 'financial' | 'psychology' | 'timeline' | 'attachments';

interface TradeInspectorDrawerProps {
  trade: Trade | null;
  tradeEvents: TradeEvent[];
  attachments: AttachmentMeta[];
  allAttachments: AttachmentMeta[];
  userId: string;
  timezone: string;
  onClose: () => void;
  onRequestCloseTrade?: (trade: Trade) => void;
  onSelectTrade?: (trade: Trade) => void;
  onTradeSoftDeleted?: (trade: Trade) => void;
}

interface TradeEditDraft {
  date: string;
  tradeNumberOfDay: number | '';
  accountId: string;
  sessionSelection: string; // '__oos__' or sessionId
  instrument: string;
  direction: TradeDirection;
  status: TradeStatus;
  setupLabel: string;
  entryType: string;
  timeframe: string;
  riskPercent: number | '';
  expectedProfitPercent: number | '';
  actualProfitPercent: number | '';
  preTradeEmotion: string;
  confidence: number;
  entryReasoning: string;
  expectedOutcome: string;
  exitOutcome: ExitOutcome;
  exitReason: ExitReason;
  tpStatus: TpStatus;
  slStatus: SlStatus;
  actualOutcomeNotes: string;
  entryPrice: number | '';
  exitPrice: number | '';
  stopLossPrice: number | '';
  takeProfitPrice: number | '';
  positionSize: number | '';
  grossPnl: number | '';
  commission: number | '';
  otherCharges: number | '';
  netPnl: number | '';
  realisedR: number | '';
  currency: string;
  followedPlan: YesNoNa;
  followedRiskRules: YesNoNa;
  impulsiveEntry: YesNoNa;
  exitedPerPlan: YesNoNa;
  postTradeEmotion: string;
  mistakes: string[];
  lessonsLearned: string;
}

function buildEditDraft(trade: Trade): TradeEditDraft {
  return {
    date: trade.date,
    tradeNumberOfDay: trade.tradeNumberOfDay,
    accountId: trade.accountId,
    sessionSelection: trade.isOutOfSession || !trade.sessionId ? '__oos__' : trade.sessionId,
    instrument: trade.instrument,
    direction: trade.direction,
    status: trade.status,
    setupLabel: trade.setupLabel ?? '',
    entryType: trade.entryType ?? '',
    timeframe: trade.timeframe ?? '',
    riskPercent: trade.riskPercent,
    expectedProfitPercent: trade.expectedProfitPercent,
    actualProfitPercent: trade.actualProfitPercent ?? '',
    preTradeEmotion: trade.preTradeEmotion,
    confidence: trade.confidence,
    entryReasoning: trade.entryReasoning ?? '',
    expectedOutcome: trade.expectedOutcome ?? '',
    exitOutcome: trade.exitOutcome,
    exitReason: trade.exitReason,
    tpStatus: trade.tpStatus,
    slStatus: trade.slStatus,
    actualOutcomeNotes: trade.actualOutcomeNotes ?? '',
    entryPrice: trade.entryPrice ?? '',
    exitPrice: trade.exitPrice ?? '',
    stopLossPrice: trade.stopLossPrice ?? '',
    takeProfitPrice: trade.takeProfitPrice ?? '',
    positionSize: trade.positionSize ?? '',
    grossPnl: trade.grossPnl ?? '',
    commission: trade.commission ?? '',
    otherCharges: trade.otherCharges ?? '',
    netPnl: trade.netPnl ?? '',
    realisedR: trade.realisedR ?? '',
    currency: trade.currency ?? '',
    followedPlan: trade.followedPlan,
    followedRiskRules: trade.followedRiskRules,
    impulsiveEntry: trade.impulsiveEntry,
    exitedPerPlan: trade.exitedPerPlan,
    postTradeEmotion: trade.postTradeEmotion ?? '',
    mistakes: [...(trade.mistakes ?? [])],
    lessonsLearned: trade.lessonsLearned ?? '',
  };
}

function ClearFieldButton({
  visible,
  disabled,
  label,
  onClick,
}: {
  visible: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  if (!visible) return null;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={`Delete ${label}`}
      title={`Delete ${label}`}
      className="inline-flex items-center gap-0.5 text-[11px] text-[var(--negative)] hover:underline disabled:opacity-45 cursor-pointer"
    >
      <X className="w-3 h-3" />
      <span>Delete</span>
    </button>
  );
}

export function TradeInspectorDrawer({
  trade,
  tradeEvents,
  attachments,
  allAttachments,
  userId,
  timezone,
  onClose,
  onRequestCloseTrade,
  onSelectTrade,
  onTradeSoftDeleted,
}: TradeInspectorDrawerProps) {
  const {
    accounts,
    sessions,
    trades,
    tradeGroups,
    instruments,
    preferences,
    refreshDiagnostics,
  } = useWorkspace();

  const [viewTab, setViewTab] = useState<InspectorTab>('overview');
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<TradeEditDraft | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [savingQuickMetrics, setSavingQuickMetrics] = useState(false);
  const [quickSavedNotice, setQuickSavedNotice] = useState<string | null>(null);
  const [confirmMode, setConfirmMode] = useState<'none' | 'trash_group' | 'permanent_purge'>('none');
  const [deleting, setDeleting] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const [lessonsDraft, setLessonsDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (trade) {
      setLessonsDraft(trade.lessonsLearned ?? '');
      setNotesDraft(trade.actualOutcomeNotes ?? '');
      setDraft(buildEditDraft(trade));
      setIsEditing(false);
      setConfirmMode('none');
      setActionError(null);
      setQuickSavedNotice(null);
      setViewTab('overview');
    }
  }, [trade?.id]);

  useEffect(() => {
    if (trade && !isEditing) {
      setDraft(buildEditDraft(trade));
      setLessonsDraft(trade.lessonsLearned ?? '');
      setNotesDraft(trade.actualOutcomeNotes ?? '');
    }
  }, [trade, isEditing]);

  useEffect(() => {
    if (!trade) return;
    let active = true;
    const loadUrls = async () => {
      const next: Record<string, string> = {};
      for (const att of attachments) {
        try {
          next[att.id] = await getAttachmentDownloadUrl(att.storagePath);
        } catch {
          // Ignore unavailable attachment URL
        }
      }
      if (active) setUrls(next);
    };
    void loadUrls();
    return () => {
      active = false;
    };
  }, [trade?.id, attachments.length]);

  const siblingTrades = useMemo(() => {
    if (!trade?.tradeGroupId) return [];
    const targetIsDeleted = Boolean(trade.isDeleted);
    return trades.filter(
      (t) =>
        t.tradeGroupId === trade.tradeGroupId &&
        t.id !== trade.id &&
        Boolean(t.isDeleted) === targetIsDeleted
    );
  }, [trade?.id, trade?.tradeGroupId, trade?.isDeleted, trades]);

  const sortedSessions = useMemo(
    () =>
      [...sessions].sort(
        (a, b) => b.date.localeCompare(a.date) || (b.actualStartTime ?? '').localeCompare(a.actualStartTime ?? '')
      ),
    [sessions]
  );

  if (!trade) return null;

  const eventsForTrade = tradeEvents
    .filter((e) => e.tradeId === trade.id)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const realisedR = computeRealisedR(trade);
  const isDeleted = Boolean(trade.isDeleted);
  const resolvedCurrency = (
    trade.currency ||
    accounts.find((a) => a.id === trade.accountId)?.currency ||
    preferences?.preferredCurrency ||
    'USD'
  ).toUpperCase();

  const handleSaveNotes = async () => {
    if (savingNotes) return;
    const cleanNotes = notesDraft.trim();
    const cleanLessons = lessonsDraft.trim();
    if (cleanNotes.length > 4000) {
      setActionError('Outcome notes must be 4000 characters or fewer.');
      return;
    }
    if (cleanLessons.length > 4000) {
      setActionError('Lessons learned must be 4000 characters or fewer.');
      return;
    }
    setSavingNotes(true);
    setActionError(null);
    try {
      const patch: Record<string, unknown> = {};
      const clearFields: string[] = [];
      if (cleanNotes) {
        patch.actualOutcomeNotes = cleanNotes;
      } else {
        clearFields.push('actualOutcomeNotes');
      }
      if (cleanLessons) {
        patch.lessonsLearned = cleanLessons;
      } else {
        clearFields.push('lessonsLearned');
      }
      await updateTradeDetails(userId, trade.id, patch, clearFields);
      setQuickSavedNotice('Review notes saved.');
      refreshDiagnostics();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to save trade notes.');
      refreshDiagnostics();
    } finally {
      setSavingNotes(false);
    }
  };

  const persistNumericMetrics = async (
    targetDraft: TradeEditDraft,
    noticeText: string
  ) => {
    if (savingQuickMetrics) return;
    setSavingQuickMetrics(true);
    setActionError(null);
    setQuickSavedNotice(null);

    const patch: Record<string, unknown> = {
      expectedProfitPercent:
        targetDraft.expectedProfitPercent === '' ? 0 : Number(targetDraft.expectedProfitPercent),
    };
    const clearFields: string[] = [];

    if (targetDraft.currency.trim()) {
      patch.currency = targetDraft.currency.trim().slice(0, 10);
    } else {
      clearFields.push('currency');
    }

    const metricKeys: Array<
      keyof Pick<
        TradeEditDraft,
        | 'actualProfitPercent'
        | 'entryPrice'
        | 'exitPrice'
        | 'stopLossPrice'
        | 'takeProfitPrice'
        | 'positionSize'
        | 'grossPnl'
        | 'commission'
        | 'otherCharges'
        | 'netPnl'
        | 'realisedR'
      >
    > = [
      'actualProfitPercent',
      'entryPrice',
      'exitPrice',
      'stopLossPrice',
      'takeProfitPrice',
      'positionSize',
      'grossPnl',
      'commission',
      'otherCharges',
      'netPnl',
      'realisedR',
    ];

    if (
      targetDraft.expectedProfitPercent !== '' &&
      !Number.isFinite(Number(targetDraft.expectedProfitPercent))
    ) {
      setActionError('Expected Profit % must be a finite number.');
      setSavingQuickMetrics(false);
      return;
    }

    for (const key of metricKeys) {
      const val = targetDraft[key];
      if (val === '') {
        clearFields.push(key);
      } else {
        const num = Number(val);
        if (!Number.isFinite(num)) {
          setActionError(`${key} must be a finite number.`);
          setSavingQuickMetrics(false);
          return;
        }
        patch[key] = num;
      }
    }

    try {
      await updateTradeDetails(userId, trade.id, patch, clearFields);
      refreshDiagnostics();
      setQuickSavedNotice(noticeText);
    } catch (err) {
      setActionError(
        err && typeof err === 'object' && 'userMessage' in err
          ? String((err as { userMessage: string }).userMessage)
          : err instanceof Error
          ? err.message
          : 'Failed to save trade values.'
      );
      refreshDiagnostics();
    } finally {
      setSavingQuickMetrics(false);
    }
  };

  const clearSingleMetricField = async (
    key: keyof Pick<
      TradeEditDraft,
      | 'actualProfitPercent'
      | 'entryPrice'
      | 'exitPrice'
      | 'stopLossPrice'
      | 'takeProfitPrice'
      | 'positionSize'
      | 'grossPnl'
      | 'commission'
      | 'otherCharges'
      | 'netPnl'
      | 'realisedR'
      | 'currency'
      | 'expectedProfitPercent'
    >,
    label: string
  ) => {
    if (!draft) return;
    const nextDraft: TradeEditDraft = {
      ...draft,
      [key]: key === 'expectedProfitPercent' ? 0 : '',
    };
    setDraft(nextDraft);
    await persistNumericMetrics(nextDraft, `Deleted ${label}.`);
  };

  const clearMetricGroup = async (group: 'exit_entries' | 'target_profit' | 'stop_loss' | 'monetary_profits') => {
    if (!draft) return;
    let nextDraft: TradeEditDraft = { ...draft };
    let label = '';

    if (group === 'exit_entries') {
      nextDraft = { ...nextDraft, entryPrice: '', exitPrice: '', positionSize: '' };
      label = 'Cleared Exit Entries.';
    } else if (group === 'target_profit') {
      nextDraft = { ...nextDraft, takeProfitPrice: '', expectedProfitPercent: 0 };
      label = 'Cleared Target Profit values.';
    } else if (group === 'stop_loss') {
      nextDraft = { ...nextDraft, stopLossPrice: '' };
      label = 'Deleted Stop Loss.';
    } else if (group === 'monetary_profits') {
      nextDraft = {
        ...nextDraft,
        grossPnl: '',
        commission: '',
        otherCharges: '',
        netPnl: '',
        actualProfitPercent: '',
        realisedR: '',
        currency: '',
      };
      label = 'Cleared Monetary Profits.';
    }

    setDraft(nextDraft);
    await persistNumericMetrics(nextDraft, label);
  };

  const handleSaveFullEdit = async () => {
    if (!draft || savingEdit) return;
    setActionError(null);
    setQuickSavedNotice(null);

    if (!DATE_PATTERN.test(draft.date)) {
      setActionError('Date must be in YYYY-MM-DD format.');
      return;
    }
    if (draft.tradeNumberOfDay === '' || draft.tradeNumberOfDay < 1) {
      setActionError('Trade # of day must be at least 1.');
      return;
    }
    const cleanInstrument = draft.instrument.trim();
    if (!cleanInstrument || cleanInstrument.length > 32) {
      setActionError('Instrument is required and must be 32 characters or fewer.');
      return;
    }
    if (!draft.accountId || !isValidId(draft.accountId)) {
      setActionError('Please select a valid trading account.');
      return;
    }
    if (draft.riskPercent === '' || !Number.isFinite(Number(draft.riskPercent)) || Number(draft.riskPercent) < 0) {
      setActionError('Risk % must be a valid non-negative finite number.');
      return;
    }
    if (draft.expectedProfitPercent === '' || !Number.isFinite(Number(draft.expectedProfitPercent))) {
      setActionError('Expected Profit % must be a finite number (enter 0 if none).');
      return;
    }
    if (!draft.preTradeEmotion.trim()) {
      setActionError('Pre-trade emotion is required.');
      return;
    }
    if (draft.status === 'closed' && !['win', 'loss', 'breakeven'].includes(draft.exitOutcome)) {
      setActionError('A closed trade must have Exit Outcome set to Win, Loss, or Breakeven.');
      return;
    }

    const selectedAccount = accounts.find((a) => a.id === draft.accountId);
    const isOos = draft.sessionSelection === '__oos__';
    const selectedSession = isOos ? undefined : sessions.find((s) => s.id === draft.sessionSelection);

    if (!isOos && !selectedSession) {
      setActionError('Selected session could not be found.');
      return;
    }

    const patch: Record<string, unknown> = {
      date: draft.date,
      tradeNumberOfDay: Number(draft.tradeNumberOfDay),
      accountId: draft.accountId,
      accountName: selectedAccount?.name ?? trade.accountName,
      isOutOfSession: isOos,
      instrument: cleanInstrument,
      direction: draft.direction,
      status: draft.status,
      setupLabel: draft.setupLabel.trim(),
      entryType: draft.entryType.trim(),
      timeframe: draft.timeframe.trim(),
      riskPercent: Number(draft.riskPercent),
      expectedProfitPercent: Number(draft.expectedProfitPercent),
      preTradeEmotion: draft.preTradeEmotion.trim(),
      confidence: Number(draft.confidence),
      entryReasoning: draft.entryReasoning.trim(),
      expectedOutcome: draft.expectedOutcome.trim(),
      exitOutcome: draft.exitOutcome,
      exitReason: draft.exitReason,
      tpStatus: draft.tpStatus,
      slStatus: draft.slStatus,
      actualOutcomeNotes: draft.actualOutcomeNotes.trim(),
      followedPlan: draft.followedPlan,
      followedRiskRules: draft.followedRiskRules,
      impulsiveEntry: draft.impulsiveEntry,
      exitedPerPlan: draft.exitedPerPlan,
      postTradeEmotion: draft.postTradeEmotion.trim(),
      mistakes: draft.mistakes,
      lessonsLearned: draft.lessonsLearned.trim(),
    };

    const clearFields: string[] = [];

    if (draft.currency.trim()) {
      patch.currency = draft.currency.trim().slice(0, 10);
    } else {
      clearFields.push('currency');
    }

    if (isOos) {
      clearFields.push('sessionId', 'sessionName');
    } else if (selectedSession) {
      patch.sessionId = selectedSession.id;
      patch.sessionName = selectedSession.sessionName;
    }

    if (draft.status === 'closed') {
      patch.closedAt = trade.closedAt || new Date().toISOString();
    } else {
      clearFields.push('closedAt');
    }

    const numericOptionalKeys: Array<
      keyof Pick<
        TradeEditDraft,
        | 'actualProfitPercent'
        | 'entryPrice'
        | 'exitPrice'
        | 'stopLossPrice'
        | 'takeProfitPrice'
        | 'positionSize'
        | 'grossPnl'
        | 'commission'
        | 'otherCharges'
        | 'netPnl'
        | 'realisedR'
      >
    > = [
      'actualProfitPercent',
      'entryPrice',
      'exitPrice',
      'stopLossPrice',
      'takeProfitPrice',
      'positionSize',
      'grossPnl',
      'commission',
      'otherCharges',
      'netPnl',
      'realisedR',
    ];

    for (const key of numericOptionalKeys) {
      const val = draft[key];
      if (val === '') {
        clearFields.push(key);
      } else {
        const num = Number(val);
        if (!Number.isFinite(num)) {
          setActionError(`${key} must be a finite number.`);
          return;
        }
        patch[key] = num;
      }
    }

    const previewTrade: Trade = {
      ...trade,
      ...(patch as Partial<Trade>),
      id: trade.id,
      userId: trade.userId,
      schemaVersion: trade.schemaVersion,
    };
    for (const cf of clearFields) {
      delete (previewTrade as unknown as Record<string, unknown>)[cf];
    }
    const fullCheck = validateCompleteTradeDocument(previewTrade);
    if (!fullCheck.valid) {
      setActionError(fullCheck.errors.join(' '));
      return;
    }

    setSavingEdit(true);
    try {
      await updateTradeDetails(userId, trade.id, patch, clearFields);
      refreshDiagnostics();
      setIsEditing(false);
      setQuickSavedNotice('Saved all trade changes.');
    } catch (err) {
      setActionError(
        err && typeof err === 'object' && 'userMessage' in err
          ? String((err as { userMessage: string }).userMessage)
          : err instanceof Error
          ? err.message
          : 'Failed to update trade.'
      );
      refreshDiagnostics();
    } finally {
      setSavingEdit(false);
    }
  };

  const handleMoveSingleToTrash = async () => {
    if (deleting) return;
    setDeleting(true);
    setActionError(null);
    try {
      await softDeleteTrade(userId, trade);
      refreshDiagnostics();
      onTradeSoftDeleted?.(trade);
      onClose();
    } catch (err) {
      setActionError(
        err && typeof err === 'object' && 'userMessage' in err
          ? String((err as { userMessage: string }).userMessage)
          : err instanceof Error
          ? err.message
          : 'Failed to move trade to Trash.'
      );
      refreshDiagnostics();
    } finally {
      setDeleting(false);
    }
  };

  const handleRestoreSingle = async () => {
    if (restoring) return;
    setRestoring(true);
    setActionError(null);
    try {
      await restoreTrade(userId, trade);
      refreshDiagnostics();
      onClose();
    } catch (err) {
      setActionError(
        err && typeof err === 'object' && 'userMessage' in err
          ? String((err as { userMessage: string }).userMessage)
          : err instanceof Error
          ? err.message
          : 'Failed to restore trade.'
      );
      refreshDiagnostics();
    } finally {
      setRestoring(false);
    }
  };

  const handleRestoreGroup = async () => {
    if (restoring || !trade.tradeGroupId) return;
    setRestoring(true);
    setActionError(null);
    try {
      const tradesToRestore = [trade, ...siblingTrades.filter((s) => !isActiveTrade(s))];
      await restoreTradeGroup(userId, tradesToRestore);
      refreshDiagnostics();
      onClose();
    } catch (err) {
      setActionError(
        err && typeof err === 'object' && 'userMessage' in err
          ? String((err as { userMessage: string }).userMessage)
          : err instanceof Error
          ? err.message
          : 'Failed to restore linked group.'
      );
      refreshDiagnostics();
    } finally {
      setRestoring(false);
    }
  };

  const handleConfirmDialogAction = async () => {
    if (deleting) return;
    setDeleting(true);
    setActionError(null);
    try {
      if (confirmMode === 'trash_group' && trade.tradeGroupId) {
        const activeGroupTrades = [trade, ...siblingTrades.filter(isActiveTrade)];
        await softDeleteTradeGroup(userId, activeGroupTrades);
      } else if (confirmMode === 'permanent_purge') {
        await deleteTradeCascade(userId, trade, tradeEvents, tradeGroups, allAttachments);
      }
      refreshDiagnostics();
      setConfirmMode('none');
      onClose();
    } catch (err) {
      setActionError(
        err && typeof err === 'object' && 'userMessage' in err
          ? String((err as { userMessage: string }).userMessage)
          : err instanceof Error
          ? err.message
          : 'Trade delete operation failed.'
      );
      refreshDiagnostics();
      setConfirmMode('none');
    } finally {
      setDeleting(false);
    }
  };

  const toggleMistake = (mistake: string) => {
    if (!draft) return;
    const exists = draft.mistakes.includes(mistake);
    setDraft({
      ...draft,
      mistakes: exists ? draft.mistakes.filter((m) => m !== mistake) : [...draft.mistakes, mistake],
    });
  };

  const accountOptions = accounts.map((a) => ({
    value: a.id,
    label: `${a.name} (${a.currency})`,
  }));
  if (!accountOptions.some((o) => o.value === trade.accountId)) {
    accountOptions.unshift({ value: trade.accountId, label: trade.accountName });
  }

  const sessionOptions = [
    { value: '__oos__', label: 'Out-of-Session' },
    ...sortedSessions.map((s) => ({
      value: s.id,
      label: `${s.date} · ${s.sessionName} (${s.status})`,
    })),
  ];
  if (
    draft &&
    draft.sessionSelection !== '__oos__' &&
    !sessionOptions.some((o) => o.value === draft.sessionSelection)
  ) {
    sessionOptions.push({
      value: draft.sessionSelection,
      label: trade.sessionName ?? draft.sessionSelection,
    });
  }

  const preEmotionOptions = Array.from(
    new Set<string>([...PRE_SESSION_EMOTIONS, ...(draft?.preTradeEmotion ? [draft.preTradeEmotion] : [])])
  ).map((e) => ({ value: e, label: e }));

  const postEmotionOptions = [
    { value: '', label: '— None —' },
    ...Array.from(
      new Set<string>([...POST_TRADE_EMOTIONS, ...(draft?.postTradeEmotion ? [draft.postTradeEmotion] : [])])
    ).map((e) => ({ value: e, label: e })),
  ];

  const mistakePool = Array.from(new Set<string>([...TRADE_MISTAKES, ...(draft?.mistakes ?? [])]));

  const renderPutDeleteMetricsSection = () => {
    if (!draft) return null;
    const busy = savingQuickMetrics || savingEdit;

    return (
      <section className="p-4 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-[var(--text-primary)]">
              Monetary Profits, Exit Entries, Target Profit &amp; Stop Loss
            </h3>
            <p className="text-[11px] text-[var(--text-muted)]">
              Put new values or delete any individual value or section directly.
            </p>
          </div>
          {!isEditing && (
            <PrimaryButton
              size="sm"
              type="button"
              disabled={busy}
              onClick={() => void persistNumericMetrics(draft, 'Saved values.')}
            >
              {savingQuickMetrics ? 'Saving...' : 'Save Values'}
            </PrimaryButton>
          )}
        </div>

        {quickSavedNotice && (
          <div className="px-3 py-1.5 rounded border border-[var(--positive)]/35 bg-[var(--positive-bg)] text-[var(--positive)] text-[11px] font-medium">
            {quickSavedNotice}
          </div>
        )}

        {/* 1. Exit Entries */}
        <div className="space-y-2 pt-2 border-t border-[var(--border)]">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-[var(--text-primary)]">Exit Entries</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void clearMetricGroup('exit_entries')}
              className="text-[11px] text-[var(--negative)] hover:underline disabled:opacity-45 cursor-pointer"
            >
              Delete All Exit Entries
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <NumberInput
              label="Entry Price"
              value={draft.entryPrice}
              onChange={(v) => setDraft({ ...draft, entryPrice: v })}
              placeholder="Put entry price"
              labelAction={
                <ClearFieldButton
                  visible={draft.entryPrice !== ''}
                  disabled={busy}
                  label="Entry Price"
                  onClick={() => void clearSingleMetricField('entryPrice', 'Entry Price')}
                />
              }
            />
            <NumberInput
              label="Exit Price"
              value={draft.exitPrice}
              onChange={(v) => setDraft({ ...draft, exitPrice: v })}
              placeholder="Put exit price"
              labelAction={
                <ClearFieldButton
                  visible={draft.exitPrice !== ''}
                  disabled={busy}
                  label="Exit Price"
                  onClick={() => void clearSingleMetricField('exitPrice', 'Exit Price')}
                />
              }
            />
            <NumberInput
              label="Position Size"
              value={draft.positionSize}
              onChange={(v) => setDraft({ ...draft, positionSize: v })}
              placeholder="Put size"
              labelAction={
                <ClearFieldButton
                  visible={draft.positionSize !== ''}
                  disabled={busy}
                  label="Position Size"
                  onClick={() => void clearSingleMetricField('positionSize', 'Position Size')}
                />
              }
            />
          </div>
        </div>

        {/* 2. Target Profit & 3. Stop Loss */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[var(--border)]">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-[var(--text-primary)]">Target Profit</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void clearMetricGroup('target_profit')}
                className="text-[11px] text-[var(--negative)] hover:underline disabled:opacity-45 cursor-pointer"
              >
                Delete Target Profit
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <NumberInput
                label="Take Profit Price"
                value={draft.takeProfitPrice}
                onChange={(v) => setDraft({ ...draft, takeProfitPrice: v })}
                placeholder="Put TP price"
                labelAction={
                  <ClearFieldButton
                    visible={draft.takeProfitPrice !== ''}
                    disabled={busy}
                    label="Take Profit Price"
                    onClick={() => void clearSingleMetricField('takeProfitPrice', 'Take Profit Price')}
                  />
                }
              />
              <NumberInput
                label="Expected Profit %"
                value={draft.expectedProfitPercent}
                onChange={(v) => setDraft({ ...draft, expectedProfitPercent: v })}
                labelAction={
                  <ClearFieldButton
                    visible={draft.expectedProfitPercent !== '' && draft.expectedProfitPercent !== 0}
                    disabled={busy}
                    label="Expected Profit %"
                    onClick={() => void clearSingleMetricField('expectedProfitPercent', 'Expected Profit %')}
                  />
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-[var(--text-primary)]">Stop Loss</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void clearMetricGroup('stop_loss')}
                className="text-[11px] text-[var(--negative)] hover:underline disabled:opacity-45 cursor-pointer"
              >
                Delete Stop Loss
              </button>
            </div>
            <NumberInput
              label="Stop Loss Price"
              value={draft.stopLossPrice}
              onChange={(v) => setDraft({ ...draft, stopLossPrice: v })}
              placeholder="Put SL price"
              labelAction={
                <ClearFieldButton
                  visible={draft.stopLossPrice !== ''}
                  disabled={busy}
                  label="Stop Loss Price"
                  onClick={() => void clearSingleMetricField('stopLossPrice', 'Stop Loss Price')}
                />
              }
            />
          </div>
        </div>

        {/* 4. Monetary Profits */}
        <div className="space-y-2 pt-2 border-t border-[var(--border)]">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-[var(--text-primary)]">Monetary Profits</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void clearMetricGroup('monetary_profits')}
              className="text-[11px] text-[var(--negative)] hover:underline disabled:opacity-45 cursor-pointer"
            >
              Delete All Monetary Profits
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <NumberInput
              label="Net P&L"
              value={draft.netPnl}
              onChange={(v) => setDraft({ ...draft, netPnl: v })}
              placeholder="Put Net P&L"
              labelAction={
                <ClearFieldButton
                  visible={draft.netPnl !== ''}
                  disabled={busy}
                  label="Net P&L"
                  onClick={() => void clearSingleMetricField('netPnl', 'Net P&L')}
                />
              }
            />
            <NumberInput
              label="Gross P&L"
              value={draft.grossPnl}
              onChange={(v) => setDraft({ ...draft, grossPnl: v })}
              placeholder="Put Gross P&L"
              labelAction={
                <ClearFieldButton
                  visible={draft.grossPnl !== ''}
                  disabled={busy}
                  label="Gross P&L"
                  onClick={() => void clearSingleMetricField('grossPnl', 'Gross P&L')}
                />
              }
            />
            <NumberInput
              label="Commission"
              value={draft.commission}
              onChange={(v) => setDraft({ ...draft, commission: v })}
              placeholder="Put commission"
              labelAction={
                <ClearFieldButton
                  visible={draft.commission !== ''}
                  disabled={busy}
                  label="Commission"
                  onClick={() => void clearSingleMetricField('commission', 'Commission')}
                />
              }
            />
            <NumberInput
              label="Other Charges"
              value={draft.otherCharges}
              onChange={(v) => setDraft({ ...draft, otherCharges: v })}
              placeholder="Put charges"
              labelAction={
                <ClearFieldButton
                  visible={draft.otherCharges !== ''}
                  disabled={busy}
                  label="Other Charges"
                  onClick={() => void clearSingleMetricField('otherCharges', 'Other Charges')}
                />
              }
            />
            <NumberInput
              label="Actual Profit %"
              value={draft.actualProfitPercent}
              onChange={(v) => setDraft({ ...draft, actualProfitPercent: v })}
              placeholder="Put actual %"
              labelAction={
                <ClearFieldButton
                  visible={draft.actualProfitPercent !== ''}
                  disabled={busy}
                  label="Actual Profit %"
                  onClick={() => void clearSingleMetricField('actualProfitPercent', 'Actual Profit %')}
                />
              }
            />
            <NumberInput
              label="Realised R"
              value={draft.realisedR}
              onChange={(v) => setDraft({ ...draft, realisedR: v })}
              placeholder="Put R multiple"
              labelAction={
                <ClearFieldButton
                  visible={draft.realisedR !== ''}
                  disabled={busy}
                  label="Realised R"
                  onClick={() => void clearSingleMetricField('realisedR', 'Realised R')}
                />
              }
            />
            <FieldWrapper
              label="Currency"
              labelAction={
                <ClearFieldButton
                  visible={draft.currency.trim() !== ''}
                  disabled={busy}
                  label="Currency"
                  onClick={() => void clearSingleMetricField('currency', 'Currency')}
                />
              }
            >
              <input
                type="text"
                maxLength={10}
                value={draft.currency}
                placeholder="USD"
                onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })}
                className="w-full h-9 px-3 text-sm rounded-lg bg-[var(--surface)] text-[var(--text-primary)] border border-[var(--border)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--text-secondary)]"
              />
            </FieldWrapper>
          </div>
        </div>
      </section>
    );
  };

  return (
    <>
      <Drawer
        open={Boolean(trade)}
        onClose={onClose}
        title={`${trade.instrument} · ${TRADE_DIRECTION_LABELS[trade.direction]}`}
        subtitle={`${trade.date} · Trade #${trade.tradeNumberOfDay} · ${trade.accountName} · ${
          trade.isOutOfSession ? 'Out-of-Session' : trade.sessionName ?? 'In Session'
        }${isDeleted ? ' · IN TRASH' : ''}`}
      >
        <div className="space-y-5 text-xs">
          {actionError && <ErrorBanner title="Trade Action Failed" message={actionError} />}

          {/* Deleted Trade Banner */}
          {isDeleted && (
            <div className="p-3.5 rounded-lg border border-[var(--caution)]/50 bg-[var(--caution-bg)] flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <div className="font-semibold text-[var(--text-primary)]">
                  Recently Deleted Trade
                </div>
                <div className="text-[11px] text-[var(--text-secondary)]">
                  Excluded from ledger statistics &amp; analytics.{' '}
                  {trade.deletedAt
                    ? `Moved to Trash ${formatTimestampInTimezone(trade.deletedAt, timezone)}.`
                    : ''}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <PrimaryButton
                  size="sm"
                  type="button"
                  disabled={restoring || deleting}
                  onClick={handleRestoreSingle}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {restoring ? 'Restoring...' : 'Restore Trade'}
                </PrimaryButton>
                {siblingTrades.length > 0 && trade.tradeGroupId && (
                  <SecondaryButton
                    size="sm"
                    type="button"
                    disabled={restoring || deleting}
                    onClick={handleRestoreGroup}
                  >
                    Restore Linked Group ({siblingTrades.length + 1})
                  </SecondaryButton>
                )}
              </div>
            </div>
          )}

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-[var(--border)]">
            <div className="flex flex-wrap items-center gap-2">
              {!isEditing ? (
                <SecondaryButton
                  size="sm"
                  type="button"
                  onClick={() => {
                    setDraft(buildEditDraft(trade));
                    setActionError(null);
                    setQuickSavedNotice(null);
                    setIsEditing(true);
                  }}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit All Trade Data
                </SecondaryButton>
              ) : (
                <>
                  <PrimaryButton
                    size="sm"
                    type="button"
                    onClick={handleSaveFullEdit}
                    disabled={savingEdit}
                  >
                    {savingEdit ? 'Saving...' : 'Save Trade Changes'}
                  </PrimaryButton>
                  <SecondaryButton
                    size="sm"
                    type="button"
                    disabled={savingEdit}
                    onClick={() => {
                      setDraft(buildEditDraft(trade));
                      setActionError(null);
                      setIsEditing(false);
                    }}
                  >
                    Cancel Edit
                  </SecondaryButton>
                </>
              )}
              {!isDeleted && trade.status !== 'closed' && onRequestCloseTrade && !isEditing && (
                <PrimaryButton size="sm" type="button" onClick={() => onRequestCloseTrade(trade)}>
                  Close Trade
                </PrimaryButton>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!isDeleted ? (
                <>
                  <DestructiveButton
                    size="sm"
                    type="button"
                    onClick={handleMoveSingleToTrash}
                    disabled={deleting || savingEdit}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {deleting ? 'Moving...' : 'Move to Trash'}
                  </DestructiveButton>
                  {siblingTrades.length > 0 && trade.tradeGroupId && (
                    <SecondaryButton
                      size="sm"
                      type="button"
                      onClick={() => setConfirmMode('trash_group')}
                      disabled={deleting || savingEdit}
                    >
                      Trash Linked Group ({siblingTrades.length + 1})
                    </SecondaryButton>
                  )}
                </>
              ) : (
                <DestructiveButton
                  size="sm"
                  type="button"
                  onClick={() => setConfirmMode('permanent_purge')}
                  disabled={deleting || restoring}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Permanently
                </DestructiveButton>
              )}
            </div>
          </div>

          {/* Linked Pair Banner */}
          {siblingTrades.length > 0 && (
            <div className="p-3 rounded-lg bg-[var(--positive-bg)] border border-[var(--positive)]/35 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[var(--text-primary)]">
                <Link2 className="w-4 h-4 text-[var(--positive)] shrink-0" />
                <span>
                  Paired multi-account execution · Linked with{' '}
                  <strong>{siblingTrades.map((s) => s.accountName).join(', ')}</strong>
                </span>
              </div>
              {onSelectTrade && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {siblingTrades.map((sib) => (
                    <button
                      key={sib.id}
                      type="button"
                      onClick={() => onSelectTrade(sib)}
                      className="px-2 py-1 rounded border border-[var(--positive)]/40 bg-[var(--surface)] text-[11px] font-medium text-[var(--positive)] hover:opacity-85 cursor-pointer"
                    >
                      Inspect {sib.accountName} →
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {isEditing && draft ? (
            <div className="space-y-6">
              {/* Identity & Context */}
              <section className="space-y-3">
                <h3 className="font-semibold text-[var(--text-primary)]">Identity, Account &amp; Session</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <DatePicker
                    label="Date"
                    value={draft.date}
                    onChange={(v) => setDraft({ ...draft, date: v })}
                  />
                  <NumberInput
                    label="Trade # of Day"
                    min={1}
                    step={1}
                    value={draft.tradeNumberOfDay}
                    onChange={(v) => setDraft({ ...draft, tradeNumberOfDay: v })}
                  />
                  <SelectInput
                    label="Account"
                    value={draft.accountId}
                    onChange={(val) => {
                      const acc = accounts.find((a) => a.id === val);
                      setDraft({
                        ...draft,
                        accountId: val,
                        currency: acc?.currency ?? draft.currency,
                      });
                    }}
                    options={accountOptions}
                  />
                  <SelectInput
                    label="Session Link"
                    value={draft.sessionSelection}
                    onChange={(val) => setDraft({ ...draft, sessionSelection: val })}
                    options={sessionOptions}
                  />
                  <TextInput
                    label="Instrument"
                    required
                    list="trade-edit-instruments"
                    value={draft.instrument}
                    onChange={(e) => setDraft({ ...draft, instrument: e.target.value.toUpperCase() })}
                  />
                  <datalist id="trade-edit-instruments">
                    {instruments.map((inst) => (
                      <option key={inst.id} value={inst.symbol} />
                    ))}
                  </datalist>

                  <FieldWrapper label="Direction" required>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={draft.direction === 'long'}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          direction: draft.direction === 'long' ? 'short' : 'long',
                        })
                      }
                      className={`h-9 w-full px-3 rounded-lg border flex items-center justify-between text-sm font-semibold transition-colors cursor-pointer ${
                        draft.direction === 'long'
                          ? 'bg-[var(--positive-bg)] text-[var(--positive)] border-[var(--positive)]/40'
                          : 'bg-[var(--negative-bg)] text-[var(--negative)] border-[var(--negative)]/40'
                      }`}
                    >
                      <span>{draft.direction === 'long' ? 'Long (Buy)' : 'Short (Sell)'}</span>
                      <span className="text-[11px] font-medium opacity-80">Click to switch</span>
                    </button>
                  </FieldWrapper>

                  <SelectInput
                    label="Status"
                    value={draft.status}
                    onChange={(val) => {
                      const nextStatus = val as TradeStatus;
                      setDraft({
                        ...draft,
                        status: nextStatus,
                        exitOutcome:
                          nextStatus === 'closed' && draft.exitOutcome === 'pending'
                            ? 'win'
                            : draft.exitOutcome,
                      });
                    }}
                    options={[
                      { value: 'before_entry', label: 'Before Entry' },
                      { value: 'during_trade', label: 'During Trade' },
                      { value: 'closed', label: 'Closed' },
                    ]}
                  />
                </div>
              </section>

              {/* Setup & Risk */}
              <section className="space-y-3 border-t border-[var(--border)] pt-4">
                <h3 className="font-semibold text-[var(--text-primary)]">Setup &amp; Risk</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <TextInput
                    label="Setup Label"
                    list="trade-edit-setups"
                    value={draft.setupLabel}
                    onChange={(e) => setDraft({ ...draft, setupLabel: e.target.value })}
                  />
                  <datalist id="trade-edit-setups">
                    {(preferences?.setupLabels ?? []).map((lbl) => (
                      <option key={lbl} value={lbl} />
                    ))}
                  </datalist>

                  <TextInput
                    label="Entry Type"
                    list="trade-edit-entry-types"
                    value={draft.entryType}
                    onChange={(e) => setDraft({ ...draft, entryType: e.target.value })}
                  />
                  <datalist id="trade-edit-entry-types">
                    {(preferences?.entryTypes ?? []).map((et) => (
                      <option key={et} value={et} />
                    ))}
                  </datalist>

                  <TextInput
                    label="Timeframe"
                    list="trade-edit-timeframes"
                    value={draft.timeframe}
                    onChange={(e) => setDraft({ ...draft, timeframe: e.target.value })}
                  />
                  <datalist id="trade-edit-timeframes">
                    {(preferences?.timeframes ?? []).map((tf) => (
                      <option key={tf} value={tf} />
                    ))}
                  </datalist>

                  <NumberInput
                    label="Risk %"
                    required
                    min={0}
                    value={draft.riskPercent}
                    onChange={(val) => setDraft({ ...draft, riskPercent: val })}
                  />
                </div>
              </section>

              {/* Put / Delete Monetary Profits, Exit Entries, Target Profit & Stop Loss */}
              {renderPutDeleteMetricsSection()}

              {/* Pre-Trade Psychology & Reasoning */}
              <section className="space-y-3 border-t border-[var(--border)] pt-4">
                <h3 className="font-semibold text-[var(--text-primary)]">Pre-Trade Psychology &amp; Plan</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <SelectInput
                    label="Pre-Trade Emotion"
                    value={draft.preTradeEmotion}
                    onChange={(val) => setDraft({ ...draft, preTradeEmotion: val })}
                    options={preEmotionOptions}
                  />
                  <RangeSlider
                    label="Confidence"
                    min={1}
                    max={10}
                    step={1}
                    value={draft.confidence}
                    onChange={(val) => setDraft({ ...draft, confidence: val })}
                    valueLabel={`${draft.confidence}/10`}
                  />
                </div>
                <TextArea
                  label="Entry Reasoning"
                  rows={2}
                  value={draft.entryReasoning}
                  onChange={(e) => setDraft({ ...draft, entryReasoning: e.target.value })}
                />
                <TextArea
                  label="Expected Outcome"
                  rows={2}
                  value={draft.expectedOutcome}
                  onChange={(e) => setDraft({ ...draft, expectedOutcome: e.target.value })}
                />
              </section>

              {/* Outcome & Exit Details */}
              <section className="space-y-3 border-t border-[var(--border)] pt-4">
                <h3 className="font-semibold text-[var(--text-primary)]">Outcome &amp; Exit Details</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <SelectInput
                    label="Exit Outcome"
                    value={draft.exitOutcome}
                    onChange={(val) => setDraft({ ...draft, exitOutcome: val as ExitOutcome })}
                    options={Object.entries(EXIT_OUTCOME_LABELS).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  />
                  <SelectInput
                    label="Exit Reason"
                    value={draft.exitReason}
                    onChange={(val) => setDraft({ ...draft, exitReason: val as ExitReason })}
                    options={Object.entries(EXIT_REASON_LABELS).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  />
                  <SelectInput
                    label="TP Status"
                    value={draft.tpStatus}
                    onChange={(val) => setDraft({ ...draft, tpStatus: val as TpStatus })}
                    options={Object.entries(TP_STATUS_LABELS).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  />
                  <SelectInput
                    label="SL Status"
                    value={draft.slStatus}
                    onChange={(val) => setDraft({ ...draft, slStatus: val as SlStatus })}
                    options={Object.entries(SL_STATUS_LABELS).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  />
                  <SelectInput
                    label="Post-Trade Emotion"
                    value={draft.postTradeEmotion}
                    onChange={(val) => setDraft({ ...draft, postTradeEmotion: val })}
                    options={postEmotionOptions}
                  />
                </div>
                <TextArea
                  label="Actual Outcome Notes"
                  rows={2}
                  value={draft.actualOutcomeNotes}
                  onChange={(e) => setDraft({ ...draft, actualOutcomeNotes: e.target.value })}
                />
              </section>

              {/* Discipline, Mistakes & Lessons */}
              <section className="space-y-3 border-t border-[var(--border)] pt-4">
                <h3 className="font-semibold text-[var(--text-primary)]">Discipline, Mistakes &amp; Lessons</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <SelectInput
                    label="Followed Plan"
                    value={draft.followedPlan}
                    onChange={(val) => setDraft({ ...draft, followedPlan: val as YesNoNa })}
                    options={Object.entries(YES_NO_NA_LABELS).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  />
                  <SelectInput
                    label="Risk Rules"
                    value={draft.followedRiskRules}
                    onChange={(val) => setDraft({ ...draft, followedRiskRules: val as YesNoNa })}
                    options={Object.entries(YES_NO_NA_LABELS).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  />
                  <SelectInput
                    label="Impulsive Entry"
                    value={draft.impulsiveEntry}
                    onChange={(val) => setDraft({ ...draft, impulsiveEntry: val as YesNoNa })}
                    options={Object.entries(YES_NO_NA_LABELS).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  />
                  <SelectInput
                    label="Exited Per Plan"
                    value={draft.exitedPerPlan}
                    onChange={(val) => setDraft({ ...draft, exitedPerPlan: val as YesNoNa })}
                    options={Object.entries(YES_NO_NA_LABELS).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  />
                </div>

                <FieldWrapper label="Mistakes">
                  <div className="flex flex-wrap gap-2">
                    {mistakePool.map((mistake) => {
                      const active = draft.mistakes.includes(mistake);
                      return (
                        <button
                          key={mistake}
                          type="button"
                          onClick={() => toggleMistake(mistake)}
                          className={`px-2.5 py-1 rounded border text-xs transition-colors cursor-pointer ${
                            active
                              ? 'bg-[var(--negative-bg)] text-[var(--negative)] border-[var(--negative)]/40 font-medium'
                              : 'bg-[var(--subtle-surface)] text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          {mistake}
                        </button>
                      );
                    })}
                  </div>
                </FieldWrapper>

                <TextArea
                  label="Lessons Learned"
                  rows={2}
                  value={draft.lessonsLearned}
                  onChange={(e) => setDraft({ ...draft, lessonsLearned: e.target.value })}
                />

                <div className="flex items-center justify-end gap-2 pt-2">
                  <SecondaryButton
                    size="sm"
                    type="button"
                    disabled={savingEdit}
                    onClick={() => {
                      setDraft(buildEditDraft(trade));
                      setActionError(null);
                      setIsEditing(false);
                    }}
                  >
                    Cancel
                  </SecondaryButton>
                  <PrimaryButton
                    size="sm"
                    type="button"
                    disabled={savingEdit}
                    onClick={handleSaveFullEdit}
                  >
                    {savingEdit ? 'Saving...' : 'Save Trade Changes'}
                  </PrimaryButton>
                </div>
              </section>
            </div>
          ) : (
            <>
              {/* Section Navigation */}
              <div className="overflow-x-auto pb-1">
                <SegmentedControl
                  value={viewTab}
                  onChange={setViewTab}
                  options={[
                    { value: 'overview', label: 'Overview' },
                    { value: 'financial', label: 'Execution & Financial' },
                    { value: 'psychology', label: 'Psychology & Discipline' },
                    { value: 'timeline', label: `Timeline (${eventsForTrade.length})` },
                    { value: 'attachments', label: `Attachments (${attachments.length})` },
                  ]}
                />
              </div>

              {/* TAB 1: OVERVIEW */}
              {viewTab === 'overview' && (
                <div className="space-y-4">
                  {trade.status !== 'closed' && !isDeleted && (
                    <div className="p-3.5 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)] flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-[var(--text-primary)]">Active Open Trade</div>
                        <div className="text-[var(--text-muted)]">
                          Opened {formatTimestampInTimezone(trade.openedAt, timezone)} · Duration{' '}
                          {formatDurationMinutes(trade.openedAt)}
                        </div>
                      </div>
                      {onRequestCloseTrade && (
                        <PrimaryButton size="sm" type="button" onClick={() => onRequestCloseTrade(trade)}>
                          Close Trade
                        </PrimaryButton>
                      )}
                    </div>
                  )}

                  <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 rounded-lg border border-[var(--border)]">
                      <div className="text-[var(--text-muted)]">Status</div>
                      <div className="font-semibold text-[var(--text-primary)] mt-0.5">
                        {TRADE_STATUS_LABELS[trade.status]}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg border border-[var(--border)]">
                      <div className="text-[var(--text-muted)]">Result</div>
                      <div
                        className={`font-semibold mt-0.5 ${
                          trade.exitOutcome === 'win'
                            ? 'text-[var(--positive)]'
                            : trade.exitOutcome === 'loss'
                            ? 'text-[var(--negative)]'
                            : 'text-[var(--text-primary)]'
                        }`}
                      >
                        {EXIT_OUTCOME_LABELS[trade.exitOutcome]}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg border border-[var(--border)]">
                      <div className="text-[var(--text-muted)]">Actual % / R</div>
                      <div className="font-mono-num font-semibold text-[var(--text-primary)] mt-0.5">
                        {typeof trade.actualProfitPercent === 'number'
                          ? `${trade.actualProfitPercent >= 0 ? '+' : ''}${trade.actualProfitPercent}%`
                          : '—'}{' '}
                        · {realisedR !== null ? `${realisedR}R` : '—'}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg border border-[var(--border)]">
                      <div className="text-[var(--text-muted)]">Net P&amp;L ({resolvedCurrency})</div>
                      <div
                        className={`font-mono-num font-semibold mt-0.5 ${
                          typeof trade.netPnl === 'number'
                            ? trade.netPnl > 0
                              ? 'text-[var(--positive)]'
                              : trade.netPnl < 0
                              ? 'text-[var(--negative)]'
                              : 'text-[var(--text-primary)]'
                            : 'text-[var(--text-muted)]'
                        }`}
                      >
                        {typeof trade.netPnl === 'number'
                          ? `${trade.netPnl >= 0 ? '+' : ''}${trade.netPnl.toFixed(2)} ${resolvedCurrency}`
                          : '—'}
                      </div>
                    </div>
                  </section>

                  <section className="p-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] space-y-2">
                    <h3 className="font-semibold text-[var(--text-primary)]">Execution Context</h3>
                    <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-[var(--text-secondary)]">
                      <div>
                        <span className="text-[var(--text-muted)]">Opened: </span>
                        <span className="font-mono-num">
                          {formatTimestampInTimezone(trade.openedAt, timezone)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[var(--text-muted)]">Closed: </span>
                        <span className="font-mono-num">
                          {trade.closedAt ? formatTimestampInTimezone(trade.closedAt, timezone) : 'Still Open'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[var(--text-muted)]">Setup: </span>
                        {trade.setupLabel || '—'}
                      </div>
                      <div>
                        <span className="text-[var(--text-muted)]">Entry / TF: </span>
                        {trade.entryType || '—'} · {trade.timeframe || '—'}
                      </div>
                      <div>
                        <span className="text-[var(--text-muted)]">Risk / Target: </span>
                        <span className="font-mono-num">
                          {trade.riskPercent}% / {trade.expectedProfitPercent}%
                        </span>
                      </div>
                      <div>
                        <span className="text-[var(--text-muted)]">Exit Reason: </span>
                        {EXIT_REASON_LABELS[trade.exitReason]}
                      </div>
                      <div>
                        <span className="text-[var(--text-muted)]">TP / SL Status: </span>
                        {TP_STATUS_LABELS[trade.tpStatus]} / {SL_STATUS_LABELS[trade.slStatus]}
                      </div>
                      <div>
                        <span className="text-[var(--text-muted)]">Confidence: </span>
                        <span className="font-mono-num">{trade.confidence}/10</span>
                      </div>
                    </div>
                  </section>

                  {(trade.entryReasoning || trade.expectedOutcome) && (
                    <section className="p-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] space-y-2">
                      {trade.entryReasoning && (
                        <div>
                          <div className="text-[var(--text-muted)] mb-1">Entry Reasoning</div>
                          <p className="text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
                            {trade.entryReasoning}
                          </p>
                        </div>
                      )}
                      {trade.expectedOutcome && (
                        <div className="pt-1">
                          <div className="text-[var(--text-muted)] mb-1">Expected Outcome</div>
                          <p className="text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
                            {trade.expectedOutcome}
                          </p>
                        </div>
                      )}
                    </section>
                  )}
                </div>
              )}

              {/* TAB 2: EXECUTION & FINANCIAL DETAILS */}
              {viewTab === 'financial' && (
                <div className="space-y-4">
                  {renderPutDeleteMetricsSection()}
                </div>
              )}

              {/* TAB 3: PSYCHOLOGY & DISCIPLINE */}
              {viewTab === 'psychology' && (
                <div className="space-y-4">
                  <section className="p-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] space-y-3">
                    <h3 className="font-semibold text-[var(--text-primary)]">Emotional State &amp; Confidence</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[var(--text-secondary)]">
                      <div>
                        <div className="text-[var(--text-muted)]">Pre-Trade Emotion</div>
                        <div className="font-semibold text-[var(--text-primary)] mt-0.5">
                          {trade.preTradeEmotion}
                        </div>
                      </div>
                      <div>
                        <div className="text-[var(--text-muted)]">Post-Trade Emotion</div>
                        <div className="font-semibold text-[var(--text-primary)] mt-0.5">
                          {trade.postTradeEmotion || '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[var(--text-muted)]">Confidence</div>
                        <div className="font-mono-num font-semibold text-[var(--text-primary)] mt-0.5">
                          {trade.confidence}/10
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="p-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] space-y-3">
                    <h3 className="font-semibold text-[var(--text-primary)]">Process &amp; Discipline</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[var(--text-secondary)]">
                      <div>
                        <div className="text-[var(--text-muted)]">Followed Plan</div>
                        <div className="font-semibold text-[var(--text-primary)] mt-0.5">
                          {YES_NO_NA_LABELS[trade.followedPlan]}
                        </div>
                      </div>
                      <div>
                        <div className="text-[var(--text-muted)]">Risk Rules</div>
                        <div className="font-semibold text-[var(--text-primary)] mt-0.5">
                          {YES_NO_NA_LABELS[trade.followedRiskRules]}
                        </div>
                      </div>
                      <div>
                        <div className="text-[var(--text-muted)]">Impulsive Entry</div>
                        <div className="font-semibold text-[var(--text-primary)] mt-0.5">
                          {YES_NO_NA_LABELS[trade.impulsiveEntry]}
                        </div>
                      </div>
                      <div>
                        <div className="text-[var(--text-muted)]">Exited Per Plan</div>
                        <div className="font-semibold text-[var(--text-primary)] mt-0.5">
                          {YES_NO_NA_LABELS[trade.exitedPerPlan]}
                        </div>
                      </div>
                    </div>
                    {trade.mistakes && trade.mistakes.length > 0 && (
                      <div className="text-[var(--negative)] pt-2 border-t border-[var(--border)]">
                        Mistakes: {trade.mistakes.join(' · ')}
                      </div>
                    )}
                  </section>

                  <section className="p-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] space-y-3">
                    <h3 className="font-semibold text-[var(--text-primary)]">Outcome Notes &amp; Lessons</h3>
                    <TextArea
                      label="Outcome Notes"
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      rows={3}
                    />
                    <TextArea
                      label="Lessons Learned"
                      value={lessonsDraft}
                      onChange={(e) => setLessonsDraft(e.target.value)}
                      rows={3}
                    />
                    <SecondaryButton size="sm" type="button" onClick={handleSaveNotes} disabled={savingNotes}>
                      {savingNotes ? 'Saving...' : 'Save Review Notes'}
                    </SecondaryButton>
                  </section>
                </div>
              )}

              {/* TAB 4: TIMELINE */}
              {viewTab === 'timeline' && (
                <section className="space-y-3">
                  <h3 className="font-semibold text-[var(--text-primary)]">
                    Trade Event Timeline ({eventsForTrade.length})
                  </h3>
                  <Timeline
                    timezone={timezone}
                    items={eventsForTrade.map((ev) => ({
                      id: ev.id,
                      timestamp: ev.timestamp,
                      label: TRADE_EVENT_LABELS[ev.eventType] ?? ev.eventType,
                      description: ev.description,
                    }))}
                    emptyLabel="No trade events recorded."
                  />
                </section>
              )}

              {/* TAB 5: ATTACHMENTS */}
              {viewTab === 'attachments' && (
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold text-[var(--text-primary)]">
                      Screenshots ({attachments.length})
                    </h3>
                    <label className="text-xs text-[var(--info)] hover:underline cursor-pointer">
                      {uploading ? 'Uploading...' : '+ Add Post-Trade Screenshot'}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={uploading}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          setUploading(true);
                          setActionError(null);
                          try {
                            await uploadAttachment(
                              userId,
                              'trade',
                              trade.id,
                              'post_trade' as AttachmentCategory,
                              file
                            );
                            refreshDiagnostics();
                          } catch (err) {
                            setActionError(
                              err instanceof Error ? err.message : 'Failed to upload screenshot.'
                            );
                            refreshDiagnostics();
                          } finally {
                            setUploading(false);
                            e.target.value = '';
                          }
                        }}
                      />
                    </label>
                  </div>
                  {attachments.length === 0 ? (
                    <p className="text-[var(--text-muted)]">No screenshots attached to this trade.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {attachments.map((att) => (
                        <div
                          key={att.id}
                          className="rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--subtle-surface)]"
                        >
                          {urls[att.id] ? (
                            <img
                              src={urls[att.id]}
                              alt={att.fileName}
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              className="w-full h-40 object-cover bg-[var(--canvas)]"
                            />
                          ) : (
                            <div className="w-full h-40 flex items-center justify-center text-[var(--text-muted)]">
                              Loading screenshot...
                            </div>
                          )}
                          <div className="px-3 py-2 flex items-center justify-between gap-2">
                            <span className="truncate">
                              {ATTACHMENT_CATEGORY_LABELS[att.category]} · {att.fileName}
                            </span>
                            <button
                              type="button"
                              onClick={async () => {
                                setActionError(null);
                                try {
                                  await deleteAttachmentIfUnreferenced(userId, att, allAttachments);
                                } catch (err) {
                                  setActionError(
                                    err instanceof Error ? err.message : 'Failed to remove screenshot.'
                                  );
                                  refreshDiagnostics();
                                }
                              }}
                              className="text-[var(--negative)] hover:underline shrink-0 cursor-pointer"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </Drawer>

      <ConfirmationDialog
        open={confirmMode !== 'none'}
        onCancel={() => !deleting && setConfirmMode('none')}
        onConfirm={handleConfirmDialogAction}
        title={
          confirmMode === 'trash_group'
            ? 'Move Linked Group to Trash?'
            : 'Permanently Delete This Trade?'
        }
        message={
          confirmMode === 'trash_group'
            ? `Move ${trade.instrument} (${TRADE_DIRECTION_LABELS[trade.direction]}) across all ${
                siblingTrades.length + 1
              } linked accounts to Trash? You can restore them individually or together later.`
            : `Permanently purge ${trade.instrument} (${TRADE_DIRECTION_LABELS[trade.direction]}) on ${trade.date} for ${trade.accountName} along with its trade events and screenshots? This cannot be undone.`
        }
        confirmLabel={confirmMode === 'trash_group' ? 'Move Group to Trash' : 'Delete Permanently'}
        destructive
        busy={deleting}
      />
    </>
  );
}
