import React, { useEffect, useMemo, useState } from 'react';
import {
  ATTACHMENT_CATEGORY_LABELS,
  AttachmentCategory,
  EXIT_OUTCOME_LABELS,
  EXIT_REASON_LABELS,
  ExitOutcome,
  ExitReason,
  POST_TRADE_EMOTIONS,
  SlStatus,
  TpStatus,
  TRADE_MISTAKES,
  YES_NO_NA_LABELS,
  YesNoNa,
} from '../../domain/enums';
import { AppErrorDiagnostic, Trade } from '../../domain/types';
import { generateRecordId, validateTradeClosure } from '../../domain/validation';
import { useWorkspace } from '../../context/WorkspaceContext';
import {
  closeLinkedTradesAtomically,
  closeTradeAtomically,
  uploadAttachment,
} from '../../storage/repository';
import {
  NumberInput,
  PrimaryButton,
  SecondaryButton,
  SelectInput,
  TextArea,
} from '../ui/Controls';
import { ErrorBanner, Modal } from '../ui/Overlays';

interface TradeClosureModalProps {
  open: boolean;
  trade: Trade | null;
  userId: string;
  onClose: () => void;
  onSuccess: () => void;
  onDiagnosticRecorded: () => void;
}

export function TradeClosureModal({
  open,
  trade,
  userId,
  onClose,
  onSuccess,
  onDiagnosticRecorded,
}: TradeClosureModalProps) {
  const { trades, openTrades } = useWorkspace();

  const liveTrade = useMemo(() => {
    if (!trade) return null;
    return trades.find((t) => t.id === trade.id) ?? trade;
  }, [trade, trades]);

  const targetTrades = useMemo(() => {
    if (!liveTrade) return [];
    if (liveTrade.status === 'closed') return [liveTrade];
    if (!liveTrade.tradeGroupId) return [liveTrade];
    const siblings = openTrades.filter((t) => t.tradeGroupId === liveTrade.tradeGroupId);
    if (siblings.length <= 1) return [liveTrade];
    return [...siblings].sort((a, b) => a.tradeNumberOfDay - b.tradeNumberOfDay);
  }, [liveTrade, openTrades]);

  const isLinkedGroup = targetTrades.length > 1;

  const duplicateAccountIds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of targetTrades) {
      counts.set(t.accountId, (counts.get(t.accountId) ?? 0) + 1);
    }
    const dups = new Set<string>();
    counts.forEach((count, accId) => {
      if (count > 1) dups.add(accId);
    });
    return dups;
  }, [targetTrades]);

  const uniqueAccountCount = useMemo(
    () => new Set(targetTrades.map((t) => t.accountId)).size,
    [targetTrades]
  );

  const getExecutionLabel = (t: Trade) =>
    duplicateAccountIds.has(t.accountId)
      ? `${t.accountName} (#${t.tradeNumberOfDay})`
      : t.accountName;

  const [operationId, setOperationId] = useState('');
  const [exitOutcome, setExitOutcome] = useState<ExitOutcome>('win');
  const [exitReason, setExitReason] = useState<ExitReason>('take_profit');
  const [actualProfitPercent, setActualProfitPercent] = useState<number | ''>('');
  const [actualProfitByTradeId, setActualProfitByTradeId] = useState<Record<string, number | ''>>({});

  const [netPnl, setNetPnl] = useState<number | ''>('');
  const [realisedR, setRealisedR] = useState<number | ''>('');
  const [netPnlByTradeId, setNetPnlByTradeId] = useState<Record<string, number | ''>>({});
  const [realisedRByTradeId, setRealisedRByTradeId] = useState<Record<string, number | ''>>({});

  const [followedPlan, setFollowedPlan] = useState<YesNoNa>('yes');
  const [followedRiskRules, setFollowedRiskRules] = useState<YesNoNa>('yes');
  const [impulsiveEntry, setImpulsiveEntry] = useState<YesNoNa>('no');
  const [exitedPerPlan, setExitedPerPlan] = useState<YesNoNa>('yes');

  const [postTradeEmotion, setPostTradeEmotion] = useState<string>(POST_TRADE_EMOTIONS[0]);
  const [mistakes, setMistakes] = useState<string[]>([]);
  const [lessonsLearned, setLessonsLearned] = useState('');

  const [pendingFiles, setPendingFiles] = useState<Array<{ category: AttachmentCategory; file: File }>>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [diagnosticError, setDiagnosticError] = useState<AppErrorDiagnostic | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [closureCommitted, setClosureCommitted] = useState(false);
  const [committedTradeIds, setCommittedTradeIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Reset form ONLY when opening for a new trade / linked group
  useEffect(() => {
    if (open && trade) {
      setOperationId(generateRecordId('close'));
      setExitOutcome('win');
      setExitReason('take_profit');
      setActualProfitPercent(trade.expectedProfitPercent ?? '');
      const nextProfitMap: Record<string, number | ''> = {};
      const nextNetPnlMap: Record<string, number | ''> = {};
      const nextRealisedRMap: Record<string, number | ''> = {};
      for (const t of targetTrades) {
        nextProfitMap[t.id] = t.expectedProfitPercent ?? '';
        nextNetPnlMap[t.id] = '';
        nextRealisedRMap[t.id] = '';
      }
      setActualProfitByTradeId(nextProfitMap);
      setNetPnl('');
      setRealisedR('');
      setNetPnlByTradeId(nextNetPnlMap);
      setRealisedRByTradeId(nextRealisedRMap);
      setFollowedPlan('yes');
      setFollowedRiskRules('yes');
      setImpulsiveEntry('no');
      setExitedPerPlan('yes');
      setPostTradeEmotion(POST_TRADE_EMOTIONS[0]);
      setMistakes([]);
      setLessonsLearned('');
      setPendingFiles([]);
      setValidationError(null);
      setDiagnosticError(null);
      setAttachmentError(null);
      setClosureCommitted(false);
      setCommittedTradeIds([]);
    }
  }, [open, trade?.id, trade?.tradeGroupId]);

  // Ensure any newly synced sibling trades get initialized defaults without overwriting user edits
  useEffect(() => {
    if (!open || !liveTrade) return;
    setActualProfitByTradeId((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const t of targetTrades) {
        if (!(t.id in next)) {
          next[t.id] = t.expectedProfitPercent ?? '';
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setNetPnlByTradeId((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const t of targetTrades) {
        if (!(t.id in next)) {
          next[t.id] = '';
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setRealisedRByTradeId((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const t of targetTrades) {
        if (!(t.id in next)) {
          next[t.id] = '';
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [open, liveTrade, targetTrades]);

  if (!liveTrade) return null;

  const isAlreadyClosed = !closureCommitted && liveTrade.status === 'closed';

  const toggleMistake = (m: string) => {
    setMistakes((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  };

  const uploadRemainingAttachments = async (
    tradeIds: string[],
    files: Array<{ category: AttachmentCategory; file: File }>
  ): Promise<boolean> => {
    if (files.length === 0) return true;
    const remaining = [...files];
    for (let i = 0; i < files.length; i += 1) {
      const item = files[i];
      try {
        for (const tid of tradeIds) {
          await uploadAttachment(userId, 'trade', tid, item.category, item.file);
        }
        remaining.shift();
      } catch (err) {
        setPendingFiles(remaining);
        onDiagnosticRecorded();
        const reason =
          err instanceof Error
            ? err.message
            : typeof err === 'object' &&
              err !== null &&
              'userMessage' in err &&
              typeof (err as { userMessage?: unknown }).userMessage === 'string'
            ? (err as { userMessage: string }).userMessage
            : String(err);
        setAttachmentError(
          `Trade closure succeeded and is saved in Firestore, but screenshot "${item.file.name}" failed to upload: ${reason}`
        );
        return false;
      }
    }
    setPendingFiles([]);
    setAttachmentError(null);
    return true;
  };

  const handleSubmit = async () => {
    setValidationError(null);
    setDiagnosticError(null);
    setAttachmentError(null);

    if (closureCommitted) {
      setSubmitting(true);
      try {
        const allUploaded = await uploadRemainingAttachments(committedTradeIds, pendingFiles);
        if (allUploaded) {
          onDiagnosticRecorded();
          onSuccess();
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (isAlreadyClosed) {
      setValidationError('This trade is already closed. Close this dialog and inspect the trade record to view or edit closed details.');
      return;
    }

    const primaryProfit = isLinkedGroup
      ? actualProfitByTradeId[targetTrades[0].id]
      : actualProfitPercent;
    const numPrimaryProfit =
      primaryProfit === '' || primaryProfit === undefined ? undefined : Number(primaryProfit);

    const resolvedTpStatus: TpStatus =
      exitReason === 'take_profit' ? 'hit_full' : 'not_used';
    const resolvedSlStatus: SlStatus =
      exitReason === 'stop_loss'
        ? 'hit'
        : exitReason === 'breakeven_exit'
        ? 'trailed_breakeven'
        : 'untouched';

    const check = validateTradeClosure({
      exitOutcome,
      exitReason,
      tpStatus: resolvedTpStatus,
      slStatus: resolvedSlStatus,
      actualProfitPercent: numPrimaryProfit,
      followedPlan,
      followedRiskRules,
      impulsiveEntry,
      exitedPerPlan,
      postTradeEmotion,
      lessonsLearned,
      mistakes,
    });

    const errors = [...check.errors];
    if (isLinkedGroup) {
      for (const t of targetTrades) {
        const val = actualProfitByTradeId[t.id];
        if (val === '' || val === undefined || !Number.isFinite(Number(val))) {
          errors.push(`Actual Profit % is required for ${getExecutionLabel(t)}.`);
        }
        const tNet = netPnlByTradeId[t.id];
        if (tNet !== '' && tNet !== undefined && !Number.isFinite(Number(tNet))) {
          errors.push(`Net P&L for ${getExecutionLabel(t)} must be a finite number.`);
        }
        const tR = realisedRByTradeId[t.id];
        if (tR !== '' && tR !== undefined && !Number.isFinite(Number(tR))) {
          errors.push(`Realised R for ${getExecutionLabel(t)} must be a finite number.`);
        }
      }
    } else {
      const optionalFields: Array<[string, number | '']> = [
        ['Net P&L', netPnl],
        ['Realised R', realisedR],
      ];
      for (const [label, val] of optionalFields) {
        if (val !== '' && !Number.isFinite(Number(val))) {
          errors.push(`${label} must be a finite number.`);
        }
      }
    }

    if (errors.length > 0) {
      setValidationError(errors.join(' '));
      return;
    }

    const sharedFields = {
      exitOutcome,
      exitReason,
      tpStatus: resolvedTpStatus,
      slStatus: resolvedSlStatus,
      followedPlan,
      followedRiskRules,
      impulsiveEntry,
      exitedPerPlan,
      postTradeEmotion,
      mistakes,
      lessonsLearned,
    };

    const tradeIdsToClose = isLinkedGroup ? targetTrades.map((t) => t.id) : [liveTrade.id];

    setSubmitting(true);
    try {
      if (isLinkedGroup) {
        await closeLinkedTradesAtomically(
          userId,
          targetTrades.map((t) => {
            const tNet = netPnlByTradeId[t.id];
            const tR = realisedRByTradeId[t.id];
            return {
              tradeId: t.id,
              closing: {
                ...sharedFields,
                actualProfitPercent: Number(actualProfitByTradeId[t.id]),
                netPnl: tNet === '' || tNet === undefined ? undefined : Number(tNet),
                realisedR: tR === '' || tR === undefined ? undefined : Number(tR),
              },
            };
          }),
          operationId
        );
      } else {
        await closeTradeAtomically(
          userId,
          liveTrade.id,
          {
            ...sharedFields,
            actualProfitPercent: numPrimaryProfit!,
            netPnl: netPnl === '' ? undefined : Number(netPnl),
            realisedR: realisedR === '' ? undefined : Number(realisedR),
          },
          operationId
        );
      }

      setClosureCommitted(true);
      setCommittedTradeIds(tradeIdsToClose);
    } catch (err) {
      onDiagnosticRecorded();
      if (typeof err === 'object' && err !== null && 'operationId' in err) {
        setDiagnosticError(err as AppErrorDiagnostic);
      } else {
        setValidationError(err instanceof Error ? err.message : String(err));
      }
      setSubmitting(false);
      return;
    }

    try {
      const allUploaded = await uploadRemainingAttachments(tradeIdsToClose, pendingFiles);
      if (allUploaded) {
        onDiagnosticRecorded();
        onSuccess();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const modalTitle = isLinkedGroup
    ? `Close Linked Trade (${targetTrades.length} ${uniqueAccountCount > 1 ? 'Accounts' : 'Executions'}) · ${liveTrade.instrument} (${liveTrade.direction.toUpperCase()})`
    : `Close Trade · ${liveTrade.instrument} (${liveTrade.direction.toUpperCase()})`;

  const modalSubtitle = isLinkedGroup
    ? `${targetTrades.map((t) => `${getExecutionLabel(t)} (${t.riskPercent}%)`).join(' + ')} · ${
        liveTrade.isOutOfSession ? 'Out-of-Session' : liveTrade.sessionName ?? 'Session'
      }`
    : `${liveTrade.accountName} · ${liveTrade.isOutOfSession ? 'Out-of-Session' : liveTrade.sessionName ?? 'Session'} · Risk ${liveTrade.riskPercent}%`;

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : closureCommitted ? onSuccess : onClose}
      title={modalTitle}
      subtitle={modalSubtitle}
      maxWidthClass="max-w-3xl"
      footer={
        <>
          <SecondaryButton
            type="button"
            onClick={closureCommitted ? onSuccess : onClose}
            disabled={submitting}
          >
            {closureCommitted ? 'Done (Skip Screenshots)' : 'Cancel'}
          </SecondaryButton>
          <PrimaryButton
            type="button"
            onClick={handleSubmit}
            disabled={submitting || isAlreadyClosed}
          >
            {submitting
              ? closureCommitted
                ? 'Uploading Screenshots...'
                : 'Saving & Confirming...'
              : closureCommitted
              ? 'Retry Screenshot Upload'
              : diagnosticError
              ? 'Retry Save Trade'
              : 'Complete & Save Trade'}
          </PrimaryButton>
        </>
      }
    >
      <div className="space-y-6">
        {isAlreadyClosed && (
          <ErrorBanner
            title="Trade Already Closed"
            message="This trade has already been closed in Firestore. Close this dialog and inspect the trade to review or edit its closed record."
          />
        )}

        {attachmentError && (
          <ErrorBanner
            title="Trade Closed · Screenshot Upload Failed"
            message={attachmentError}
            onRetry={handleSubmit}
          />
        )}

        {validationError && <ErrorBanner title="Validation Required" message={validationError} />}

        {diagnosticError && (
          <ErrorBanner
            title={`Closure Failed (${diagnosticError.errorCategory.toUpperCase()} · ${diagnosticError.firebaseErrorCode})`}
            message={diagnosticError.userMessage}
            details={`Operation ID: ${diagnosticError.operationId}\nStage: ${diagnosticError.failedStage ?? 'unknown'}\nTrade Path: ${diagnosticError.documentPath}\nEvent Path: ${diagnosticError.failedEventPath ?? 'N/A'}\nRecommended: ${diagnosticError.recommendedAction}`}
            onRetry={handleSubmit}
          />
        )}

        {/* Section 1: Trade Outcome */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold text-[var(--text-primary)] pb-1.5 border-b border-[var(--border)]">
            1. Trade Outcome (Percentage-First)
          </h3>
          <div className={`grid grid-cols-1 ${isLinkedGroup ? 'sm:grid-cols-2' : 'sm:grid-cols-3'} gap-3`}>
            <SelectInput
              label="Exit Outcome"
              required
              value={exitOutcome}
              onChange={(v) => setExitOutcome(v as ExitOutcome)}
              options={[
                { value: 'win', label: EXIT_OUTCOME_LABELS.win },
                { value: 'loss', label: EXIT_OUTCOME_LABELS.loss },
                { value: 'breakeven', label: EXIT_OUTCOME_LABELS.breakeven },
              ]}
            />
            <SelectInput
              label="Exit Reason"
              required
              value={exitReason}
              onChange={(v) => setExitReason(v as ExitReason)}
              options={[
                { value: 'take_profit', label: EXIT_REASON_LABELS.take_profit },
                { value: 'stop_loss', label: EXIT_REASON_LABELS.stop_loss },
                { value: 'manual_exit', label: EXIT_REASON_LABELS.manual_exit },
                { value: 'breakeven_exit', label: EXIT_REASON_LABELS.breakeven_exit },
                { value: 'other', label: EXIT_REASON_LABELS.other },
              ]}
            />
            {!isLinkedGroup && (
              <NumberInput
                label="Actual Profit %"
                required
                value={actualProfitPercent}
                onChange={(val) => {
                  setActualProfitPercent(val);
                  setActualProfitByTradeId((prev) => ({ ...prev, [liveTrade.id]: val }));
                }}
                placeholder="e.g. 2.5 or -1.0"
              />
            )}
          </div>
          {isLinkedGroup && (
            <div className="p-3 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)] space-y-2.5">
              <div className="text-xs font-medium text-[var(--text-primary)]">
                Profit Target / Actual Profit % per Connected Execution
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {targetTrades.map((t) => (
                  <NumberInput
                    key={t.id}
                    label={`${getExecutionLabel(t)} — Actual Profit %`}
                    required
                    value={t.id in actualProfitByTradeId ? actualProfitByTradeId[t.id] : ''}
                    onChange={(val) => {
                      setActualProfitByTradeId((prev) => ({ ...prev, [t.id]: val }));
                      if (t.id === liveTrade.id) {
                        setActualProfitPercent(val);
                      }
                    }}
                    placeholder={String(t.expectedProfitPercent)}
                    labelAction={
                      <span className="text-[11px] font-mono-num text-[var(--text-muted)]">
                        Risk {t.riskPercent}% · Target {t.expectedProfitPercent}%
                      </span>
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Section 2: Optional Price & Monetary Details */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold text-[var(--text-primary)] pb-1.5 border-b border-[var(--border)]">
            2. Optional Monetary &amp; Price Details
          </h3>
          {isLinkedGroup ? (
            <div className="space-y-2.5">
              {targetTrades.map((t) => (
                <div
                  key={t.id}
                  className="p-3 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)] space-y-2"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-[var(--text-primary)]">
                      {getExecutionLabel(t)}
                    </span>
                    <span className="text-[11px] font-mono-num text-[var(--text-muted)]">
                      Risk {t.riskPercent}%{t.currency ? ` · ${t.currency}` : ''}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <NumberInput
                      label={`Net P&L${t.currency ? ` (${t.currency})` : ''}`}
                      value={t.id in netPnlByTradeId ? netPnlByTradeId[t.id] : ''}
                      onChange={(val) => {
                        setNetPnlByTradeId((prev) => ({ ...prev, [t.id]: val }));
                        if (t.id === liveTrade.id) {
                          setNetPnl(val);
                        }
                      }}
                    />
                    <NumberInput
                      label="Realised R"
                      value={t.id in realisedRByTradeId ? realisedRByTradeId[t.id] : ''}
                      onChange={(val) => {
                        setRealisedRByTradeId((prev) => ({ ...prev, [t.id]: val }));
                        if (t.id === liveTrade.id) {
                          setRealisedR(val);
                        }
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <NumberInput
                label={`Net P&L${liveTrade.currency ? ` (${liveTrade.currency})` : ''}`}
                value={netPnl}
                onChange={(val) => {
                  setNetPnl(val);
                  setNetPnlByTradeId((prev) => ({ ...prev, [liveTrade.id]: val }));
                }}
              />
              <NumberInput
                label="Realised R"
                value={realisedR}
                onChange={(val) => {
                  setRealisedR(val);
                  setRealisedRByTradeId((prev) => ({ ...prev, [liveTrade.id]: val }));
                }}
              />
            </div>
          )}
        </section>

        {/* Section 3: Discipline Questions */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold text-[var(--text-primary)] pb-1.5 border-b border-[var(--border)]">
            3. Execution Discipline
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(
              [
                ['Followed Plan', followedPlan, setFollowedPlan],
                ['Followed Risk Rules', followedRiskRules, setFollowedRiskRules],
                ['Impulsive Entry', impulsiveEntry, setImpulsiveEntry],
                ['Exited Per Plan', exitedPerPlan, setExitedPerPlan],
              ] as const
            ).map(([label, val, setter]) => (
              <SelectInput
                key={label}
                label={label}
                required
                value={val}
                onChange={(v) => setter(v as YesNoNa)}
                options={(['yes', 'no', 'na'] as YesNoNa[]).map((k) => ({
                  value: k,
                  label: YES_NO_NA_LABELS[k],
                }))}
              />
            ))}
          </div>
        </section>

        {/* Section 4: Psychology, Mistakes, Lessons */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold text-[var(--text-primary)] pb-1.5 border-b border-[var(--border)]">
            4. Psychology, Mistakes &amp; Lessons Learned
          </h3>
          <SelectInput
            label="Post-Trade Emotion"
            required
            value={postTradeEmotion}
            onChange={setPostTradeEmotion}
            options={POST_TRADE_EMOTIONS.map((e) => ({ value: e, label: e }))}
          />
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Mistakes (select all that apply)</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {TRADE_MISTAKES.map((m) => {
                const checked = mistakes.includes(m);
                return (
                  <label
                    key={m}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                      checked
                        ? 'border-[var(--negative)] bg-[var(--negative-bg)] text-[var(--text-primary)]'
                        : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleMistake(m)}
                      className="accent-[var(--negative)]"
                    />
                    <span className="truncate">{m}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <TextArea
            label="Lessons Learned"
            value={lessonsLearned}
            onChange={(e) => setLessonsLearned(e.target.value)}
            placeholder="Key execution takeaway from this trade..."
            rows={2}
          />
        </section>

        {/* Section 5: Screenshots */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold text-[var(--text-primary)] pb-1.5 border-b border-[var(--border)]">
            5. Screenshots (Private Storage)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(['before_entry', 'entry', 'exit', 'post_trade'] as AttachmentCategory[]).map((cat) => (
              <label
                key={cat}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--subtle-surface)] text-xs cursor-pointer"
              >
                <span className="font-medium text-[var(--text-secondary)]">
                  {ATTACHMENT_CATEGORY_LABELS[cat]}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setPendingFiles((prev) => [...prev, { category: cat, file }]);
                    }
                  }}
                  className="text-[11px] max-w-[170px]"
                />
              </label>
            ))}
          </div>
          {pendingFiles.length > 0 && (
            <div className="text-xs text-[var(--text-secondary)] space-y-1">
              {pendingFiles.map((p, idx) => (
                <div key={`${p.file.name}-${idx}`} className="flex items-center justify-between">
                  <span>
                    {ATTACHMENT_CATEGORY_LABELS[p.category]}: {p.file.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-[var(--negative)] hover:underline cursor-pointer"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
