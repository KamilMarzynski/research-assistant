import { CssBaseline, ThemeProvider, useMediaQuery } from "@mui/material"
import AppShell from "./components/layout/AppShell"
import { createAppTheme } from "./theme"

export default function App() {
  const isDark = useMediaQuery("(prefers-color-scheme: dark)")
  const theme = createAppTheme(isDark ? "dark" : "light")

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppShell />
    </ThemeProvider>
  )
}
