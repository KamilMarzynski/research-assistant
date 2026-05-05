import { Autocomplete, CircularProgress, TextField } from "@mui/material";
import type { ModelOption } from "./ModelProviderTab";

interface ModelAutocompleteProps {
  value: string;
  options: ModelOption[];
  onChange: (modelId: string) => void;
  modelsLoading: boolean;
  modelsError: string | null;
  helperText: string;
}

export default function ModelAutocomplete({
  value,
  options,
  onChange,
  modelsLoading,
  modelsError,
  helperText,
}: ModelAutocompleteProps) {
  const selected =
    options.find((m) => m.id === value) ?? { id: value, name: value };

  return (
    <Autocomplete
      options={options}
      getOptionLabel={(o) => (typeof o === "string" ? o : o.name)}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      value={selected}
      onChange={(_, v) => {
        if (v && typeof v !== "string") onChange(v.id);
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Model"
          margin="normal"
          helperText={modelsError ?? helperText}
          error={!!modelsError}
          slotProps={{
            ...params.slotProps,
            input: {
              ...params.slotProps?.input,
              endAdornment: (
                <>
                  {modelsLoading ? (
                    <CircularProgress color="inherit" size={20} />
                  ) : null}
                  {params.slotProps?.input?.endAdornment}
                </>
              ),
            },
          }}
        />
      )}
      fullWidth
      disableClearable
    />
  );
}
