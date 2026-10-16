'use client';

import { useEffect, useId, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { contentStates, cssVariables } from '@financial-manager/design-tokens';
import type {
  ShellModel,
  ShellRoute,
  WorkspaceSummary,
} from '@financial-manager/design-tokens';

export type AppShellProps = Readonly<{
  model: ShellModel;
  workspaces: readonly WorkspaceSummary[];
  onWorkspaceChange: (id: string) => void;
  onNavigate: (route: ShellRoute) => void;
  onSearch?: () => void;
  onRetry?: () => void;
  children?: ReactNode;
  footer?: ReactNode;
}>;

export function ContentNotice({
  state,
  onRetry,
}: Pick<AppShellProps, 'onRetry'> & { state: ShellModel['state'] }) {
  const notice = contentStates[state];
  if (state === 'ready') return null;
  return (
    <section
      className={`fm-notice fm-tone-${notice.tone}`}
      aria-label={notice.title}
    >
      <h2>{notice.title}</h2>
      <p>{notice.description}</p>
      {state === 'error' && onRetry && (
        <button type="button" className="fm-primary" onClick={onRetry}>
          Tentar novamente
        </button>
      )}
    </section>
  );
}

export function AppShell({
  model,
  workspaces,
  onWorkspaceChange,
  onNavigate,
  onSearch,
  onRetry,
  children,
  footer,
}: AppShellProps) {
  const id = useId();
  const mainId = `main-${id}`;
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  const previous = useRef({
    route: model.route,
    workspace: model.workspace.id,
    state: model.state,
  });
  useEffect(() => {
    const changedContext =
      previous.current.route !== model.route ||
      previous.current.workspace !== model.workspace.id;
    const recovered =
      previous.current.state === 'error' &&
      (model.state === 'ready' || model.state === 'partial');
    if (mounted.current && (changedContext || recovered))
      heading.current?.focus();
    previous.current = {
      route: model.route,
      workspace: model.workspace.id,
      state: model.state,
    };
    mounted.current = true;
  }, [model.route, model.workspace.id, model.state]);
  const available = workspaces.filter(
    (workspace) => model.surface === 'desktop' || workspace.mode === 'cloud',
  );
  const contentVisible = model.state === 'ready' || model.state === 'partial';
  const message =
    model.state === 'ready'
      ? ''
      : `${contentStates[model.state].title}. ${contentStates[model.state].description}`;
  return (
    <div className="fm-shell" style={cssVariables as CSSProperties}>
      <a
        className="fm-skip"
        href={`#${mainId}`}
        onClick={(event) => {
          event.preventDefault();
          document.getElementById(mainId)?.focus();
        }}
      >
        Ir para o conteúdo
      </a>
      <aside className="fm-sidebar" aria-label="Seu espaço">
        <p className="fm-brand">
          <span aria-hidden="true" className="fm-brand-mark">
            F
          </span>
          Financial Manager
        </p>
        <div className="fm-workspace">
          <label htmlFor={`workspace-${id}`}>Espaço ativo</label>
          <select
            id={`workspace-${id}`}
            value={model.workspace.id}
            onChange={(event) => onWorkspaceChange(event.currentTarget.value)}
          >
            {available.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name} —{' '}
                {workspace.mode === 'local' ? 'Local' : 'Nuvem'}
              </option>
            ))}
          </select>
          <div className="fm-location">
            <span className="fm-badge">{model.locationLabel}</span>
            <span>{model.locationDescription}</span>
          </div>
        </div>
        <nav aria-label="Navegação principal">
          <ul>
            {model.navigation.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={item.selected ? 'page' : undefined}
                  onClick={() => onNavigate(item.id)}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <p className="fm-sidebar-note">
          Seu espaço.
          <br />
          <strong>Seu controle.</strong>
        </p>
      </aside>
      <div className="fm-page">
        <header className="fm-toolbar">
          <p className="fm-workspace-name">{model.workspace.name}</p>
          {onSearch && (
            <button type="button" className="fm-secondary" onClick={onSearch}>
              Buscar no espaço
            </button>
          )}
        </header>
        <main
          id={mainId}
          tabIndex={-1}
          className="fm-main"
          aria-busy={model.state === 'loading'}
        >
          <div className="fm-eyebrow">
            {model.locationLabel} · {model.workspace.name}
          </div>
          <h1 ref={heading} tabIndex={-1}>
            {model.title}
          </h1>
          {model.partial && model.state !== 'partial' && (
            <p className="fm-partial">
              Visão parcial: somente contas autorizadas.
            </p>
          )}
          <div key={model.workspace.id} className="fm-content">
            <ContentNotice
              state={model.state}
              {...(onRetry ? { onRetry } : {})}
            />
            {contentVisible && children}
          </div>
          {footer}
        </main>
        <p
          className="fm-sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {message}
        </p>
      </div>
    </div>
  );
}
