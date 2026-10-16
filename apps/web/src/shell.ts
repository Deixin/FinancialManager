'use client';
import { createElement } from 'react';
import { AppShell } from '@financial-manager/ui-dom';
import type { AppShellProps } from '@financial-manager/ui-dom';

export function WebShell(props: AppShellProps) {
  if (props.model.surface !== 'web')
    throw new Error('UI_SHELL_SURFACE_INVALID');
  return createElement(AppShell, props);
}
