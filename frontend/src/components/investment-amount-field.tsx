"use client";

import { useId } from "react";

export function InvestmentAmountField({ label, help, value, onChange, required = false }: {
  label: string; help: string; value: string; onChange: (value: string) => void; required?: boolean;
}) {
  const id = useId();
  return <div className="min-w-0">
    <label htmlFor={id} className="block text-sm font-semibold text-white">{label} (USD)</label>
    <div className="relative mt-2">
      <span aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-[var(--copy-soft)]">$</span>
      <input id={id} type="number" inputMode="decimal" min="0" max="100000000" step="0.01" required={required}
        value={value} onChange={(event) => onChange(event.target.value)} aria-describedby={`${id}-help`}
        className="brand-input min-h-11 w-full py-3 pl-7 pr-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-soft)]" />
    </div>
    <p id={`${id}-help`} className="mt-2 text-sm leading-5 text-[var(--copy-soft)]">{help}</p>
    {!required ? <button type="button" onClick={() => onChange("")} className="mt-1 min-h-11 px-2 text-sm text-[var(--gold-soft)] underline focus-visible:outline focus-visible:outline-2">I don’t know yet</button> : null}
  </div>;
}
