export type SubFont = 'sans' | 'serif' | 'mono' | 'anime';
export type SubWeight = 'normal' | 'bold';

export interface SubStyle {
  font: SubFont;
  weight: SubWeight;
  scale: number;
  color: string;
  stroke: string;
  shadow: string;
  bg: string;
  bgOpacity: number;
  yOffset: number;
}

export const DEFAULT_SUB_STYLE: SubStyle = {
  font: 'sans',
  weight: 'normal',
  scale: 1,
  color: '#ffffff',
  stroke: '#000000',
  shadow: 'none',
  bg: '#000000',
  bgOpacity: 0.5,
  yOffset: 0,
};

export function isSubStyle(value: unknown): value is SubStyle {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.font === 'string' &&
    typeof v.weight === 'string' &&
    typeof v.scale === 'number' &&
    typeof v.color === 'string'
  );
}

export function coerceSubStyle(input: unknown, fallback: SubStyle = DEFAULT_SUB_STYLE): SubStyle {
  if (typeof input !== 'object' || input === null) return { ...fallback };
  const v = input as Record<string, unknown>;
  const fontValues: SubFont[] = ['sans', 'serif', 'mono', 'anime'];
  const weightValues: SubWeight[] = ['normal', 'bold'];
  return {
    font: fontValues.includes(v.font as SubFont) ? (v.font as SubFont) : fallback.font,
    weight: weightValues.includes(v.weight as SubWeight) ? (v.weight as SubWeight) : fallback.weight,
    scale: typeof v.scale === 'number' && Number.isFinite(v.scale) ? Math.min(2, Math.max(0.5, v.scale)) : fallback.scale,
    color: typeof v.color === 'string' ? v.color : fallback.color,
    stroke: typeof v.stroke === 'string' ? v.stroke : fallback.stroke,
    shadow: typeof v.shadow === 'string' ? v.shadow : fallback.shadow,
    bg: typeof v.bg === 'string' ? v.bg : fallback.bg,
    bgOpacity: typeof v.bgOpacity === 'number' && Number.isFinite(v.bgOpacity) ? Math.min(1, Math.max(0, v.bgOpacity)) : fallback.bgOpacity,
    yOffset: typeof v.yOffset === 'number' && Number.isFinite(v.yOffset) ? v.yOffset : fallback.yOffset,
  };
}

function hexToRgba(hex: string, opacity: number): string {
  const h = hex.trim();
  // Handle #rgb, #rrggbb, #rrggbbaa
  let r = 0, g = 0, b = 0;
  if (/^#[0-9a-fA-F]{3}$/.test(h)) {
    r = parseInt(h[1] + h[1], 16);
    g = parseInt(h[2] + h[2], 16);
    b = parseInt(h[3] + h[3], 16);
  } else if (/^#[0-9a-fA-F]{6}$/.test(h)) {
    r = parseInt(h.slice(1, 3), 16);
    g = parseInt(h.slice(3, 5), 16);
    b = parseInt(h.slice(5, 7), 16);
  } else if (/^#[0-9a-fA-F]{8}$/.test(h)) {
    r = parseInt(h.slice(1, 3), 16);
    g = parseInt(h.slice(3, 5), 16);
    b = parseInt(h.slice(5, 7), 16);
    // ignore alpha in hex; opacity param wins
  } else {
    // Named color or rgb(...) — return as-is, opacity via wrapper not possible, fallback to hex with opacity applied via CSS string
    return h;
  }
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function fontFamilyFor(font: SubFont): string {
  switch (font) {
    case 'serif': return 'Georgia, "Times New Roman", serif';
    case 'mono': return 'ui-monospace, SFMono-Regular, Menlo, monospace';
    case 'anime': return '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", system-ui, sans-serif';
    case 'sans':
    default: return 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  }
}

export function styleToCss(style: SubStyle): React.CSSProperties {
  const bg = hexToRgba(style.bg, style.bgOpacity);
  // stroke via multi-directional text-shadow; shadow is additional depth shadow
  const strokeColor = style.stroke;
  const hasStroke = strokeColor && strokeColor.toLowerCase() !== 'transparent' && strokeColor !== 'none';
  const strokeShadow = hasStroke
    ? ` -1px -1px 0 ${strokeColor}, 1px -1px 0 ${strokeColor}, -1px 1px 0 ${strokeColor}, 1px 1px 0 ${strokeColor}`
    : '';
  const extraShadow = style.shadow && style.shadow !== 'none' ? `, ${style.shadow}` : '';
  // Compose final textShadow: stroke layers + optional shadow
  const textShadow = (strokeShadow || extraShadow)
    ? `${strokeShadow.replace(/^,?\s*/, '')}${extraShadow}`.trim().replace(/^,/, '').trim() || undefined
    : undefined;

  // yOffset is -20..+20 (percent). Positive moves down, negative moves up.
  const transform = style.yOffset !== 0 ? `translateY(${style.yOffset}%)` : undefined;

  // font size as calc so it responds to rem root
  const fontSize = `calc(1rem * ${style.scale})`;

  const css: React.CSSProperties = {
    fontFamily: fontFamilyFor(style.font),
    fontWeight: style.weight === 'bold' ? 700 : 400,
    fontSize,
    color: style.color,
    backgroundColor: style.bgOpacity === 0 ? 'transparent' : bg,
    // Only set when needed — avoids overriding inherited shadows
    ...(textShadow ? { textShadow } : {}),
    ...(transform ? { transform } : {}),
    // Ensure box styling for overlay cues
    padding: style.bgOpacity > 0 ? '0.15em 0.35em' : undefined,
    borderRadius: '2px',
    lineHeight: 1.35,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  };
  return css;
}

/** CSS variables subset for native ::cue — stroke/shadow/position native-impossible. */
export function styleToCssVars(style: SubStyle): Record<string, string> {
  const bg = hexToRgba(style.bg, style.bgOpacity);
  return {
    '--sub-color': style.color,
    '--sub-bg': bg,
    '--sub-size': `calc(1rem * ${style.scale})`,
  };
}
