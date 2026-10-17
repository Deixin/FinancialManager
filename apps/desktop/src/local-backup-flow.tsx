import { useEffect, useRef, useState } from 'react';
import { validRecoveryPassword } from './local-backup.js';
export function LocalBackupPending({ onCancel }: { onCancel(): void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = 'Financial Manager · Criando backup';
    heading.current?.focus();
  }, []);
  return (
    <div className="fm-entry">
      <header className="entry-brand">Financial Manager</header>
      <main className="local-main">
        <section
          className="entry-card local-card"
          aria-labelledby="backup-progress-heading"
        >
          <h1 id="backup-progress-heading" ref={heading} tabIndex={-1}>
            Criando backup
          </h1>
          <p role="status">
            Preparando o pacote criptografado e aguardando sua escolha de
            destino no Windows…
          </p>
          <p>
            A senha já foi retirada dos campos. Com PIN ativo, o diálogo
            bloqueia o acesso aos espaços; concluir o backup não desbloqueia o
            aplicativo.
          </p>
          <button type="button" onClick={onCancel}>
            Cancelar solicitação de backup
          </button>
        </section>
      </main>
    </div>
  );
}
export function LocalBackupFlow({
  name,
  onCreate,
  onBack,
}: {
  name: string;
  onCreate(password: string, confirmation: string): void;
  onBack(): void;
}) {
  const [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [acknowledged, setAcknowledged] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null),
    submitted = useRef(false);
  useEffect(() => {
    document.title = 'Financial Manager · Backup local';
    heading.current?.focus();
  }, []);
  return (
    <div className="fm-entry">
      <header className="entry-brand">Financial Manager</header>
      <main className="local-main">
        <section
          className="entry-card local-card"
          aria-labelledby="backup-heading"
        >
          <h1 id="backup-heading" ref={heading} tabIndex={-1}>
            Backup local
          </h1>
          <p>Espaço: {name}. Os dados deste espaço existem neste computador.</p>
          <p>
            Crie um pacote .fmbackup criptografado, com versão e verificação de
            integridade. Ele inclui todos os registros estruturados disponíveis
            neste espaço, inclusive histórico de revisões; não inclui originais
            de documentos.
          </p>
          <p>
            A senha do backup é independente do PIN do aplicativo, do Windows
            Hello e da chave deste computador. Ela não será guardada pelo
            aplicativo. Perder a senha pode tornar o backup irrecuperável.
            Guarde-a separadamente do arquivo.
          </p>
          <p>
            O destino será escolhido no diálogo do Windows. Use um novo arquivo;
            backups existentes não são substituídos. Se escolher uma pasta
            sincronizada por outro serviço, esse serviço receberá o pacote
            criptografado.
          </p>
          <p>
            Com PIN ativo, o diálogo de destino bloqueia a sessão. Concluir ou
            cancelar o backup não libera novamente o acesso aos espaços.
          </p>
          <p>
            Limite nesta versão: snapshot de até 64 MiB. Não há informação
            disponível sobre a última criação de backup nesta tela; a nova
            criação mostrará sua data após verificação.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (
                submitted.current ||
                !validRecoveryPassword(password) ||
                password !== confirmation ||
                !acknowledged
              )
                return;
              submitted.current = true;
              const secret = password,
                repeated = confirmation;
              setPassword('');
              setConfirmation('');
              onCreate(secret, repeated);
            }}
          >
            <label htmlFor="backup-password">Senha do backup</label>
            <input
              id="backup-password"
              type="password"
              autoComplete="off"
              required
              minLength={12}
              maxLength={256}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby="backup-password-help"
            />
            <p id="backup-password-help">
              De 12 a 128 caracteres. Use uma senha forte e exclusiva; espaços e
              acentos são mantidos exatamente como digitados.
            </p>
            <label htmlFor="backup-confirmation">
              Confirme a senha do backup
            </label>
            <input
              id="backup-confirmation"
              type="password"
              autoComplete="off"
              required
              maxLength={256}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
            <label className="backup-ack">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              Entendo que o PIN e o Windows Hello não recuperam a senha deste
              backup.
            </label>
            <button
              className="entry-primary"
              type="submit"
              disabled={
                !validRecoveryPassword(password) ||
                password !== confirmation ||
                !acknowledged
              }
            >
              Criar backup criptografado
            </button>
          </form>
          <p>
            Restauração como novo espaço será disponibilizada na próxima etapa.
          </p>
          <button
            type="button"
            className="entry-secondary"
            onClick={() => {
              setPassword('');
              setConfirmation('');
              onBack();
            }}
          >
            Voltar aos espaços locais
          </button>
        </section>
      </main>
    </div>
  );
}
