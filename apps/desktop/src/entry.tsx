import { useEffect, useRef, useState } from 'react';
import { nextDesktopEntryScreen } from './entry-model.js';
import type { DesktopEntryScreen } from './entry-model.js';

export function DesktopEntry() {
  const [screen, setScreen] = useState<DesktopEntryScreen>('ENTRY');
  const [online, setOnline] = useState(() => navigator.onLine);
  const heading = useRef<HTMLHeadingElement>(null);
  const lastScreen = useRef(screen);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  useEffect(() => {
    document.title =
      screen === 'ENTRY'
        ? 'Financial Manager · Boas-vindas'
        : 'Financial Manager · Primeiro espaço';
    if (lastScreen.current !== screen) heading.current?.focus();
    lastScreen.current = screen;
  }, [screen]);
  const local = screen === 'LOCAL_SETUP';
  return (
    <div className="fm-entry">
      <a className="entry-skip" href="#entry-main">
        Pular para o conteúdo
      </a>
      <header className="entry-brand">
        <span className="brand-mark" aria-hidden="true">
          fm<span>.</span>
        </span>
        <span>Financial Manager</span>
      </header>
      <main id="entry-main" tabIndex={-1}>
        <section className="entry-intro" aria-labelledby="entry-heading">
          <p className="entry-eyebrow">SUAS FINANÇAS. SEU ESPAÇO.</p>
          <h1 id="entry-heading" ref={heading} tabIndex={-1}>
            {local ? (
              'Seu primeiro espaço começa aqui.'
            ) : (
              <>
                Mais clareza.
                <br />
                No seu ritmo.
              </>
            )}
          </h1>
          <p className="entry-lead">
            {local
              ? 'Você escolheu o modo local. Organize suas finanças neste computador, sem criar uma conta na nuvem.'
              : 'Um lugar para organizar suas finanças, entender seus gastos e planejar o que vem depois.'}
          </p>
          <ul className="entry-benefits">
            <li>Comece sem cadastro</li>
            <li>Use o modo local sem internet</li>
            <li>Você decide o que compartilhar</li>
          </ul>
        </section>
        <section className="entry-card" aria-labelledby="entry-card-heading">
          <span className="entry-badge">
            {local ? 'Modo local' : 'Bem-vindo ao seu espaço'}
          </span>
          <h2 id="entry-card-heading">
            {local ? 'Primeiro espaço' : 'Como você quer começar?'}
          </h2>
          {local ? (
            <>
              <p>
                Um espaço reúne suas contas, lançamentos e categorias. No modo
                local, ele pertence somente a este computador.
              </p>
              <div className="entry-next">
                <span aria-hidden="true">01</span>
                <div>
                  <strong>Crie um espaço para você</strong>
                  <p>
                    Escolha um nome e uma finalidade: pessoal, empresa ou outro.
                  </p>
                </div>
              </div>
              <p className="entry-note">
                A criação de espaços estará disponível em breve.
              </p>
              <button
                className="entry-secondary"
                onClick={() =>
                  setScreen((current) =>
                    nextDesktopEntryScreen(current, 'BACK_TO_ENTRY'),
                  )
                }
              >
                Voltar à entrada
              </button>
            </>
          ) : (
            <>
              <p>Você pode começar agora, sem e-mail ou senha.</p>
              <button
                className="entry-primary"
                onClick={() =>
                  setScreen((current) =>
                    nextDesktopEntryScreen(current, 'CONTINUE_LOCAL'),
                  )
                }
              >
                Continuar sem conta <span aria-hidden="true">↗</span>
              </button>
              <p className="entry-caption">
                Uso local não envia dados financeiros.
              </p>
              <div className="entry-divider">
                <span>ou use uma conta na nuvem</span>
              </div>
              <div className="entry-cloud">
                <button
                  className="entry-secondary"
                  disabled
                  aria-describedby="cloud-status"
                >
                  Entrar
                </button>
                <button
                  className="entry-secondary"
                  disabled
                  aria-describedby="cloud-status"
                >
                  Criar conta
                </button>
              </div>
              <p id="cloud-status" className="entry-note" role="status">
                {online
                  ? 'O acesso à nuvem estará disponível em breve.'
                  : 'Você está sem internet. Entrar e criar conta estão indisponíveis; o modo local continua disponível.'}
              </p>
            </>
          )}
          <details className="entry-privacy">
            <summary>Privacidade no modo local</summary>
            <p>
              Continuar sem conta não cria um usuário remoto. Seus dados
              financeiros locais não são enviados para a nuvem por essa escolha.
            </p>
          </details>
        </section>
      </main>
      <footer>Seu dinheiro faz parte da sua vida. Seu espaço também.</footer>
    </div>
  );
}
