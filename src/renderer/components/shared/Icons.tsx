interface IconProps {
  size?: number;
  stroke?: number;
  fill?: string;
  strokeColor?: string;
  style?: React.CSSProperties;
}

function Ic({
  d,
  size = 16,
  stroke = 1.6,
  fill = "none",
  strokeColor = "currentColor",
  style,
}: IconProps & { d: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={strokeColor}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
    >
      {d}
    </svg>
  );
}

export const IconPlus = (p: IconProps) => (
  <Ic
    {...p}
    d={
      <>
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </>
    }
  />
);
export const IconSearch = (p: IconProps) => (
  <Ic
    {...p}
    d={
      <>
        <circle cx="11" cy="11" r="7" />
        <line x1="20" y1="20" x2="16.5" y2="16.5" />
      </>
    }
  />
);
export const IconSettings = (p: IconProps) => (
  <Ic
    {...p}
    d={
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </>
    }
  />
);
export const IconFolder = (p: IconProps) => (
  <Ic
    {...p}
    d={<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />}
  />
);
export const IconSend = (p: IconProps) => (
  <Ic
    {...p}
    d={
      <>
        <path d="M22 2L11 13" />
        <path d="M22 2l-7 20-4-9-9-4 20-7z" />
      </>
    }
  />
);
export const IconChevD = (p: IconProps) => <Ic {...p} d={<polyline points="6 9 12 15 18 9" />} />;
export const IconChevR = (p: IconProps) => <Ic {...p} d={<polyline points="9 6 15 12 9 18" />} />;
export const IconArrowL = (p: IconProps) => (
  <Ic
    {...p}
    d={
      <>
        <line x1="19" y1="12" x2="5" y2="12" />
        <polyline points="12 19 5 12 12 5" />
      </>
    }
  />
);
export const IconCheck = (p: IconProps) => <Ic {...p} d={<polyline points="20 6 9 17 4 12" />} />;
export const IconX = (p: IconProps) => (
  <Ic
    {...p}
    d={
      <>
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </>
    }
  />
);
export const IconDoc = (p: IconProps) => (
  <Ic
    {...p}
    d={
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </>
    }
  />
);
export const IconAlert = (p: IconProps) => (
  <Ic
    {...p}
    d={
      <>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12" y2="17.01" />
      </>
    }
  />
);
export const IconShield = (p: IconProps) => (
  <Ic {...p} d={<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />} />
);
export const IconBolt = (p: IconProps) => (
  <Ic {...p} d={<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />} />
);
export const IconBrain = (p: IconProps) => (
  <Ic
    {...p}
    d={
      <path d="M9 3a3 3 0 0 0-3 3v0a3 3 0 0 0-2 5 3 3 0 0 0 1 5 3 3 0 0 0 4 3 3 3 0 0 0 6 0 3 3 0 0 0 4-3 3 3 0 0 0 1-5 3 3 0 0 0-2-5 3 3 0 0 0-3-3 3 3 0 0 0-6 0z" />
    }
  />
);
export const IconTerm = (p: IconProps) => (
  <Ic
    {...p}
    d={
      <>
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </>
    }
  />
);
export const IconTrash = (p: IconProps) => (
  <Ic
    {...p}
    d={
      <>
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </>
    }
  />
);
export const IconRefresh = (p: IconProps) => (
  <Ic
    {...p}
    d={
      <>
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </>
    }
  />
);
export const IconLink = (p: IconProps) => (
  <Ic
    {...p}
    d={
      <>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </>
    }
  />
);
export const IconEdit = (p: IconProps) => (
  <Ic
    {...p}
    d={
      <>
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </>
    }
  />
);
export const IconCpu = (p: IconProps) => (
  <Ic
    {...p}
    d={
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <rect x="9" y="9" width="6" height="6" />
        <line x1="9" y1="2" x2="9" y2="4" />
        <line x1="15" y1="2" x2="15" y2="4" />
        <line x1="9" y1="20" x2="9" y2="22" />
        <line x1="15" y1="20" x2="15" y2="22" />
        <line x1="20" y1="9" x2="22" y2="9" />
        <line x1="20" y1="14" x2="22" y2="14" />
        <line x1="2" y1="9" x2="4" y2="9" />
        <line x1="2" y1="14" x2="4" y2="14" />
      </>
    }
  />
);
export const IconGlobe = (p: IconProps) => (
  <Ic
    {...p}
    d={
      <>
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </>
    }
  />
);
export const IconBook = (p: IconProps) => (
  <Ic {...p} d={<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z" />} />
);
export const IconLogo = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="var(--accent)" />
    <circle cx="12" cy="12" r="3.2" fill="var(--bg)" />
  </svg>
);

// ── Provider logos (monochrome, fill=currentColor) ──

function LogoIc({ d, size = 18 }: { d: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {d}
    </svg>
  );
}

/** Anthropic — stylised "A" mark */
export const IconAnthropic = ({ size = 18 }: { size?: number }) => (
  <LogoIc
    size={size}
    d={
      <path d="M17.304 3.541h-3.672l6.696 16.918H24L17.304 3.541zm-10.608 0L0 20.459h3.744l1.37-3.553h7.005l1.369 3.553h3.744L10.536 3.541h-3.84zm-.371 10.223 2.291-5.946 2.292 5.946H6.325z" />
    }
  />
);

/** OpenAI — 6-petal blossom */
export const IconOpenAI = ({ size = 18 }: { size?: number }) => (
  <LogoIc
    size={size}
    d={
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.98 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a5.985 5.985 0 0 0 5.772-4.206 6.056 6.056 0 0 0 3.996-2.9 5.985 5.985 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.896zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.28-5.833-3.36 2.02-1.168a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.104v-5.678a.792.792 0 0 0-.412-.689zm1.453-2.683 2.876-1.653 2.885 1.66v3.32l-2.886 1.652-2.876-1.652z" />
    }
  />
);

/** OpenRouter — two crossing arrows */
export const IconOpenRouter = ({ size = 18 }: { size?: number }) => (
  <LogoIc
    size={size}
    d={
      <path d="M16.778 1.844v1.919q-.569-.026-1.138-.032-.708-.008-1.415.037c-1.93.126-4.023.728-6.149 2.237-2.911 2.066-2.731 1.95-4.14 2.75-.396.223-1.342.574-2.185.798-.841.225-1.753.333-1.751.333v4.229s.768.108 1.61.333c.842.224 1.789.575 2.185.799 1.41.798 1.228.683 4.14 2.75 2.126 1.509 4.22 2.11 6.148 2.236.88.058 1.716.041 2.555.005v1.918l7.222-4.168-7.222-4.17v2.176c-.86.038-1.611.065-2.278.021-1.364-.09-2.417-.357-3.979-1.465-2.244-1.593-2.866-2.027-3.68-2.508.889-.518 1.449-.906 3.822-2.59 1.56-1.109 2.614-1.377 3.978-1.466.667-.044 1.418-.017 2.278.02v2.176L24 6.014Z" />
    }
  />
);

/** Ollama — simplified llama head */
export const IconOllama = ({ size = 18 }: { size?: number }) => (
  <LogoIc
    size={size}
    d={
      <path d="M12 2C7.5 2 4 5 4 8.5c0 1.5.5 3 1.5 4C3.5 14 2 16 2 18c0 2.5 2 4.5 4.5 4.5 1.5 0 3-.5 4-2 .5.5 1 1 2.5 1s2-.5 2.5-1c1 1.5 2.5 2 4 2 2.5 0 4.5-2 4.5-4.5 0-2-1.5-4-3.5-5.5 1-1 1.5-2.5 1.5-4C20 5 16.5 2 12 2zm0 2c3 0 5.5 2 5.5 4.5 0 1-.3 2-.8 2.8-.5.3-1 .5-1.5.5-.8 0-1.5-.3-2-.8-.5-.5-.8-1.2-.8-2 0-.5-.5-1-1-1s-1 .5-1 1c0 .8-.3 1.5-.8 2-.5.5-1.2.8-2 .8-.5 0-1-.2-1.5-.5-.5-.8-.8-1.8-.8-2.8C6.5 6 9 4 12 4zM7.5 14c.8 0 1.5.7 1.5 1.5S8.3 17 7.5 17 6 16.3 6 15.5s.7-1.5 1.5-1.5zm9 0c.8 0 1.5.7 1.5 1.5s-.7 1.5-1.5 1.5-1.5-.7-1.5-1.5.7-1.5 1.5-1.5z" />
    }
  />
);
