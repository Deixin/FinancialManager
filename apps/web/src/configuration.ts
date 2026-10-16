import { createShellModel } from '@financial-manager/design-tokens';
import type { ShellInput } from '@financial-manager/design-tokens';
import { enabledSections } from '@financial-manager/runtime-config';
import type { RuntimeConfiguration } from '@financial-manager/runtime-config';

export function createWebShellModel(
  input: Omit<ShellInput, 'surface' | 'sections'>,
  configuration: RuntimeConfiguration,
) {
  return createShellModel({
    ...input,
    surface: 'web',
    sections: enabledSections(configuration, {
      surface: 'web',
      authority: input.workspace.mode,
    }),
  });
}
