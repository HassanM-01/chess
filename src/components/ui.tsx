import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

export function Pill({ tone = '', children, title }: { tone?: '' | 'good' | 'bad' | 'warn' | 'acc'; children: ReactNode; title?: string }): JSX.Element {
  return (
    <span className={`pill ${tone}`.trim()} title={title}>
      {children}
    </span>
  );
}

export function Hero({ eyebrow, title }: { eyebrow: string; title: string }): JSX.Element {
  return (
    <div className="hero stack-s">
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
    </div>
  );
}

/** Top bar for full-screen sessions: back button + title. */
export function SessTop({ title, sub, onBack, to }: { title: string; sub?: string; onBack?: () => void; to?: string }): JSX.Element {
  const nav = useNavigate();
  return (
    <div className="sess-top">
      <button className="back" aria-label="Back" onClick={() => (onBack ? onBack() : to ? nav(to) : nav(-1))}>
        <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>
          ‹
        </span>
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2>{title}</h2>
        {sub ? <div className="small muted">{sub}</div> : null}
      </div>
    </div>
  );
}

export function ProgressBar({ value, id }: { value: number; id?: string }): JSX.Element {
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} id={id}>
      <i style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }): JSX.Element {
  return <button className="switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />;
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}): JSX.Element {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Feedback({ tone = '', children, className = '' }: { tone?: '' | 'good' | 'bad' | 'warn'; children: ReactNode; className?: string }): JSX.Element {
  return <div className={`feedback ${tone} ${className}`.trim()}>{children}</div>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }): JSX.Element {
  return (
    <div className="splash" role="status">
      <div className="spinner" aria-hidden="true" />
      <div className="small muted">{label}</div>
    </div>
  );
}
