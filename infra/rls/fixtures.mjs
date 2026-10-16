// All identities, workspaces and amounts in this module are synthetic.
const id = (value) =>
  '00000000-0000-4000-8000-' + String(value).padStart(12, '0');
export const fixture = Object.freeze({
  workspaceA: id(1),
  workspaceB: id(2),
  unknownWorkspace: id(3),
  accountA: id(11),
  hiddenAccountA: id(12),
  accountB: id(21),
  userA: id(101),
  userB: id(102),
  reader: id(103),
  limitedWriter: id(104),
  multiUser: id(105),
  entryA: id(1001),
  hiddenEntryA: id(1002),
  entryB: id(2001),
  temporaryEntry: id(9999),
});
export const amounts = Object.freeze({
  [fixture.entryA]: '9007199254740993',
  [fixture.hiddenEntryA]: '-9223372036854775808',
  [fixture.entryB]: '9223372036854775807',
});
export const contextA = Object.freeze({
  workspaceId: fixture.workspaceA,
  userId: fixture.userA,
});
export const contextB = Object.freeze({
  workspaceId: fixture.workspaceB,
  userId: fixture.userB,
});
