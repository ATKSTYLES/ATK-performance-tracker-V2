import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import {
  DatePicker,
  FieldWrapper,
  PrimaryButton,
  RangeSlider,
  SecondaryButton,
  SegmentedControl,
  TextArea,
  TextInput,
} from '../components/ui/Controls';
import { EmptyState, PageHeader } from '../components/ui/DataDisplay';
import { ConfirmationDialog, ErrorBanner } from '../components/ui/Overlays';
import { useWorkspace } from '../context/WorkspaceContext';
import { ReviewType } from '../domain/enums';
import { getTodayInTimezone } from '../domain/timezone';
import { TradingReview } from '../domain/types';
import { generateRecordId } from '../domain/validation';
import { createRecord, deleteRecord, updateRecord } from '../storage/repository';

type ActiveReviewType = 'weekly' | 'monthly';

const REVIEW_TYPE_LABELS: Record<ReviewType, string> = {
  daily: 'Daily Review',
  weekly: 'Weekly Review',
  monthly: 'Monthly Review',
  strategy: 'Strategy Review',
};

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parseDateParts(dateStr: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) {
    const now = new Date();
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
  }
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function formatUtcDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function formatShortDate(d: Date): string {
  return `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

interface ComputedPeriod {
  startDate: string;
  endDate: string;
  monthValue: string;
  label: string;
  rangeSummary: string;
}

/**
 * Computes the Monday -> Sunday trading week for any YYYY-MM-DD date.
 * The review date is automatically anchored to Sunday (the end of that week).
 */
function computeWeeklyPeriod(anchorDateStr: string): ComputedPeriod {
  const { year, month, day } = parseDateParts(anchorDateStr);
  const anchor = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = anchor.getUTCDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const start = new Date(anchor.getTime() - daysFromMonday * 86400000);
  const end = new Date(start.getTime() + 6 * 86400000); // Sunday

  const startDate = formatUtcDateStr(start);
  const endDate = formatUtcDateStr(end);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const label = sameYear
    ? `Weekly Review (${formatShortDate(start)} – ${formatShortDate(end)}, ${end.getUTCFullYear()})`
    : `Weekly Review (${formatShortDate(start)}, ${start.getUTCFullYear()} – ${formatShortDate(end)}, ${end.getUTCFullYear()})`;

  return {
    startDate,
    endDate,
    monthValue: endDate.slice(0, 7),
    label,
    rangeSummary: `Mon ${formatShortDate(start)} – Sun ${formatShortDate(end)}, ${end.getUTCFullYear()}`,
  };
}

/**
 * Computes the exact first and last calendar day (28/29/30/31) for any YYYY-MM or YYYY-MM-DD value.
 * The review date is automatically anchored to the last day of the month.
 */
function computeMonthlyPeriod(anchorDateOrMonth: string): ComputedPeriod {
  const normalized = anchorDateOrMonth.length === 7 ? `${anchorDateOrMonth}-01` : anchorDateOrMonth;
  const { year, month } = parseDateParts(normalized);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0)); // Day 0 of next month = exact last day of this month

  const startDate = formatUtcDateStr(start);
  const endDate = formatUtcDateStr(end);
  const monthName = FULL_MONTHS[month - 1];
  const shortMonth = SHORT_MONTHS[month - 1];

  return {
    startDate,
    endDate,
    monthValue: `${year}-${pad2(month)}`,
    label: `${monthName} ${year} (${shortMonth} 1 – ${shortMonth} ${end.getUTCDate()})`,
    rangeSummary: `${shortMonth} 1 – ${shortMonth} ${end.getUTCDate()}, ${year} (Month End: ${endDate})`,
  };
}

function shiftPeriod(type: ActiveReviewType, currentEndDate: string, delta: number): ComputedPeriod {
  const { year, month, day } = parseDateParts(currentEndDate);
  if (type === 'weekly') {
    const shifted = new Date(Date.UTC(year, month - 1, day + delta * 7));
    return computeWeeklyPeriod(formatUtcDateStr(shifted));
  }
  const shiftedMonth = new Date(Date.UTC(year, month - 1 + delta, 1));
  return computeMonthlyPeriod(formatUtcDateStr(shiftedMonth));
}

function computePeriodForType(type: ActiveReviewType, referenceDate: string): ComputedPeriod {
  return type === 'weekly' ? computeWeeklyPeriod(referenceDate) : computeMonthlyPeriod(referenceDate);
}

export function ReviewsPage() {
  const { user, reviews, timezone, refreshDiagnostics } = useWorkspace();
  const uid = user?.uid ?? '';
  const today = getTodayInTimezone(timezone);

  const initialPeriod = useMemo(() => computeWeeklyPeriod(today), [today]);

  const [filterType, setFilterType] = useState<'all' | ActiveReviewType>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reviewType, setReviewType] = useState<ActiveReviewType>('weekly');
  const [periodLabel, setPeriodLabel] = useState<string>(initialPeriod.label);
  const [date, setDate] = useState<string>(initialPeriod.endDate);
  const [summary, setSummary] = useState('');
  const [tradingMistakes, setTradingMistakes] = useState('');
  const [lessonsLearned, setLessonsLearned] = useState('');
  const [preservedBehaviouralPatterns, setPreservedBehaviouralPatterns] = useState('');
  const [improvementGoals, setImprovementGoals] = useState('');
  const [rating, setRating] = useState<number>(8);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TradingReview | null>(null);

  const activePeriod = useMemo(() => computePeriodForType(reviewType, date), [reviewType, date]);

  const applyPeriod = (nextType: ActiveReviewType, referenceDate: string) => {
    const computed = computePeriodForType(nextType, referenceDate);
    setReviewType(nextType);
    setDate(computed.endDate);
    setPeriodLabel(computed.label);
  };

  const resetForm = (nextType: ActiveReviewType = 'weekly') => {
    const computed = computePeriodForType(nextType, today);
    setEditingId(null);
    setReviewType(nextType);
    setPeriodLabel(computed.label);
    setDate(computed.endDate);
    setSummary('');
    setTradingMistakes('');
    setLessonsLearned('');
    setPreservedBehaviouralPatterns('');
    setImprovementGoals('');
    setRating(8);
    setErrorMsg(null);
  };

  const loadForEdit = (rev: TradingReview) => {
    const normalizedType: ActiveReviewType = rev.reviewType === 'monthly' ? 'monthly' : 'weekly';
    setEditingId(rev.id);
    setReviewType(normalizedType);
    setPeriodLabel(rev.periodLabel);
    setDate(rev.date);
    setSummary(rev.summary);
    setTradingMistakes(rev.tradingMistakes);
    setLessonsLearned(rev.lessonsLearned);
    setPreservedBehaviouralPatterns(rev.behaviouralPatterns ?? '');
    setImprovementGoals(rev.improvementGoals);
    setRating(Math.min(10, Math.max(1, rev.rating || 8)));
    setErrorMsg(null);
  };

  const handleSave = async () => {
    if (!uid || saving) return;
    const computed = computePeriodForType(reviewType, date);
    const finalLabel = (periodLabel.trim() || computed.label).slice(0, 100);
    const finalDate = computed.endDate;

    setSaving(true);
    setErrorMsg(null);
    try {
      const payload = {
        reviewType,
        periodLabel: finalLabel,
        date: finalDate,
        summary: summary.trim().slice(0, 4000),
        tradingMistakes: tradingMistakes.trim().slice(0, 4000),
        lessonsLearned: lessonsLearned.trim().slice(0, 4000),
        behaviouralPatterns: preservedBehaviouralPatterns.trim().slice(0, 4000),
        improvementGoals: improvementGoals.trim().slice(0, 4000),
        rating: Math.min(10, Math.max(1, Math.round(Number(rating) || 1))),
      };
      if (editingId) {
        await updateRecord(uid, 'reviews', editingId, payload, 'Reviews');
      } else {
        await createRecord(uid, 'reviews', generateRecordId('rev'), payload, 'Reviews');
      }
      resetForm(reviewType);
      refreshDiagnostics();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save review.');
      refreshDiagnostics();
    } finally {
      setSaving(false);
    }
  };

  const visibleReviews = useMemo(() => {
    return reviews
      .filter((r) => filterType === 'all' || r.reviewType === filterType)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [reviews, filterType]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reviews"
        subtitle="Structured Weekly and Monthly performance reflections with automatic period-end calculation."
        actions={
          <SecondaryButton size="sm" type="button" onClick={() => resetForm(reviewType)}>
            <Plus className="w-3.5 h-3.5" />
            New Review
          </SecondaryButton>
        }
      />

      {errorMsg && <ErrorBanner title="Review Save Failed" message={errorMsg} />}

      {/* Editor */}
      <section className="p-5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {editingId ? 'Edit Review' : 'Create Review'}
            </h2>
            <SegmentedControl
              value={reviewType}
              onChange={(next) => applyPeriod(next, date)}
              options={[
                { value: 'weekly', label: 'Weekly Review' },
                { value: 'monthly', label: 'Monthly Review' },
              ]}
            />
          </div>
          {editingId && (
            <button
              type="button"
              onClick={() => resetForm(reviewType)}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              Cancel Edit
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
          {reviewType === 'weekly' ? (
            <FieldWrapper
              label="Week End Date (Auto Sunday)"
              hint={activePeriod.rangeSummary}
            >
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const next = shiftPeriod('weekly', date, -1);
                    setDate(next.endDate);
                    setPeriodLabel(next.label);
                  }}
                  aria-label="Previous week"
                  className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--subtle-surface)] cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex-1 min-w-0">
                  <DatePicker
                    value={date}
                    onChange={(picked) => {
                      if (!picked) return;
                      const computed = computeWeeklyPeriod(picked);
                      setDate(computed.endDate);
                      setPeriodLabel(computed.label);
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = shiftPeriod('weekly', date, 1);
                    setDate(next.endDate);
                    setPeriodLabel(next.label);
                  }}
                  aria-label="Next week"
                  className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--subtle-surface)] cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </FieldWrapper>
          ) : (
            <FieldWrapper
              label="Month (Auto Last Day)"
              hint={activePeriod.rangeSummary}
            >
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const next = shiftPeriod('monthly', date, -1);
                    setDate(next.endDate);
                    setPeriodLabel(next.label);
                  }}
                  aria-label="Previous month"
                  className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--subtle-surface)] cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <input
                  type="month"
                  value={activePeriod.monthValue}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const computed = computeMonthlyPeriod(e.target.value);
                    setDate(computed.endDate);
                    setPeriodLabel(computed.label);
                  }}
                  className="flex-1 min-w-0 h-9 px-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-sm font-mono-num text-[var(--text-primary)] focus:outline-none focus:border-[var(--text-primary)] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => {
                    const next = shiftPeriod('monthly', date, 1);
                    setDate(next.endDate);
                    setPeriodLabel(next.label);
                  }}
                  aria-label="Next month"
                  className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--subtle-surface)] cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </FieldWrapper>
          )}

          <TextInput
            label="Period Label"
            required
            value={periodLabel}
            onChange={(e) => setPeriodLabel(e.target.value)}
            placeholder={
              reviewType === 'weekly'
                ? 'Auto-filled from selected week'
                : 'Auto-filled from selected month'
            }
          />

          <RangeSlider
            label="Rating"
            min={1}
            max={10}
            step={1}
            value={rating}
            onChange={setRating}
            valueLabel={`${rating}/10`}
          />
        </div>

        {/* Structured Reflection Boxes: Summary -> Trading Mistakes -> Lessons Learned -> Improvement Goals */}
        <div className="space-y-3">
          <TextArea
            label="Summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Overall performance overview, execution quality, and key market conditions..."
            rows={3}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextArea
              label="Trading Mistakes"
              value={tradingMistakes}
              onChange={(e) => setTradingMistakes(e.target.value)}
              placeholder="Rule violations, premature exits, overtrading, or discipline lapses..."
              rows={3}
            />
            <TextArea
              label="Lessons Learned"
              value={lessonsLearned}
              onChange={(e) => setLessonsLearned(e.target.value)}
              placeholder="Actionable takeaways and patterns that worked well..."
              rows={3}
            />
          </div>

          <TextArea
            label="Improvement Goals"
            value={improvementGoals}
            onChange={(e) => setImprovementGoals(e.target.value)}
            placeholder="Concrete rules and execution focus for the next period..."
            rows={3}
          />
        </div>

        <div className="flex justify-end">
          <PrimaryButton type="button" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving...' : editingId ? 'Update Review' : 'Save Review'}
          </PrimaryButton>
        </div>
      </section>

      {/* Historical List */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            Saved Reviews ({visibleReviews.length})
          </h2>
          <SegmentedControl
            value={filterType}
            onChange={setFilterType}
            options={[
              { value: 'all', label: 'All' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'monthly', label: 'Monthly' },
            ]}
          />
        </div>

        {visibleReviews.length === 0 ? (
          <EmptyState
            title="No Reviews Recorded"
            description="Write your first Weekly or Monthly review above."
          />
        ) : (
          <div className="space-y-3">
            {visibleReviews.map((rev) => (
              <div
                key={rev.id}
                className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm text-[var(--text-primary)]">
                      {rev.periodLabel}
                    </span>
                    <span className="text-[var(--text-muted)]">·</span>
                    <span className="text-[var(--text-secondary)]">
                      {REVIEW_TYPE_LABELS[rev.reviewType]}
                    </span>
                    <span className="text-[var(--text-muted)]">·</span>
                    <span className="font-mono-num text-[var(--text-muted)]">End {rev.date}</span>
                    <span className="text-[var(--text-muted)]">·</span>
                    <span className="font-mono-num font-semibold">Rating {rev.rating}/10</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <SecondaryButton size="sm" type="button" onClick={() => loadForEdit(rev)}>
                      Edit
                    </SecondaryButton>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(rev)}
                      className="p-1.5 rounded text-[var(--negative)] hover:bg-[var(--negative-bg)] cursor-pointer"
                      aria-label="Delete review"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {rev.summary && (
                  <p className="text-[var(--text-secondary)]">
                    <strong className="text-[var(--text-primary)]">Summary:</strong> {rev.summary}
                  </p>
                )}
                {rev.tradingMistakes && (
                  <p className="text-[var(--text-secondary)]">
                    <strong className="text-[var(--text-primary)]">Mistakes:</strong> {rev.tradingMistakes}
                  </p>
                )}
                {rev.lessonsLearned && (
                  <p className="text-[var(--text-secondary)]">
                    <strong className="text-[var(--text-primary)]">Lessons:</strong> {rev.lessonsLearned}
                  </p>
                )}
                {rev.improvementGoals && (
                  <p className="text-[var(--text-secondary)]">
                    <strong className="text-[var(--text-primary)]">Improvement Goals:</strong> {rev.improvementGoals}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <ConfirmationDialog
        open={Boolean(confirmDelete)}
        onCancel={() => !deleting && setConfirmDelete(null)}
        onConfirm={async () => {
          if (!confirmDelete || !uid || deleting) return;
          setDeleting(true);
          setErrorMsg(null);
          try {
            await deleteRecord(uid, 'reviews', confirmDelete.id, 'Reviews');
            setConfirmDelete(null);
            refreshDiagnostics();
          } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Failed to delete review.');
            setConfirmDelete(null);
            refreshDiagnostics();
          } finally {
            setDeleting(false);
          }
        }}
        title="Delete Review"
        message={`Permanently delete review "${confirmDelete?.periodLabel ?? ''}"?`}
        confirmLabel="Delete Review"
        destructive
        busy={deleting}
      />
    </div>
  );
}
