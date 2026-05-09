import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { IPC } from "../../shared/ipc-channels";

type ThemeMode = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: ThemeMode;
  resolved: "light" | "dark";
  setTheme: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  resolved: "light",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");
  const initialized = useRef(false);

  const resolve = useCallback((mode: ThemeMode) => {
    if (mode === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return mode;
  }, []);

  useEffect(() => {
    window.electronAPI.invoke(IPC.GET_SETTINGS).then((settings) => {
      if (initialized.current) return;
      // TODO(Task 4): remove cast once SettingsResponse includes theme
      const mode = (settings as unknown as { theme?: ThemeMode }).theme ?? "system";
      setThemeState(mode);
      const r = resolve(mode);
      setResolved(r);
      document.documentElement.setAttribute("data-theme", r);
      initialized.current = true;
    });
  }, [resolve]);

  useEffect(() => {
    const r = resolve(theme);
    setResolved(r);
    document.documentElement.setAttribute("data-theme", r);
  }, [theme, resolve]);

  useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const r = resolve("system");
      setResolved(r);
      document.documentElement.setAttribute("data-theme", r);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme, resolve]);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode);
    initialized.current = true;
    void window.electronAPI.invoke(IPC.SAVE_SETTINGS, { theme: mode });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>
  );
}
