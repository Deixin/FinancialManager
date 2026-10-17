export type DesktopEntryScreen = 'ENTRY' | 'LOCAL_SETUP';
export type DesktopEntryAction = 'CONTINUE_LOCAL' | 'BACK_TO_ENTRY';

// Entering local mode creates neither a cloud identity nor a workspace.
export function nextDesktopEntryScreen(
  current: DesktopEntryScreen,
  action: DesktopEntryAction,
): DesktopEntryScreen {
  if (!['ENTRY', 'LOCAL_SETUP'].includes(current))
    throw new Error('DESKTOP_ENTRY_STATE_INVALID');
  switch (action) {
    case 'CONTINUE_LOCAL':
      return 'LOCAL_SETUP';
    case 'BACK_TO_ENTRY':
      return 'ENTRY';
    default:
      throw new Error('DESKTOP_ENTRY_ACTION_INVALID');
  }
}
