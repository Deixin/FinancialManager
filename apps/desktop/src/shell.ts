import { createElement } from 'react';
import { AppShell } from '@financial-manager/ui-dom';
import type { AppShellProps } from '@financial-manager/ui-dom';

export function DesktopShell(props: AppShellProps) {
  if (props.model.surface !== 'desktop')
    throw new Error('UI_SHELL_SURFACE_INVALID');
  return createElement(AppShell, props);
}
