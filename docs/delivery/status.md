# Estado atual do Financial Manager

Atualizado em 2026-10-21. Este arquivo contém o estado vigente; o [histórico de entregas](status-history.md) preserva o conteúdo anterior.

- **Último incremento funcional:** US-050 Desktop, commit acf51ca6322bfc6f753d3fe87370a4f54eaef4dd. Central de importações, paridade Rust e backup/restauração v3 compatíveis com backups antigos. [Detalhes](../development/desktop-imports.md).
- **Incremento técnico atual:** catálogo de evidências e execução incremental conforme [ADR-0070](../architecture/adr/0070-validacao-incremental-e-evidencias-imutaveis.md). Relatórios anteriores preservados, sem atribuir novas execuções à migração do catálogo. Validação local concluída: `pnpm check` aprovado com 519 testes, sem falhas ou skips; protocolo Chromium real da US-050 aprovado e arquivado pelo runner. A retomada reutilizou os 53 resultados vigentes e executou o gate final em 65,7 s. As alterações de consumidores invalidariam 47 relatórios pela regra anterior; nenhuma fonte funcional mudou. Os três documentos históricos foram conferidos byte a byte contra o commit-base. A US-051 permanece não iniciada.
- **Próxima história funcional:** US-051, validação defensiva de arquivos. Não iniciada por este incremento técnico.
- **Limites:** sem mudança de schema, regras monetárias, autorização, RLS, criptografia, backup, restauração ou dependências de produção.
- **Pendências:** homologação humana após integração completa ([ADR-0044](../architecture/adr/0044-homologacao-humana-apos-integracao.md)); decisões DP-01 a DP-04 e gates cloud/Mobile permanecem como descritos nas [decisões pendentes](../architecture/decisions-pending.md). Execução local não presume CI remota, assinatura ou homologação humana.

Para continuar, leia os critérios da US-051 no [backlog](05-backlog.md), os requisitos pertinentes e o [processo de validação](../development/validation-workflow.md). Registre escopo, arquivos de entrada e critérios de término antes da execução longa.
