import { tokens } from './tokens.js';

const rem = (value: number) => `${value / 16}rem`;
export const cssVariables: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(
    Object.entries(tokens.color).map(([key, value]) => [
      `--fm-color-${key}`,
      value,
    ]),
  ),
  ...Object.fromEntries(
    Object.entries(tokens.state).flatMap(([key, value]) => [
      [`--fm-state-${key}-fg`, value.foreground],
      [`--fm-state-${key}-bg`, value.background],
    ]),
  ),
  ...Object.fromEntries(
    Object.entries(tokens.space).map(([key, value]) => [
      `--fm-space-${key}`,
      rem(value),
    ]),
  ),
  ...Object.fromEntries(
    Object.entries(tokens.typography)
      .filter(([, value]) => typeof value === 'object')
      .flatMap(([key, value]) => {
        if (typeof value === 'string') return [];
        return [
          [`--fm-type-${key}-size`, rem(value.size)],
          [`--fm-type-${key}-line`, rem(value.lineHeight)],
          [`--fm-type-${key}-weight`, String(value.weight)],
        ];
      }),
  ),
  '--fm-font-family': tokens.typography.family,
  '--fm-radius-control': rem(tokens.radius.control),
  '--fm-radius-panel': rem(tokens.radius.panel),
  '--fm-target': rem(tokens.control.minTarget),
  '--fm-focus-width': `${tokens.control.focusWidth}px`,
  '--fm-focus-offset': `${tokens.control.focusOffset}px`,
  '--fm-sidebar': rem(tokens.layout.sidebar),
  '--fm-content-max': rem(tokens.layout.contentMax),
});
