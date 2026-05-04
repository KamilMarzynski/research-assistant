import {
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";

export interface ProviderCredentials {
  openrouter: { apiKey: string; defaultModel: string };
  openai: { apiKey: string; defaultModel: string };
  anthropic: { apiKey: string; defaultModel: string };
  ollama: { host: string; defaultModel: string };
}

export interface ModelOption {
  id: string;
  name: string;
}

interface ModelProviderTabProps {
  activeProvider: string;
  onActiveProviderChange: (provider: string) => void;
  defaultCloudProvider: string;
  onDefaultCloudProviderChange: (provider: string) => void;
  credentials: ProviderCredentials;
  onCredentialsChange: (credentials: ProviderCredentials) => void;
  availableModels?: ModelOption[];
  modelsLoading?: boolean;
  modelsError?: string | null;
  onRefreshModels?: () => void;
  ollamaTestStatus: "idle" | "ok" | "error";
  onTestOllama: () => void;
}

export default function ModelProviderTab({
  activeProvider,
  onActiveProviderChange,
  defaultCloudProvider,
  onDefaultCloudProviderChange,
  credentials,
  onCredentialsChange,
  availableModels = [],
  modelsLoading = false,
  modelsError = null,
  onRefreshModels = () => {},
  ollamaTestStatus,
  onTestOllama,
}: ModelProviderTabProps) {
  return (
    <Box sx={{ pt: 2 }}>
      <FormControl fullWidth margin="normal">
        <InputLabel>Active Provider</InputLabel>
        <Select
          value={activeProvider}
          onChange={(e) => onActiveProviderChange(e.target.value)}
          label="Active Provider"
        >
          <MenuItem value="openrouter">OpenRouter</MenuItem>
          <MenuItem value="ollama">Ollama</MenuItem>
          <MenuItem value="openai">OpenAI</MenuItem>
          <MenuItem value="anthropic" disabled>
            Anthropic (not supported — use OpenRouter instead)
          </MenuItem>
        </Select>
      </FormControl>

      {activeProvider === "anthropic" && (
        <Chip
          label="Direct Anthropic not supported — use OpenRouter"
          color="error"
          sx={{ mt: 1 }}
        />
      )}

      {activeProvider === "openrouter" && (
        <>
          <TextField
            label="OpenRouter API Key"
            type="password"
            fullWidth
            margin="normal"
            value={credentials.openrouter.apiKey}
            onChange={(e) =>
              onCredentialsChange({
                ...credentials,
                openrouter: { ...credentials.openrouter, apiKey: e.target.value },
              })
            }
            placeholder="sk-or-..."
            helperText="Get your key at openrouter.ai/keys"
          />
          <Autocomplete
            options={availableModels}
            getOptionLabel={(o) => (typeof o === "string" ? o : o.name)}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            value={
              availableModels.find((m) => m.id === credentials.openrouter.defaultModel) ?? {
                id: credentials.openrouter.defaultModel,
                name: credentials.openrouter.defaultModel,
              }
            }
            onChange={(_, v) =>
              onCredentialsChange({
                ...credentials,
                openrouter: {
                  ...credentials.openrouter,
                  defaultModel:
                    v && typeof v !== "string" ? v.id : credentials.openrouter.defaultModel,
                },
              })
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="Model"
                margin="normal"
                helperText={modelsError ?? "Select a model from the list"}
                error={!!modelsError}
                slotProps={{
                  ...params.slotProps,
                  input: {
                    ...params.slotProps?.input,
                    endAdornment: (
                      <>
                        {modelsLoading ? <CircularProgress color="inherit" size={20} /> : null}
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
        </>
      )}

      {activeProvider === "openai" && (
        <>
          <TextField
            label="OpenAI API Key"
            type="password"
            fullWidth
            margin="normal"
            value={credentials.openai.apiKey}
            onChange={(e) =>
              onCredentialsChange({
                ...credentials,
                openai: { ...credentials.openai, apiKey: e.target.value },
              })
            }
          />
          <Autocomplete
            options={availableModels}
            getOptionLabel={(o) => (typeof o === "string" ? o : o.name)}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            value={
              availableModels.find((m) => m.id === credentials.openai.defaultModel) ?? {
                id: credentials.openai.defaultModel,
                name: credentials.openai.defaultModel,
              }
            }
            onChange={(_, v) =>
              onCredentialsChange({
                ...credentials,
                openai: {
                  ...credentials.openai,
                  defaultModel: v && typeof v !== "string" ? v.id : credentials.openai.defaultModel,
                },
              })
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="Model"
                margin="normal"
                helperText={
                  modelsError ??
                  (credentials.openai.apiKey
                    ? "Select a model from the list"
                    : "Enter API key to list models")
                }
                error={!!modelsError}
                slotProps={{
                  ...params.slotProps,
                  input: {
                    ...params.slotProps?.input,
                    endAdornment: (
                      <>
                        {modelsLoading ? <CircularProgress color="inherit" size={20} /> : null}
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
        </>
      )}

      {activeProvider === "ollama" && (
        <>
          <TextField
            label="Host"
            fullWidth
            margin="normal"
            value={credentials.ollama.host}
            onChange={(e) =>
              onCredentialsChange({
                ...credentials,
                ollama: { ...credentials.ollama, host: e.target.value },
              })
            }
            helperText="e.g. http://localhost:11434"
          />
          <Autocomplete
            options={availableModels}
            getOptionLabel={(o) => (typeof o === "string" ? o : o.name)}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            value={
              availableModels.find((m) => m.id === credentials.ollama.defaultModel) ?? {
                id: credentials.ollama.defaultModel,
                name: credentials.ollama.defaultModel,
              }
            }
            onChange={(_, v) =>
              onCredentialsChange({
                ...credentials,
                ollama: {
                  ...credentials.ollama,
                  defaultModel: v && typeof v !== "string" ? v.id : credentials.ollama.defaultModel,
                },
              })
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="Model"
                margin="normal"
                helperText={
                  modelsError ??
                  (availableModels.length === 0 && !modelsLoading
                    ? "No models found. Run `ollama pull <model>` in terminal."
                    : "Select a model from the list")
                }
                error={!!modelsError}
                slotProps={{
                  ...params.slotProps,
                  input: {
                    ...params.slotProps?.input,
                    endAdornment: (
                      <>
                        {modelsLoading ? <CircularProgress color="inherit" size={20} /> : null}
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
          <Button variant="outlined" onClick={onRefreshModels} sx={{ mt: 1, mr: 1 }}>
            Refresh models
          </Button>
          <Button variant="outlined" onClick={onTestOllama} sx={{ mt: 1 }}>
            Test connection
          </Button>
          {ollamaTestStatus === "ok" && (
            <Typography component="span" color="success.main" sx={{ ml: 1 }}>
              Connected
            </Typography>
          )}
          {ollamaTestStatus === "error" && (
            <Typography component="span" color="error.main" sx={{ ml: 1 }}>
              Not reachable
            </Typography>
          )}

          <FormControl fullWidth margin="normal" sx={{ mt: 2 }}>
            <InputLabel>Fallback provider</InputLabel>
            <Select
              value={defaultCloudProvider}
              onChange={(e) => onDefaultCloudProviderChange(e.target.value)}
              label="Fallback provider"
            >
              <MenuItem value="openrouter">OpenRouter</MenuItem>
              <MenuItem value="openai">OpenAI</MenuItem>
            </Select>
          </FormControl>
        </>
      )}
    </Box>
  );
}
