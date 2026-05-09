import { useId } from "react";
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

  return (
    <div>
      <label htmlFor={id} className="eyebrow" style={{ display: "block", marginBottom: 6 }}>
        Model
      </label>
      {modelsLoading ? (
        <select id={id} className="input" disabled value="">
          <option value="">Loading models...</option>
        </select>
      ) : (
        <select
          id={id}
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={displayOptions.length === 0}
          aria-invalid={!!modelsError}
          aria-describedby={`${id}-help`}
        >
          {displayOptions.length === 0 && <option value="">No models available</option>}
          {displayOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      )}
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
