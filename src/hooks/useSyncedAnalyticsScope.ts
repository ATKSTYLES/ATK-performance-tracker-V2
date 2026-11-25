import { useCallback, useEffect, useState } from 'react';
import { DateRangePreset } from '../domain/calculations';
import { shiftDateStr } from '../domain/timezone';

export interface SyncedAnalyticsScopeState {
  rangePreset: DateRangePreset;
  customStart: string;
  customEnd: string;
  accountId: string;
}

type Listener = () => void;

let sharedState: SyncedAnalyticsScopeState | null = null;
const listeners = new Set<Listener>();

function ensureState(today: string): SyncedAnalyticsScopeState {
  if (!sharedState) {
    sharedState = {
      rangePreset: 'all',
      customStart: shiftDateStr(today, -30),
      customEnd: today,
      accountId: 'all',
    };
  }
  return sharedState;
}

function updateSharedState(patch: Partial<SyncedAnalyticsScopeState>, today: string) {
  sharedState = {
    ...ensureState(today),
    ...patch,
  };
  listeners.forEach((listener) => listener());
}

/**
 * Keeps Dashboard and Analytics strictly synchronized on the exact same
 * date range preset, custom window, and account filter as the user switches pages.
 * Defaults to 'all' so both views match Daily / Session Records (All Dates) out of the box.
 */
export function useSyncedAnalyticsScope(today: string) {
  const [state, setState] = useState<SyncedAnalyticsScopeState>(() => ensureState(today));

  useEffect(() => {
    const onChange = () => {
      setState(ensureState(today));
    };
    listeners.add(onChange);
    onChange();
    return () => {
      listeners.delete(onChange);
    };
  }, [today]);

  const setRangePreset = useCallback(
    (rangePreset: DateRangePreset) => updateSharedState({ rangePreset }, today),
    [today]
  );

  const setCustomStart = useCallback(
    (customStart: string) => updateSharedState({ customStart }, today),
    [today]
  );

  const setCustomEnd = useCallback(
    (customEnd: string) => updateSharedState({ customEnd }, today),
    [today]
  );

  const setAccountId = useCallback(
    (accountId: string) => updateSharedState({ accountId }, today),
    [today]
  );

  return {
    rangePreset: state.rangePreset,
    customStart: state.customStart,
    customEnd: state.customEnd,
    accountId: state.accountId,
    setRangePreset,
    setCustomStart,
    setCustomEnd,
    setAccountId,
  };
}
