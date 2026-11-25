import React from 'react';
import { parse12HourTo24Hour, split24HourTo12Hour } from '../../domain/timezone';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: 'sm' | 'md';
  children: React.ReactNode;
}

export function PrimaryButton({ size = 'md', className = '', children, ...props }: ButtonProps) {
  const height = size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-4 text-sm';
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 ${height} rounded-lg font-medium whitespace-nowrap shrink-0 bg-[var(--text-primary)] text-[var(--surface)] hover:opacity-90 disabled:opacity-45 disabled:cursor-not-allowed transition-opacity cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--info)] ${className}`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ size = 'md', className = '', children, ...props }: ButtonProps) {
  const height = size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-4 text-sm';
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 ${height} rounded-lg font-medium whitespace-nowrap shrink-0 bg-[var(--surface)] text-[var(--text-primary)] border border-[var(--border)] hover:bg-[var(--subtle-surface)] disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--info)] ${className}`}
    >
      {children}
    </button>
  );
}

export function DestructiveButton({ size = 'md', className = '', children, ...props }: ButtonProps) {
  const height = size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-4 text-sm';
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 ${height} rounded-lg font-medium whitespace-nowrap shrink-0 bg-[var(--negative)] text-white hover:opacity-90 disabled:opacity-45 disabled:cursor-not-allowed transition-opacity cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--negative)] ${className}`}
    >
      {children}
    </button>
  );
}

interface FieldWrapperProps {
  label?: string;
  required?: boolean;
  hint?: string;
  labelAction?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function FieldWrapper({
  label,
  required,
  hint,
  labelAction,
  children,
  className = '',
}: FieldWrapperProps) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {(label || labelAction) && (
        <div className="flex items-center justify-between gap-2">
          {label ? (
            <label className="text-xs font-medium text-[var(--text-secondary)] flex items-center gap-1">
              <span>{label}</span>
              {required && <span className="text-[var(--negative)]">*</span>}
            </label>
          ) : (
            <span />
          )}
          {labelAction}
        </div>
      )}
      {children}
      {hint && <span className="text-xs text-[var(--text-muted)]">{hint}</span>}
    </div>
  );
}

const baseInputClass =
  'w-full h-9 px-3 text-sm rounded-lg bg-[var(--surface)] text-[var(--text-primary)] border border-[var(--border)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--text-secondary)] disabled:opacity-50 transition-colors';

interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  required?: boolean;
  hint?: string;
}

export function TextInput({ label, required, hint, className = '', ...props }: TextInputProps) {
  return (
    <FieldWrapper label={label} required={required} hint={hint}>
      <input {...props} type={props.type ?? 'text'} className={`${baseInputClass} ${className}`} />
    </FieldWrapper>
  );
}

interface NumberInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value'> {
  label?: string;
  required?: boolean;
  hint?: string;
  labelAction?: React.ReactNode;
  value: number | '' | undefined;
  onChange: (value: number | '') => void;
}

export function NumberInput({
  label,
  required,
  hint,
  labelAction,
  value,
  onChange,
  className = '',
  step = 'any',
  ...props
}: NumberInputProps) {
  return (
    <FieldWrapper label={label} required={required} hint={hint} labelAction={labelAction}>
      <input
        {...props}
        type="number"
        step={step}
        value={value === undefined ? '' : value}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            onChange('');
            return;
          }
          const num = Number(raw);
          if (!Number.isNaN(num)) {
            onChange(num);
          }
        }}
        className={`${baseInputClass} font-mono-num ${className}`}
      />
    </FieldWrapper>
  );
}

interface SelectOption {
  value: string;
  label: string;
}

interface SelectInputProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: string;
  required?: boolean;
  hint?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
}

export function SelectInput({
  label,
  required,
  hint,
  options,
  value,
  onChange,
  className = '',
  ...props
}: SelectInputProps) {
  const hasMatch = value === '' || options.some((opt) => opt.value === value);
  return (
    <FieldWrapper label={label} required={required} hint={hint}>
      <select
        {...props}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${baseInputClass} cursor-pointer ${className}`}
      >
        {!hasMatch && <option value={value}>{value}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </FieldWrapper>
  );
}

interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  required?: boolean;
  hint?: string;
}

export function TextArea({ label, required, hint, className = '', rows = 3, ...props }: TextAreaProps) {
  return (
    <FieldWrapper label={label} required={required} hint={hint}>
      <textarea
        {...props}
        rows={rows}
        className={`w-full px-3 py-2 text-sm rounded-lg bg-[var(--surface)] text-[var(--text-primary)] border border-[var(--border)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--text-secondary)] disabled:opacity-50 transition-colors resize-y ${className}`}
      />
    </FieldWrapper>
  );
}

interface DatePickerProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  labelAction?: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

export function DatePicker({
  label,
  value,
  onChange,
  labelAction,
  className = '',
  disabled,
}: DatePickerProps) {
  return (
    <FieldWrapper label={label} labelAction={labelAction}>
      <input
        type="date"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`${baseInputClass} font-mono-num ${className}`}
      />
    </FieldWrapper>
  );
}

interface MonthPickerProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  labelAction?: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

export function MonthPicker({
  label,
  value,
  onChange,
  labelAction,
  className = '',
  disabled,
}: MonthPickerProps) {
  return (
    <FieldWrapper label={label} labelAction={labelAction}>
      <input
        type="month"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`${baseInputClass} font-mono-num ${className}`}
      />
    </FieldWrapper>
  );
}

interface TimeInput12HourProps {
  label?: string;
  required?: boolean;
  hint?: string;
  value: string;
  onChange: (hhmm24: string) => void;
  disabled?: boolean;
  className?: string;
}

const HOURS_12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES_60 = Array.from({ length: 60 }, (_, i) => i);

export function TimeInput12Hour({
  label,
  required,
  hint,
  value,
  onChange,
  disabled,
  className = '',
}: TimeInput12HourProps) {
  const { hour12, minute, period } = split24HourTo12Hour(value);
  const selectClass =
    'h-9 px-2 text-sm rounded-lg bg-[var(--surface)] text-[var(--text-primary)] border border-[var(--border)] focus:outline-none focus:border-[var(--text-secondary)] disabled:opacity-50 cursor-pointer font-mono-num';

  return (
    <FieldWrapper label={label} required={required} hint={hint} className={className}>
      <div className="flex items-center gap-1.5">
        <select
          aria-label={`${label || 'Time'} hour`}
          disabled={disabled}
          value={hour12}
          onChange={(e) => onChange(parse12HourTo24Hour(Number(e.target.value), minute, period))}
          className={`${selectClass} flex-1 min-w-0`}
        >
          {HOURS_12.map((h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, '0')}
            </option>
          ))}
        </select>
        <span className="text-xs font-mono-num text-[var(--text-muted)]">:</span>
        <select
          aria-label={`${label || 'Time'} minute`}
          disabled={disabled}
          value={minute}
          onChange={(e) => onChange(parse12HourTo24Hour(hour12, Number(e.target.value), period))}
          className={`${selectClass} flex-1 min-w-0`}
        >
          {MINUTES_60.map((m) => (
            <option key={m} value={m}>
              {String(m).padStart(2, '0')}
            </option>
          ))}
        </select>
        <select
          aria-label={`${label || 'Time'} AM/PM`}
          disabled={disabled}
          value={period}
          onChange={(e) =>
            onChange(parse12HourTo24Hour(hour12, minute, e.target.value as 'AM' | 'PM'))
          }
          className={`${selectClass} shrink-0`}
        >
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>
    </FieldWrapper>
  );
}

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <div
      className={`inline-flex items-center p-1 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)] ${className}`}
      role="tablist"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`h-7 px-3 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              active
                ? 'bg-[var(--surface)] text-[var(--text-primary)] border border-[var(--border)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

interface RangeSliderProps {
  label?: string;
  required?: boolean;
  hint?: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  valueLabel?: string;
  className?: string;
}

export function RangeSlider({
  label,
  required,
  hint,
  min,
  max,
  step = 1,
  value,
  onChange,
  valueLabel,
  className = '',
}: RangeSliderProps) {
  return (
    <FieldWrapper
      label={label}
      required={required}
      hint={hint}
      className={className}
      labelAction={
        <span className="text-xs font-mono-num font-semibold text-[var(--text-primary)]">
          {valueLabel ?? `${value}/${max}`}
        </span>
      }
    >
      <div className="h-9 px-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] flex items-center gap-2.5">
        <span className="text-[11px] font-mono-num text-[var(--text-muted)] shrink-0">{min}</span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label || 'Slider'}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full h-1.5 rounded-lg bg-[var(--subtle-surface)] accent-[var(--text-primary)] cursor-grab active:cursor-grabbing"
        />
        <span className="text-[11px] font-mono-num text-[var(--text-muted)] shrink-0">{max}</span>
      </div>
    </FieldWrapper>
  );
}
