import { createTheme, type Theme } from "@mui/material/styles";

const manrope = '"Manrope", system-ui, -apple-system, sans-serif';
const inter = '"Inter", system-ui, -apple-system, sans-serif';

export const glassSx = {
  background: "rgba(19, 22, 30, 0.6)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
} as const;

export function createAppTheme(): Theme {
  return createTheme({
    palette: {
      mode: "dark",
      primary: {
        main: "#5C6BC0",
      },
      secondary: {
        main: "#26C6DA",
      },
      background: {
        default: "#0D0F14",
        paper: "#13161E",
      },
      text: {
        primary: "#E8EAED",
        secondary: "#8A9BB0",
      },
    },
    typography: {
      fontFamily: inter,
      h1: { fontFamily: manrope },
      h2: { fontFamily: manrope },
      h3: { fontFamily: manrope },
      h4: { fontFamily: manrope },
    },
    shape: {
      borderRadius: 12,
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: "none", border: "none" },
        },
      },
    },
  });
}
