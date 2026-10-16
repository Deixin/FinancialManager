export const tokenVersion = '0.1.0';

function freeze<T extends object>(value: T): Readonly<T> {
  for (const item of Object.values(value))
    if (item && typeof item === 'object') freeze(item);
  return Object.freeze(value);
}

// Numeric values are CSS px at the default root size, or native logical units.
// DOM adapters convert typography/spacing to rem; Native keeps font scaling on.
export const tokens = freeze({
  color: {
    canvas: '#f4f7f8',
    surface: '#ffffff',
    text: '#142e38',
    muted: '#4c626c',
    border: '#7b8b92',
    subtleBorder: '#dce5e8',
    brand: '#08664f',
    onBrand: '#ffffff',
    brandSubtle: '#e8f4ef',
    sidebar: '#142e38',
    onSidebar: '#f2f7f8',
    sidebarMuted: '#c0d4db',
    focus: '#185eb4',
    disabled: '#52656e',
    disabledSurface: '#e8edef',
  },
  state: {
    neutral: { foreground: '#4c626c', background: '#eef3f5' },
    info: { foreground: '#174f83', background: '#eaf2fc' },
    success: { foreground: '#14633e', background: '#e8f5ee' },
    warning: { foreground: '#754207', background: '#fff2db' },
    danger: { foreground: '#a2212c', background: '#fff0f0' },
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, section: 48 },
  typography: {
    family: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    caption: { size: 14, lineHeight: 20, weight: 400 },
    body: { size: 16, lineHeight: 24, weight: 400 },
    label: { size: 16, lineHeight: 24, weight: 600 },
    title: { size: 24, lineHeight: 32, weight: 700 },
    display: { size: 32, lineHeight: 40, weight: 700 },
  },
  radius: { control: 8, panel: 16 },
  control: {
    minTarget: 44,
    nativeMinTarget: 48,
    focusWidth: 3,
    focusOffset: 3,
  },
  layout: { sidebar: 264, contentMax: 1280, compactAt: 832 },
  motion: { durationMs: 0 },
} as const);
