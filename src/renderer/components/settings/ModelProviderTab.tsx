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

export interface ProviderCredentials {
  openrouter: { apiKey: string; defaultModel: string };
  openai: { apiKey: string; defaultModel: string };
  anthropic: { apiKey: string; defaultModel: string };
  ollama: { host: string; defaultModel: string };
}

interface ModelProviderTabProps {
  activeProvider: string;
  onActiveProviderChange: (provider: string) => void;
  defaultCloudProvider: string;
  onDefaultCloudProviderChange: (provider: string) => void;
  credentials: ProviderCredentials;
  onCredentialsChange: (credentials: ProviderCredentials) => void;
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
          <TextField
            label="Model"
            fullWidth
            margin="normal"
            value={credentials.openrouter.defaultModel}
            onChange={(e) =>
              onCredentialsChange({
                ...credentials,
                openrouter: { ...credentials.openrouter, defaultModel: e.target.value },
              })
            }
            helperText="e.g. anthropic/claude-sonnet-4-6"
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
          <TextField
            label="Model"
            fullWidth
            margin="normal"
            value={credentials.openai.defaultModel}
            onChange={(e) =>
              onCredentialsChange({
                ...credentials,
                openai: { ...credentials.openai, defaultModel: e.target.value },
              })
            }
            helperText="e.g. gpt-4o"
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
          <TextField
            label="Model"
            fullWidth
            margin="normal"
            value={credentials.ollama.defaultModel}
            onChange={(e) =>
              onCredentialsChange({
                ...credentials,
                ollama: { ...credentials.ollama, defaultModel: e.target.value },
              })
            }
            helperText="e.g. llama3.2:3b"
          />
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
