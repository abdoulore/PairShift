import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min" | "max"> & {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
};

const parse = (t: string) => (t === "" || t === "." ? NaN : Number(t));
const shown = (n: number) => (Number.isFinite(n) ? String(n) : "");

/** A number input that keeps what is typed: clearing it doesn't snap to 0, and an empty field restores on blur. */
export function NumberField({ value, onChange, min = 0, max, onBlur, ...rest }: Props) {
  const [text, setText] = useState(() => shown(value));
  const last = useRef(value);

  // Follow changes made elsewhere (unit switch, links) without rewriting a number mid-typing.
  useEffect(() => {
    if (Number.isFinite(value)) last.current = value;
    setText((t) => (parse(t) === value || (Number.isNaN(value) && Number.isNaN(parse(t))) ? t : shown(value)));
  }, [value]);

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={text}
      onChange={(e) => {
        const t = e.target.value.replace(",", ".");
        if (!/^\d*\.?\d*$/.test(t)) return;
        const n = parse(t);
        if (max !== undefined && n > max) {
          setText(shown(max));
          onChange(max);
          return;
        }
        setText(t);
        onChange(n);
      }}
      onBlur={(e) => {
        let n = parse(text);
        if (!Number.isFinite(n)) n = last.current;
        if (n < min) n = min;
        setText(shown(n));
        if (n !== value) onChange(n);
        onBlur?.(e);
      }}
    />
  );
}
