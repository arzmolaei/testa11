import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  formatDate, formatJalaliInput, getJalaliParts, JALALI_MONTHS, JALALI_WEEKDAYS,
  jalaliMonthGrid, parseJalali, persianDigits, todayIso, toIsoDate,
} from "../dates";
import "./JalaliDateInput.css";

export type JalaliDateInputProps = {
  value: string;
  onChange: (iso: string) => void;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  "aria-label"?: string;
};

export function JalaliDateInput({
  value, onChange, id, disabled, required, className, "aria-label": ariaLabel,
}: JalaliDateInputProps) {
  const generatedId = useId();
  const inputId = id || `jalali-${generatedId}`;
  const errorId = `${inputId}-error`;
  const normalizedValue = value ? toIsoDate(value) : null;
  const displayValue = formatJalaliInput(normalizedValue || "") || (value ? "تاریخ نامعتبر" : "");
  const [text, setText] = useState(displayValue);
  const [touched, setTouched] = useState(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => getJalaliParts(normalizedValue || "") || getJalaliParts(todayIso())!);
  const [focusDay, setFocusDay] = useState(view.day);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const input = useRef<HTMLInputElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const emitted = useRef<string | null>(null);
  const invalid = Boolean(text.trim()) && !parseJalali(text);

  useEffect(() => {
    if (emitted.current === value) { emitted.current = null; return; }
    emitted.current = null;
    setText(displayValue);
    setTouched(false);
  }, [value]);
  useEffect(() => {
    input.current?.setCustomValidity(invalid ? "تاریخ شمسی معتبر وارد کنید؛ مانند ۱۴۰۵/۰۷/۱۵." : "");
  }, [invalid]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = wrapper.current?.getBoundingClientRect();
      if (!bounds) return;
      const width = Math.min(310, window.innerWidth - 24);
      const height = picker.current?.offsetHeight || 365;
      setPosition({
        left: Math.max(12, Math.min(bounds.right - width, window.innerWidth - width - 12)),
        top: Math.max(12, bounds.bottom + height + 8 <= window.innerHeight ? bounds.bottom + 8 : bounds.top - height - 8),
      });
    };
    place();
    const frame = requestAnimationFrame(() => {
      place();
      picker.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus();
    });
    const outside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node) && !picker.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", outside);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);

  const emit = (iso: string) => { emitted.current = iso; onChange(iso); };
  const choose = (iso: string) => {
    setText(formatJalaliInput(iso));
    setTouched(false);
    emit(iso);
    setOpen(false);
    input.current?.focus();
  };
  const shiftMonth = (delta: number) => {
    let month = view.month + delta;
    let year = view.year;
    if (month < 1) { month = 12; year--; }
    if (month > 12) { month = 1; year++; }
    if (year < 1 || year > 3177) return;
    setView({ year, month, day: 1 });
    setFocusDay(1);
  };
  const days = jalaliMonthGrid(view.year, view.month);
  const selected = getJalaliParts(normalizedValue || "");
  const years = Array.from({ length: 41 }, (_, index) => view.year - 20 + index).filter((year) => year >= 1 && year <= 3177);
  const closePicker = () => { setOpen(false); input.current?.focus(); };

  return <div className={`jalali-date-input ${className || ""}`} ref={wrapper}>
    <div className="jalali-date-control">
      <input
        ref={input} id={inputId} type="text" value={text} disabled={disabled} required={required}
        inputMode="numeric" autoComplete="off" dir="ltr" maxLength={16}
        aria-label={ariaLabel} aria-invalid={invalid && touched ? true : undefined}
        aria-describedby={invalid && touched ? errorId : undefined}
        placeholder="۱۴۰۵/۰۷/۱۵"
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          const iso = parseJalali(next);
          if (!next.trim()) emit("");
          else if (iso) emit(iso);
        }}
        onBlur={() => {
          setTouched(true);
          const iso = parseJalali(text);
          if (iso) setText(formatJalaliInput(iso));
        }}
      />
      <button type="button" className="jalali-calendar-toggle" disabled={disabled}
        aria-label={`انتخاب تاریخ شمسی${ariaLabel ? `؛ ${ariaLabel}` : ""}`} aria-expanded={open}
        onClick={() => {
          const current = getJalaliParts(normalizedValue || "") || getJalaliParts(todayIso())!;
          setView(current); setFocusDay(current.day); setOpen(!open);
        }}><CalendarDays size={16} /></button>
    </div>
    {invalid && touched && <small className="jalali-date-error" id={errorId} role="alert">تاریخ شمسی معتبر وارد کنید؛ روز این ماه را بررسی کنید.</small>}
    {open && createPortal(<div ref={picker} className="jalali-picker" dir="rtl" role="dialog" aria-label="تقویم شمسی"
      style={{ top: position.top, left: position.left }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closePicker(); }
        if (event.key === "Tab") {
          event.stopPropagation();
          const controls = [...(picker.current?.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), select:not(:disabled)') || [])];
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
        if (event.key === "PageUp" || event.key === "PageDown") { event.preventDefault(); shiftMonth(event.key === "PageUp" ? -1 : 1); }
        const delta = { ArrowRight: -1, ArrowLeft: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
        if (delta && (event.target as HTMLElement).hasAttribute("data-day")) {
          event.preventDefault();
          const count = days.filter(Boolean).length;
          const next = Math.min(count, Math.max(1, Number((event.target as HTMLElement).dataset.day) + delta));
          setFocusDay(next);
          picker.current?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)?.focus();
        }
      }}>
      <div className="jalali-picker-heading">
        <span>تقویم شمسی</span><button type="button" aria-label="بستن تقویم" onClick={closePicker}><X size={16}/></button>
      </div>
      <div className="jalali-picker-nav">
        <button type="button" aria-label="ماه قبل" onClick={() => shiftMonth(-1)}><ChevronRight size={17}/></button>
        <select aria-label="ماه شمسی" value={view.month} onChange={(event) => { setView({ ...view, month: Number(event.target.value), day: 1 }); setFocusDay(1); }}>
          {JALALI_MONTHS.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
        </select>
        <select aria-label="سال شمسی" value={view.year} onChange={(event) => { setView({ ...view, year: Number(event.target.value), day: 1 }); setFocusDay(1); }}>
          {years.map((year) => <option value={year} key={year}>{persianDigits(year)}</option>)}
        </select>
        <button type="button" aria-label="ماه بعد" onClick={() => shiftMonth(1)}><ChevronLeft size={17}/></button>
      </div>
      <div className="jalali-picker-grid">
        {JALALI_WEEKDAYS.map((day, index) => <span className={`jalali-picker-weekday ${index === 6 ? "friday" : ""}`} key={day} title={day}>{["ش", "ی", "د", "س", "چ", "پ", "ج"][index]}</span>)}
        {days.map((day, index) => day ? <button type="button" key={day.iso} data-day={day.day}
          className={`${normalizedValue === day.iso ? "selected" : ""} ${todayIso() === day.iso ? "today" : ""} ${day.weekday === 6 ? "friday" : ""}`}
          tabIndex={focusDay === day.day ? 0 : -1}
          aria-label={formatDate(day.iso, { weekday: "long" })} aria-pressed={normalizedValue === day.iso}
          onFocus={() => setFocusDay(day.day)} onClick={() => choose(day.iso)}>{persianDigits(day.day)}</button> : <span key={`blank-${index}`} />)}
      </div>
      <div className="jalali-picker-footer">
        <button type="button" onClick={() => choose(todayIso())}>امروز</button>
        {!required && <button type="button" onClick={() => choose("")}>پاک کردن تاریخ</button>}
      </div>
      {selected && <span className="sr-only">تاریخ انتخاب‌شده: {formatDate(value)}</span>}
    </div>, document.body)}
  </div>;
}

export default JalaliDateInput;
