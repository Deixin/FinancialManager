// Presentation only: no fetching, authorization, persistence or financial rules.
export const routes = Object.freeze({
  overview: 'Visão geral',
  movements: 'Movimentações',
  accounts: 'Contas e cartões',
  imports: 'Importações',
  documents: 'Documentos e itens',
  reports: 'Relatórios',
  settings: 'Configurações',
});
export type ShellRoute = keyof typeof routes;
export const contentStates = Object.freeze({
  ready: {
    title: 'Tudo pronto',
    description: 'Seu espaço está disponível.',
    tone: 'neutral',
  },
  loading: {
    title: 'Carregando',
    description: 'Aguarde enquanto buscamos os dados deste espaço.',
    tone: 'info',
  },
  empty: {
    title: 'Nenhum registro por aqui',
    description: 'Quando houver registros neste espaço, eles aparecerão aqui.',
    tone: 'neutral',
  },
  error: {
    title: 'Não foi possível carregar',
    description: 'Seus dados não foram alterados. Tente novamente.',
    tone: 'danger',
  },
  partial: {
    title: 'Visão parcial',
    description:
      'As informações incluem somente as contas às quais você tem acesso.',
    tone: 'warning',
  },
  forbidden: {
    title: 'Acesso restrito',
    description: 'Você não tem permissão para consultar este conteúdo.',
    tone: 'danger',
  },
} as const);
for (const value of Object.values(contentStates)) Object.freeze(value);
export type ContentState = keyof typeof contentStates;
export const syncStates = Object.freeze({
  current: 'Atualizado',
  pending: 'Alterações aguardando envio',
  offline: 'Sem conexão com a nuvem',
  conflict: 'Conflito precisa de revisão',
});
export type SyncState = keyof typeof syncStates;
export type Surface = 'web' | 'desktop' | 'mobile';
export type WorkspaceSummary = Readonly<{
  id: string;
  name: string;
  mode: 'local' | 'cloud';
  detail?: string;
}>;
export type ShellInput = Readonly<{
  surface: Surface;
  workspace: WorkspaceSummary;
  route: ShellRoute;
  state: ContentState;
  sync?: SyncState;
  partial?: boolean;
  sections?: readonly ShellRoute[];
}>;
export type ShellModel = Readonly<{
  surface: Surface;
  workspace: WorkspaceSummary;
  route: ShellRoute;
  state: ContentState;
  partial: boolean;
  title: string;
  locationLabel: 'Local' | 'Nuvem';
  locationDescription: string;
  navigation: readonly Readonly<{
    id: ShellRoute;
    label: string;
    selected: boolean;
  }>[];
}>;
const invalid = () => {
  throw new Error('UI_SHELL_INVALID');
};
export function createShellModel(input: ShellInput): ShellModel {
  if (
    !input ||
    !['web', 'desktop', 'mobile'].includes(input.surface) ||
    !input.workspace ||
    !['local', 'cloud'].includes(input.workspace.mode) ||
    typeof input.workspace.id !== 'string' ||
    input.workspace.id.length < 1 ||
    input.workspace.id.length > 128 ||
    typeof input.workspace.name !== 'string' ||
    !input.workspace.name.trim() ||
    input.workspace.name.length > 120 ||
    !Object.hasOwn(routes, input.route) ||
    !Object.hasOwn(contentStates, input.state) ||
    (input.partial !== undefined && typeof input.partial !== 'boolean')
  )
    invalid();
  if (
    input.workspace.mode === 'local' &&
    (input.surface !== 'desktop' || input.sync !== undefined)
  )
    invalid();
  if (input.sync !== undefined && !Object.hasOwn(syncStates, input.sync))
    invalid();
  const local = input.workspace.mode === 'local';
  const sections = input.sections ?? (Object.keys(routes) as ShellRoute[]);
  if (
    !Array.isArray(sections) ||
    sections.length > 7 ||
    !sections.includes('overview') ||
    !sections.includes('settings') ||
    new Set(sections).size !== sections.length ||
    sections.some(
      (section) =>
        typeof section !== 'string' || !Object.hasOwn(routes, section),
    ) ||
    !sections.includes(input.route)
  )
    invalid();
  return Object.freeze({
    surface: input.surface,
    workspace: Object.freeze({
      id: input.workspace.id,
      name: input.workspace.name,
      mode: input.workspace.mode,
    }),
    route: input.route,
    state: input.state,
    partial: input.partial ?? false,
    title: routes[input.route],
    locationLabel: local ? 'Local' : 'Nuvem',
    locationDescription: local
      ? 'Somente neste dispositivo'
      : input.sync
        ? syncStates[input.sync]
        : 'Espaço em nuvem',
    navigation: Object.freeze(
      Object.entries(routes)
        .filter(([id]) => sections.includes(id as ShellRoute))
        .map(([id, label]) =>
          Object.freeze({
            id: id as ShellRoute,
            label,
            selected: id === input.route,
          }),
        ),
    ),
  });
}
