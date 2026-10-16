import { createShellModel } from '@financial-manager/design-tokens';
import type { ShellInput } from '@financial-manager/design-tokens';
import { enabledSections } from '@financial-manager/runtime-config';
import type { RuntimeConfiguration } from '@financial-manager/runtime-config';

export function createDesktopShellModel(
  input: Omit<ShellInput, 'surface' | 'sections'>,
  configuration: RuntimeConfiguration,
) {
  return createShellModel({
    ...input,
    surface: 'desktop',
    sections: enabledSections(configuration, {
      surface: 'desktop',
      authority: input.workspace.mode,
    }),
  });
}
