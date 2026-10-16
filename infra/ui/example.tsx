import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  contentStates,
  routes,
} from '../../packages/design-tokens/dist/index.js';
import type {
  ContentState,
  ShellRoute,
  Surface,
  WorkspaceSummary,
} from '../../packages/design-tokens/dist/index.js';
import { DesktopShell } from '../../apps/desktop/src/shell.js';
import { WebShell } from '../../apps/web/src/shell.js';
import { createDesktopShellModel } from '../../apps/desktop/src/configuration.js';
import { createWebShellModel } from '../../apps/web/src/configuration.js';
import {
  createFeatureGate,
  decodeConfiguration,
  enabledSections,
} from '../../packages/runtime-config/dist/index.js';
import '../../packages/ui-dom/styles.css';

// Synthetic contexts only. No API, storage, login or financial source.
const workspaces: readonly WorkspaceSummary[] = [
  { id: 'synthetic-local', name: 'Meu espaço de exemplo', mode: 'local' },
  { id: 'synthetic-cloud', name: 'Equipe de exemplo', mode: 'cloud' },
  {
    id: 'synthetic-long',
    name: 'Espaço de exemplo com um nome muito longo para testar leitura e ampliação',
    mode: 'cloud',
  },
];
function Example() {
  const [gate] = useState(() => {
    try {
      return createFeatureGate(
        'local',
        decodeConfiguration(
          document.getElementById('runtime-configuration')?.textContent,
          'local',
        ),
      );
    } catch {
      return createFeatureGate('local');
    }
  });
  const [configuration, setConfiguration] = useState(gate.snapshot());
  const [availability, setAvailability] = useState(
    configuration.features.importReview ? 'full' : 'limited',
  );
  const [availabilityMessage, setAvailabilityMessage] = useState('');
  const [availabilityPending, setAvailabilityPending] = useState(false);
  const [surface, setSurface] = useState<Surface>('desktop');
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]!.id);
  const [route, setRoute] = useState<ShellRoute>('overview');
  const [state, setState] = useState<ContentState>('ready');
  const [search, setSearch] = useState(false);
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const workspace = workspaces.find((item) => item.id === workspaceId)!;
  const model = (
    surface === 'web' ? createWebShellModel : createDesktopShellModel
  )({ workspace, route, state }, configuration);
  const Shell = surface === 'web' ? WebShell : DesktopShell;
  useEffect(() => {
    if (search) input.current?.focus();
  }, [search]);
  const navigate = (next: ShellRoute) => {
    if (
      !enabledSections(gate.snapshot(), {
        surface,
        authority: workspace.mode,
      }).includes(next)
    ) {
      setAvailabilityMessage('Este recurso está indisponível no momento.');
      return;
    }
    setRoute(next);
    setSearch(false);
    setState(next === 'overview' ? 'ready' : 'empty');
    setQuery('');
  };
  const changeWorkspace = (next: string) => {
    setWorkspaceId(next);
    navigate('overview');
  };
  const changeAvailability = async (profile: string) => {
    if (availabilityPending) return;
    setAvailabilityPending(true);
    let next;
    try {
      const response = await fetch('/demo-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile }),
        cache: 'no-store',
        redirect: 'error',
      });
      if (!response.ok) throw new Error('CONFIGURATION_UNAVAILABLE');
      next = gate.replace(await response.json());
      setAvailabilityMessage('Disponibilidade atualizada.');
    } catch {
      try {
        gate.replace(null);
      } catch {
        /* Fail closed; no raw error message reaches UI. */
      }
      next = gate.snapshot();
      setAvailabilityMessage(
        'Não foi possível atualizar. Os recursos opcionais foram desativados.',
      );
    }
    setRoute('overview');
    setSearch(false);
    setQuery('');
    setState('ready');
    setConfiguration(next);
    setAvailability(next.features.importReview ? 'full' : 'limited');
    setAvailabilityPending(false);
  };
  const footer = (
    <section
      className="fm-example-controls"
      aria-label="Cenários da demonstração"
    >
      <label htmlFor="example-surface">Plataforma do exemplo</label>
      <select
        id="example-surface"
        value={surface}
        onChange={(event) => {
          const next = event.currentTarget.value as Surface;
          setSurface(next);
          if (next === 'web' && workspace.mode === 'local')
            changeWorkspace('synthetic-cloud');
        }}
      >
        <option value="desktop">Desktop</option>
        <option value="web">Web</option>
      </select>
      <label htmlFor="example-state">Estado do exemplo</label>
      <select
        id="example-state"
        value={state}
        onChange={(event) =>
          setState(event.currentTarget.value as ContentState)
        }
      >
        {Object.entries(contentStates).map(([id, notice]) => (
          <option key={id} value={id}>
            {notice.title}
          </option>
        ))}
      </select>
      <label htmlFor="example-availability">Disponibilidade do exemplo</label>
      <select
        id="example-availability"
        value={availability}
        disabled={availabilityPending}
        onChange={(event) => {
          void changeAvailability(event.currentTarget.value);
        }}
      >
        <option value="full">Todas as seções de exemplo</option>
        <option value="limited">Somente recursos básicos</option>
      </select>
      <p aria-live="polite" aria-atomic="true">
        {availabilityMessage}
      </p>
    </section>
  );
  return (
    <Shell
      model={model}
      workspaces={workspaces}
      onNavigate={navigate}
      onWorkspaceChange={changeWorkspace}
      onSearch={() => {
        setState('ready');
        setSearch(!search);
      }}
      onRetry={() => setState('ready')}
      footer={footer}
    >
      {search ? (
        <section
          className="fm-example-panel fm-example-search"
          aria-label="Busca de exemplo"
        >
          <label htmlFor="example-query">Buscar seções neste espaço</label>
          <input
            id="example-query"
            ref={input}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            type="search"
          />
          {model.navigation
            .filter(({ label }) =>
              label
                .toLocaleLowerCase('pt-BR')
                .includes(query.toLocaleLowerCase('pt-BR')),
            )
            .map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => navigate(id as ShellRoute)}
              >
                {label}
              </button>
            ))}
          <button
            type="button"
            onClick={() => {
              document
                .querySelector<HTMLButtonElement>('.fm-toolbar button')
                ?.focus();
              setSearch(false);
              setQuery('');
            }}
          >
            Fechar busca
          </button>
        </section>
      ) : (
        <>
          <section className="fm-example-panel">
            <span className="fm-badge">Demonstração · dados sintéticos</span>
            <h2 style={{ marginTop: '1rem' }}>
              Seu espaço, com tudo no lugar.
            </h2>
            <p className="fm-example-intro">
              Organize suas movimentações, acompanhe suas contas e mantenha o
              controle de onde seus dados ficam.
            </p>
            <button
              type="button"
              className="fm-primary"
              onClick={() => navigate('movements')}
            >
              Ver movimentações
            </button>
          </section>
          <div className="fm-example-grid">
            {(['accounts', 'imports', 'reports'] as const)
              .filter((id) => model.navigation.some((item) => item.id === id))
              .map((id) => (
                <button key={id} type="button" onClick={() => navigate(id)}>
                  {routes[id]}
                  <br />
                  <span className="fm-example-intro">
                    Explorar esta seção →
                  </span>
                </button>
              ))}
          </div>
          <section className="fm-example-panel">
            <h2>Local ou nuvem, sempre claro</h2>
            <p className="fm-example-intro">
              Neste exemplo você pode trocar de espaço e conhecer os estados da
              interface, sem cadastrar ou enviar dados financeiros.
            </p>
          </section>
        </>
      )}
    </Shell>
  );
}
createRoot(document.getElementById('root')!).render(<Example />);
