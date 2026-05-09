interface IconProps {
  size?: number;
  stroke?: number;
  fill?: string;
  strokeColor?: string;
  style?: React.CSSProperties;
}

function Ic({ d, size = 16, stroke = 1.6, fill = "none", strokeColor = "currentColor", style }: IconProps & { d: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={strokeColor}
         strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">
      {d}
    </svg>
  );
}

export const IconPlus = (p: IconProps) => <Ic {...p} d={<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>} />;
export const IconSearch = (p: IconProps) => <Ic {...p} d={<><circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.5" y2="16.5"/></>} />;
export const IconSettings = (p: IconProps) => <Ic {...p} d={<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>} />;
export const IconFolder = (p: IconProps) => <Ic {...p} d={<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>} />;
export const IconSend = (p: IconProps) => <Ic {...p} d={<><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></>} />;
export const IconChevD = (p: IconProps) => <Ic {...p} d={<polyline points="6 9 12 15 18 9"/>} />;
export const IconChevR = (p: IconProps) => <Ic {...p} d={<polyline points="9 6 15 12 9 18"/>} />;
export const IconArrowL = (p: IconProps) => <Ic {...p} d={<><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></>} />;
export const IconCheck = (p: IconProps) => <Ic {...p} d={<polyline points="20 6 9 17 4 12"/>} />;
export const IconX = (p: IconProps) => <Ic {...p} d={<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>} />;
export const IconDoc = (p: IconProps) => <Ic {...p} d={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>} />;
export const IconAlert = (p: IconProps) => <Ic {...p} d={<><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17.01"/></>} />;
export const IconShield = (p: IconProps) => <Ic {...p} d={<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>} />;
export const IconBolt = (p: IconProps) => <Ic {...p} d={<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>} />;
export const IconBrain = (p: IconProps) => <Ic {...p} d={<path d="M9 3a3 3 0 0 0-3 3v0a3 3 0 0 0-2 5 3 3 0 0 0 1 5 3 3 0 0 0 4 3 3 3 0 0 0 6 0 3 3 0 0 0 4-3 3 3 0 0 0 1-5 3 3 0 0 0-2-5 3 3 0 0 0-3-3 3 3 0 0 0-6 0z"/>} />;
export const IconTerm = (p: IconProps) => <Ic {...p} d={<><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></>} />;
export const IconTrash = (p: IconProps) => <Ic {...p} d={<><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></>} />;
export const IconRefresh = (p: IconProps) => <Ic {...p} d={<><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>} />;
export const IconLink = (p: IconProps) => <Ic {...p} d={<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>} />;
export const IconEdit = (p: IconProps) => <Ic {...p} d={<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>} />;
export const IconCpu = (p: IconProps) => <Ic {...p} d={<><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="2" x2="9" y2="4"/><line x1="15" y1="2" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="22"/><line x1="15" y1="20" x2="15" y2="22"/><line x1="20" y1="9" x2="22" y2="9"/><line x1="20" y1="14" x2="22" y2="14"/><line x1="2" y1="9" x2="4" y2="9"/><line x1="2" y1="14" x2="4" y2="14"/></>} />;
export const IconGlobe = (p: IconProps) => <Ic {...p} d={<><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></>} />;
export const IconBook = (p: IconProps) => <Ic {...p} d={<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z"/>} />;
export const IconLogo = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="var(--accent)" />
    <circle cx="12" cy="12" r="3.2" fill="var(--bg)" />
  </svg>
);
