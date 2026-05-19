import { MenuItem, Select } from "@mui/material";
import { useId } from "react";
import { IconChevD } from "../shared/Icons";
import type { ModelOption } from "./ModelProviderTab";

interface ModelSelectProps {
  value: string;
  options: ModelOption[];
  onChange: (modelId: string) => void;
  modelsLoading: boolean;
  modelsError: string | null;
  helperText: string;
}

export default function ModelSelect({
  value,
  options,
  onChange,
  modelsLoading,
  modelsError,
  helperText,
}: ModelSelectProps) {
  const id = useId();
  const hasValue = options.some((m) => m.id === value);
  const displayOptions = hasValue || !value ? options : [{ id: value, name: value }, ...options];
  const displayName = displayOptions.find((m) => m.id === value)?.name ?? value;

  return (
    <div>
      <label htmlFor={id} className="eyebrow" style={{ display: "block", marginBottom: 6 }}>
        Model
      </label>
      <Select
        size="small"
        value={value || ""}
        disabled={modelsLoading || displayOptions.length === 0}
        onChange={(e) => onChange(e.target.value)}
        displayEmpty
        IconComponent={() => null}
        inputProps={{ id }}
        renderValue={() => (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: "var(--text-sm)",
              color: "var(--ink)",
            }}
          >
            <span>{modelsLoading ? "Loading models…" : (displayName || "Select a model")}</span>
            <IconChevD size={12} />
          </span>
        )}
        sx={{
          width: "100%",
          fontSize: "var(--text-sm)",
          color: "var(--ink)",
          borderRadius: "var(--r-sm)",
          transition: "background 120ms ease",
          "& .MuiSelect-select": {
            py: 0.5,
            px: 0.75,
            fontSize: "var(--text-sm)",
            display: "flex",
            alignItems: "center",
            color: "var(--ink)",
          },
          "& .MuiOutlinedInput-notchedOutline": { border: "none" },
          "&:hover .MuiOutlinedInput-notchedOutline": { border: "none" },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": { border: "none" },
          "&:hover": { background: "var(--surface-2)" },
        }}
        MenuProps={{
          anchorOrigin: { vertical: "bottom", horizontal: "left" },
          transformOrigin: { vertical: "top", horizontal: "left" },
          slotProps: {
            paper: {
              sx: {
                background: "var(--surface)",
                border: "1px solid var(--line)",
                borderRadius: "var(--r-md)",
                boxShadow: "var(--shadow-2)",
                color: "var(--ink)",
                mt: 0.5,
              },
            },
          },
        }}
      >
        {displayOptions.length === 0 && (
          <MenuItem
            value=""
            disabled
            sx={{ fontSize: "var(--text-sm)", color: "var(--ink-3)" }}
          >
            No models available
          </MenuItem>
        )}
        {displayOptions.map((m) => (
          <MenuItem
            key={m.id}
            value={m.id}
            sx={{
              fontSize: "var(--text-sm)",
              color: "var(--ink)",
              background: "transparent",
              "&:hover": { background: "var(--surface-2)" },
              "&.Mui-selected": { background: "var(--accent-soft)", color: "var(--accent)" },
              "&.Mui-selected:hover": { background: "var(--accent-soft)" },
            }}
          >
            {m.name}
          </MenuItem>
        ))}
      </Select>
      <span
        id={`${id}-help`}
        className="t-tertiary"
        style={{ fontSize: "var(--text-xs)", marginTop: 4, display: "block" }}
      >
        {modelsError ?? helperText}
      </span>
    </div>
  );
}
