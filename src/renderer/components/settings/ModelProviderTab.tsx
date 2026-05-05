import {
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import ModelAutocomplete from "./ModelAutocomplete";

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
  availableModels: ModelOption[];
  modelsLoading: boolean;
  modelsError: string | null;
  onRefreshModels: () => void;
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
  availableModels,
  modelsLoading,
  modelsError,
  onRefreshModels,
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
          <ModelAutocomplete
            value={credentials.openrouter.defaultModel}
            options={availableModels}
            onChange={(id) =>
              onCredentialsChange({
                ...credentials,
                openrouter: { ...credentials.openrouter, defaultModel: id },
              })
            }
            modelsLoading={modelsLoading}
            modelsError={modelsError}
            helperText="Select a model from the list"
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
          <ModelAutocomplete
            value={credentials.openai.defaultModel}
            options={availableModels}
            onChange={(id) =>
              onCredentialsChange({
                ...credentials,
                openai: { ...credentials.openai, defaultModel: id },
              })
            }
            modelsLoading={modelsLoading}
            modelsError={modelsError}
            helperText={
              credentials.openai.apiKey
                ? "Select a model from the list"
                : "Enter API key to list models"
            }
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
          <ModelAutocomplete
            value={credentials.ollama.defaultModel}
            options={availableModels}
            onChange={(id) =>
              onCredentialsChange({
                ...credentials,
                ollama: { ...credentials.ollama, defaultModel: id },
              })
            }
            modelsLoading={modelsLoading}
            modelsError={modelsError}
            helperText={
              availableModels.length === 0 && !modelsLoading
                ? "No models found. Run `ollama pull <model>` in terminal."
                : "Select a model from the list"
            }
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
