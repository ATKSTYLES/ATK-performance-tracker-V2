import { DEFAULT_TIMEZONE } from './enums.ts';
import type { SessionTemplate } from './types.ts';

export function getTodayInTimezone(timezone: string = DEFAULT_TIMEZONE): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const year = parts.find((p) => p.type === 'year')?.value ?? '2026';
    const month = parts.find((p) => p.type === 'month')?.value ?? '01';
    const day = parts.find((p) => p.type === 'day')?.value ?? '01';
    return `${year}-${month}-${day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function getCurrentTimeInTimezone(timezone: string = DEFAULT_TIMEZONE): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
    return `${hour === '24' ? '00' : hour}:${minute}`;
  } catch {
    return new Date().toISOString().slice(11, 16);
  }
}

export function timeStringToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return -1;
  return h * 60 + m;
}

export function split24HourTo12Hour(hhmm: string): {
  hour12: number;
  minute: number;
  period: 'AM' | 'PM';
} {
  const match = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  if (!match) {
    return { hour12: 9, minute: 0, period: 'AM' };
  }
  const h24 = Math.min(23, Math.max(0, Number(match[1])));
  const minute = Math.min(59, Math.max(0, Number(match[2])));
  const period: 'AM' | 'PM' = h24 >= 12 ? 'PM' : 'AM';
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { hour12, minute, period };
}

export function parse12HourTo24Hour(
  hour12: number,
  minute: number,
  period: 'AM' | 'PM'
): string {
  const hClamped = Math.min(12, Math.max(1, Math.floor(hour12)));
  const mClamped = Math.min(59, Math.max(0, Math.floor(minute)));
  let h24 = hClamped % 12;
  if (period === 'PM') {
    h24 += 12;
  }
  return `${String(h24).padStart(2, '0')}:${String(mClamped).padStart(2, '0')}`;
}

export function formatTime12Hour(hhmm?: string): string {
  if (!hhmm) return '—';
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return hhmm;
  const { hour12, minute, period } = split24HourTo12Hour(hhmm);
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

/**
 * Uses half-open time intervals [start, end) to detect the current session template
 * without overlaps.
 */
export function detectCurrentSessionTemplate(
  templates: SessionTemplate[],
  timezone: string = DEFAULT_TIMEZONE,
  overrideTime?: string
): SessionTemplate | null {
  const currentHHMM = overrideTime ?? getCurrentTimeInTimezone(timezone);
  const nowMinutes = timeStringToMinutes(currentHHMM);
  if (nowMinutes < 0) return null;

  const active = templates
    .filter((t) => t.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  for (const tpl of active) {
    const start = timeStringToMinutes(tpl.startTime);
    const end = timeStringToMinutes(tpl.endTime);
    if (start < 0 || end < 0) continue;

    if (start < end) {
      if (nowMinutes >= start && nowMinutes < end) {
        return tpl;
      }
    } else if (start > end) {
      // Wraps midnight: [start, 1440) U [0, end)
      if (nowMinutes >= start || nowMinutes < end) {
        return tpl;
      }
    }
  }
  return null;
}

export function checkTemplatesOverlap(templates: Array<{ id: string; startTime: string; endTime: string; isActive: boolean }>): string | null {
  const active = templates.filter((t) => t.isActive);
  for (let i = 0; i < active.length; i++) {
    const aStart = timeStringToMinutes(active[i].startTime);
    const aEnd = timeStringToMinutes(active[i].endTime);
    if (aStart < 0 || aEnd < 0 || aStart === aEnd) {
      return 'Invalid template start or end time.';
    }
    for (let j = i + 1; j < active.length; j++) {
      const bStart = timeStringToMinutes(active[j].startTime);
      const bEnd = timeStringToMinutes(active[j].endTime);
      if (aStart < aEnd && bStart < bEnd) {
        // Half-open [aStart, aEnd) and [bStart, bEnd) overlap iff aStart < bEnd && bStart < aEnd
        if (aStart < bEnd && bStart < aEnd) {
          return 'Active session templates must not overlap.';
        }
      }
    }
  }
  return null;
}

export function shiftDateStr(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

export function formatDisplayDate(dateStr: string): string {
  if (!dateStr || dateStr.length !== 10) return dateStr;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(dt);
}

export function formatTimestampInTimezone(iso: string | undefined, timezone: string = DEFAULT_TIMEZONE): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(dt);
  } catch {
    const hh = dt.getUTCHours();
    const mm = String(dt.getUTCMinutes()).padStart(2, '0');
    const ss = String(dt.getUTCSeconds()).padStart(2, '0');
    const period = hh >= 12 ? 'PM' : 'AM';
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${h12}:${mm}:${ss} ${period}`;
  }
}

export function formatDurationMinutes(startIso?: string, endIso?: string): string {
  if (!startIso) return '0m';
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '0m';
  const totalSeconds = Math.floor((end - start) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export function formatTimerHMS(startIso?: string, nowMs: number = Date.now()): string {
  if (!startIso) return '00:00:00';
  const start = new Date(startIso).getTime();
  if (Number.isNaN(start) || nowMs < start) return '00:00:00';
  const total = Math.floor((nowMs - start) / 1000);
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Generates a 7-column (Mon-Sun) calendar matrix for the given YYYY-MM month.
 */
export function buildMondayCalendarGrid(yearMonth: string): Array<{ date: string; inMonth: boolean }> {
  const [year, month] = yearMonth.split('-').map(Number);
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const lastDay = new Date(Date.UTC(year, month, 0));
  // JS getUTCDay(): 0=Sun, 1=Mon..6=Sat -> Monday index: (day + 6) % 7
  const startOffset = (firstDay.getUTCDay() + 6) % 7;
  const totalDays = lastDay.getUTCDate();
  const cells: Array<{ date: string; inMonth: boolean }> = [];

  for (let i = -startOffset; i < totalDays; i++) {
    const dt = new Date(Date.UTC(year, month - 1, 1 + i));
    cells.push({
      date: dt.toISOString().slice(0, 10),
      inMonth: i >= 0 && i < totalDays,
    });
  }

  while (cells.length % 7 !== 0) {
    const lastCellDate = cells[cells.length - 1].date;
    cells.push({
      date: shiftDateStr(lastCellDate, 1),
      inMonth: false,
    });
  }

  return cells;
}

export const COMMON_TIMEZONES = [
  'Asia/Kolkata',
  'UTC',
  'Europe/London',
  'America/New_York',
  'America/Chicago',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Dubai',
  'Australia/Sydney',
  'Europe/Berlin',
];
