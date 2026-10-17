import { useEffect, useRef, useState } from 'react';
import { validRecoveryPassword } from './local-backup.js';
import { restoreTables } from './local-restore.js';
import type { RestorePreview } from './local-restore.js';
const labels: Record<(typeof restoreTables)[number], string> = {
  workspace: 'Espaço',
  financial_account: 'Contas',
  balance_reference: 'Saldos de referência',
  category: 'Categorias',
  subcategory: 'Subcategorias',
  tag: 'Marcadores',
  counterparty: 'Contrapartes',
  transaction_group: 'Grupos de movimentações',
  financial_transaction: 'Movimentações',
  transaction_allocation: 'Rateios',
  transaction_tag: 'Vínculos de marcadores',
  transaction_revision: 'Revisões históricas',
};
export function LocalRestoreFlow({
  preview,
  busy,
  onPreview,
  onConfirm,
  onCancel,
}: {
  preview: RestorePreview | null;
  busy: 'selecting' | 'validating' | 'restoring' | null;
  onPreview(password: string): void;
  onConfirm(): void;
  onCancel(): void;
}) {
  const [password, setPassword] = useState(''),
    [acknowledged, setAcknowledged] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null),
    submitted = useRef(false);
  useEffect(() => {
    document.title = 'Financial Manager · Restaurar backup';
    heading.current?.focus();
  }, [preview, busy]);
  return (
    <div className="fm-entry">
      <header className="entry-brand">Financial Manager</header>
      <main className="local-main">
        <section
          className="entry-card local-card"
          aria-labelledby="restore-heading"
        >
          <h1 id="restore-heading" ref={heading} tabIndex={-1}>
            {busy
              ? 'Processando restauração'
              : preview
                ? 'Prévia da restauração'
                : 'Restaurar backup'}
          </h1>
          {busy ? (
            <>
              <p role="status">
                {busy === 'selecting'
                  ? 'Escolha um pacote .fmbackup no diálogo do Windows. Com PIN ativo, será necessário desbloquear novamente.'
                  : busy === 'validating'
                    ? 'Validando senha, integridade e dados em staging criptografado…'
                    : 'Registrando um novo espaço local após a verificação final…'}
              </p>
              <p>
                Nenhum espaço existente será substituído. Conteúdo e campos
                ficam ocultos durante o processamento.
              </p>
            </>
          ) : preview ? (
            <>
              <p>
                Backup de <strong>{preview.source_name}</strong>, criado em{' '}
                {new Date(preview.backup_created_at).toLocaleString('pt-BR')}.
              </p>
              <p>
                Novo espaço: <strong>{preview.display_name}</strong>.
                Armazenamento Local, neste computador.
              </p>
              <dl>
                {restoreTables.map((table) => (
                  <div key={table}>
                    <dt>{labels[table]}</dt>
                    <dd>{preview.record_counts[table]}</dd>
                  </div>
                ))}
              </dl>
              <p>
                Os dados foram validados em staging. A cópia terá novas
                identidades e uma nova chave protegida pelo Windows. Valores,
                vínculos e histórico serão preservados. Ela não reconecta um
                espaço cloud e não altera os espaços já existentes.
              </p>
              <label className="backup-ack">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                Confirmo a criação de um novo espaço local com estes registros.
              </label>
              <button
                className="entry-primary"
                type="button"
                disabled={!acknowledged || submitted.current}
                onClick={() => {
                  if (submitted.current) return;
                  submitted.current = true;
                  onConfirm();
                }}
              >
                Restaurar como novo espaço
              </button>
            </>
          ) : (
            <>
              <p>
                Pacote selecionado no Windows. Informe sua senha original; o
                aplicativo não a guarda. PIN e Windows Hello não recuperam essa
                senha.
              </p>
              <p>
                Você poderá revisar as contas e os registros antes de confirmar.
                Nenhum espaço existente será substituído.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (submitted.current || !validRecoveryPassword(password))
                    return;
                  submitted.current = true;
                  const secret = password;
                  setPassword('');
                  onPreview(secret);
                }}
              >
                <label htmlFor="restore-password">
                  Senha original do backup
                </label>
                <input
                  id="restore-password"
                  type="password"
                  autoComplete="off"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  maxLength={256}
                  required
                />
                <button
                  className="entry-primary"
                  type="submit"
                  disabled={!validRecoveryPassword(password)}
                >
                  Validar e apresentar prévia
                </button>
              </form>
            </>
          )}
          <button
            type="button"
            className="entry-secondary"
            onClick={() => {
              setPassword('');
              onCancel();
            }}
          >
            {busy
              ? 'Cancelar solicitação de restauração'
              : 'Cancelar restauração'}
          </button>
        </section>
      </main>
    </div>
  );
}
