import { Box, type SxProps, Typography } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownRendererProps {
  content: string;
  sx?: SxProps<Theme>;
}

const codeStyle: SxProps<Theme> = {
  fontFamily: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
  fontSize: "0.8125rem",
  lineHeight: 1.6,
};

export default function MarkdownRenderer({ content, sx }: MarkdownRendererProps) {
  if (!content) return null;

  return (
    <Box
      sx={[
        {
          "& h1": { fontSize: "1.25rem", fontWeight: 700, my: 1.5, lineHeight: 1.3 },
          "& h2": { fontSize: "1.1rem", fontWeight: 700, my: 1.25, lineHeight: 1.3 },
          "& h3": { fontSize: "1rem", fontWeight: 600, my: 1, lineHeight: 1.3 },
          "& h4": { fontSize: "0.9375rem", fontWeight: 600, my: 0.75, lineHeight: 1.3 },
          "& h5, & h6": { fontSize: "0.875rem", fontWeight: 600, my: 0.5, lineHeight: 1.3 },
          "& p": { my: 0.75, lineHeight: 1.6 },
          "& ul, & ol": { my: 0.75, pl: 3 },
          "& li": { my: 0.25, lineHeight: 1.6 },
          "& blockquote": {
            borderLeft: 3,
            borderColor: "primary.main",
            my: 1,
            pl: 2,
            py: 0.5,
            bgcolor: "action.hover",
            borderRadius: "0 4px 4px 0",
          },
          "& hr": { my: 2, borderColor: "divider" },
          "& a": { color: "primary.main", textDecoration: "underline" },
          "& table": {
            borderCollapse: "collapse",
            my: 1.5,
            width: "100%",
            fontSize: "0.8125rem",
          },
          "& th": {
            border: 1,
            borderColor: "divider",
            px: 1.5,
            py: 0.75,
            bgcolor: "action.selected",
            fontWeight: 600,
            textAlign: "left",
          },
          "& td": {
            border: 1,
            borderColor: "divider",
            px: 1.5,
            py: 0.75,
          },
          "& pre": {
            ...codeStyle,
            bgcolor: "grey.900",
            color: "grey.100",
            borderRadius: 1,
            p: 1.5,
            my: 1.5,
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          },
          "& code": {
            ...codeStyle,
            bgcolor: "action.hover",
            px: 0.5,
            py: 0.25,
            borderRadius: 0.5,
          },
          "& pre code": {
            bgcolor: "transparent",
            px: 0,
            py: 0,
          },
          "& img": {
            maxWidth: "100%",
            height: "auto",
            borderRadius: 1,
            my: 1,
          },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <Typography variant="body2" sx={{ my: 0.75, lineHeight: 1.6 }}>
              {children}
            </Typography>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </Box>
  );
}
