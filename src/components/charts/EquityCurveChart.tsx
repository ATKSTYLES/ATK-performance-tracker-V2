import React from 'react';
import { EquityPoint } from '../../domain/calculations';

interface EquityCurveChartProps {
  points: EquityPoint[];
  height?: number;
}

export function EquityCurveChart({ points, height = 220 }: EquityCurveChartProps) {
  if (points.length === 0) {
    return (
      <div className="h-[180px] flex items-center justify-center text-xs text-[var(--text-muted)] border border-dashed border-[var(--border)] rounded-lg">
        No closed trades in this period yet. Equity curve updates automatically when trades close.
      </div>
    );
  }

  const width = 760;
  const padLeft = 52;
  const padRight = 24;
  const padTop = 20;
  const padBottom = 28;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const series = [
    { index: 0, date: points[0].date, cumulativePercent: 0, instrument: 'Start' },
    ...points,
  ];

  const values = series.map((p) => p.cumulativePercent);
  const minVal = Math.min(0, ...values);
  const maxVal = Math.max(0, ...values);
  const range = maxVal - minVal || 1;

  const xFor = (i: number) =>
    padLeft + (series.length === 1 ? plotW / 2 : (i / (series.length - 1)) * plotW);
  const yFor = (val: number) => padTop + ((maxVal - val) / range) * plotH;

  const zeroY = yFor(0);
  const pathD = series
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${xFor(idx).toFixed(1)} ${yFor(p.cumulativePercent).toFixed(1)}`)
    .join(' ');

  const latest = series[series.length - 1].cumulativePercent;
  const strokeColor = latest >= 0 ? 'var(--positive)' : 'var(--negative)';

  const minPoint = series.reduce((a, b) => (b.cumulativePercent < a.cumulativePercent ? b : a), series[0]);
  const maxPoint = series.reduce((a, b) => (b.cumulativePercent > a.cumulativePercent ? b : a), series[0]);

  return (
    <div className="w-full space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
        <div className="flex items-center gap-4">
          <span>
            Peak:{' '}
            <strong className="font-mono-num text-[var(--positive)]">
              {maxPoint.cumulativePercent >= 0 ? '+' : ''}
              {maxPoint.cumulativePercent.toFixed(2)}%
            </strong>
          </span>
          <span>
            Trough:{' '}
            <strong className="font-mono-num text-[var(--negative)]">
              {minPoint.cumulativePercent >= 0 ? '+' : ''}
              {minPoint.cumulativePercent.toFixed(2)}%
            </strong>
          </span>
        </div>
        <span>
          Closed trades: <strong className="font-mono-num text-[var(--text-primary)]">{points.length}</strong>
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible"
        role="img"
        aria-label="Equity curve percentage return chart"
      >
        {/* Zero Baseline */}
        <line
          x1={padLeft}
          y1={zeroY}
          x2={width - padRight}
          y2={zeroY}
          stroke="var(--border)"
          strokeDasharray="4 4"
          strokeWidth="1"
        />
        <text
          x={padLeft - 8}
          y={zeroY + 4}
          textAnchor="end"
          fontSize="10"
          fill="var(--text-muted)"
          className="font-mono-num"
        >
          0%
        </text>

        {/* Max & Min labels */}
        <text
          x={padLeft - 8}
          y={padTop + 4}
          textAnchor="end"
          fontSize="10"
          fill="var(--text-muted)"
          className="font-mono-num"
        >
          {maxVal.toFixed(1)}%
        </text>
        <text
          x={padLeft - 8}
          y={height - padBottom}
          textAnchor="end"
          fontSize="10"
          fill="var(--text-muted)"
          className="font-mono-num"
        >
          {minVal.toFixed(1)}%
        </text>

        {/* Equity path */}
        <path
          d={pathD}
          fill="none"
          stroke={strokeColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Points */}
        {series.map((p, idx) => (
          <circle
            key={`${p.index}-${idx}`}
            cx={xFor(idx)}
            cy={yFor(p.cumulativePercent)}
            r={idx === series.length - 1 ? 3.5 : 2.2}
            fill={p.cumulativePercent >= 0 ? 'var(--positive)' : 'var(--negative)'}
          >
            <title>
              {p.date} · {p.instrument} · {p.cumulativePercent >= 0 ? '+' : ''}
              {p.cumulativePercent.toFixed(2)}%
            </title>
          </circle>
        ))}

        {/* X-axis endpoints */}
        <text
          x={padLeft}
          y={height - 6}
          textAnchor="start"
          fontSize="10"
          fill="var(--text-muted)"
          className="font-mono-num"
        >
          {points[0].date}
        </text>
        <text
          x={width - padRight}
          y={height - 6}
          textAnchor="end"
          fontSize="10"
          fill="var(--text-muted)"
          className="font-mono-num"
        >
          {points[points.length - 1].date}
        </text>
      </svg>
    </div>
  );
}
