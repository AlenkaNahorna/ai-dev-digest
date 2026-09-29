import React from "react";
import { Icon } from "../icons";

/** REAL controlled checkbox (styled). */
export function Checkbox({
  checked,
  onChange,
  label,
  ariaLabel,
  disabled = false,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  label?: React.ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const labelId = React.useId();
  const control = (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={label ? labelId : undefined}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      style={{
        width: 16,
        height: 16,
        borderRadius: 4,
        border: "1.5px solid " + (checked ? "var(--accent)" : "var(--border-strong)"),
        background: checked ? "var(--accent)" : "transparent",
        display: "grid",
        placeItems: "center",
        padding: 0,
      }}
    >
      {checked && <Icon.Check size={11} style={{ color: "#fff" }} />}
    </button>
  );

  return label ? (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 14,
        color: "var(--text-secondary)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {control}
      <span id={labelId}>{label}</span>
    </div>
  ) : control;
}
