# Processo incremental de desenvolvimento

Contrato: [ADR-0070](../architecture/adr/0070-validacao-incremental-e-evidencias-imutaveis.md). Estado: [resumo atual](../delivery/status.md). O objetivo é reduzir repetição mantendo os gates de segurança e integridade financeira.

## Antes de editar

1. Leia o índice e o estado atual; localize os critérios da história, os requisitos e ADRs pertinentes.
2. Defina o incremento e seu término verificável. Para passar a outro chat, registre commit-base, história, decisões, arquivos modificados, validações concluídas e pendências. Não dependa da memória de um chat extenso.
3. Confira `git status` e preserve trabalho existente. Planeje com:

```text
node infra/validation/cli.mjs plan
```

O resultado distingue protocolos pendentes, entradas reutilizáveis e arquivos sem cobertura. Não é evidência de execução de testes.

## Durante o incremento

Execute testes de comportamento focados após mudar o código. Antes de protocolos nativos, resolva erros de tipos, geração, fixtures e referências. Atualize a função de fontes do produtor quando adicionar/remover uma dependência funcional. Os produtores e seus cenários existentes permanecem a fonte de cobertura.

O catálogo separa o resultado da execução e sua referência vigente. Não reescreva evidências antigas, não substitua hashes por valores atuais e não crie scripts temporários de congelamento/renovação por história. O runner faz essas verificações.

Arquivo funcional sem cobertura não pode ser liberado simplesmente atualizando `inventory`. Inclua-o no protocolo responsável; se for um novo protocolo, registre explicitamente comando, saída, validador, fontes e resultado real antes de concluir. Revise essa mudança como parte da entrega. O inventário inicial permite reconhecer arquivos existentes que ainda não têm protocolo cadastrado; alterá-los exige cobertura explícita.

## Validar e concluir

```text
node infra/validation/cli.mjs run
```

Havendo protocolos pendentes, o runner executa `pnpm format:check`, `pnpm lint`, `pnpm typecheck` e `pnpm build` antes deles. Depois da fila, executa **sempre `pnpm check`**, incluindo os testes atuais e a auditoria do catálogo. As versões de pnpm/Node continuam sendo as definidas pelo projeto.

Os relatórios já válidos são reutilizados com suas datas/versões originais. Novas execuções precisam produzir saída recente e íntegra. Cada sucesso é arquivado em `docs/quality/evidence/runs/<sha256>.json`; o catálogo aponta para ele sem alterar testes consumidores. Logs e métricas ficam em `.tools/validation/`. Uma interrupção não transforma resultados parciais em aprovação integral.

Relatórios em `runs/` são excluídos da formatação automática: seus bytes são o artefato validado e seu digest é conferido pelo catálogo. O catálogo editável é formatado pelo próprio executor antes da publicação atômica.

Para repetir um protocolo específico além dos pendentes:

```text
node infra/validation/cli.mjs run --suite=us050-desktop-imports-browser
```

Para release/marco integrado ou homologação de novo ambiente:

```text
node infra/validation/cli.mjs run --full
```

A fila é serial e preserva os perfis sintéticos e a limpeza dos produtores. Não execute duas filas no mesmo checkout. Após interrupção abrupta, confira o PID registrado em `.tools/validation/run.lock`; só remova esse arquivo depois de confirmar que não existe executor ativo e verificar a limpeza dos recursos próprios dos protocolos. A próxima execução reavalia as entradas antes de reutilizar qualquer resultado.

Alteração de migration/schema, autorização/RLS, dinheiro, revisões, chaves, cofre, comandos, backup ou restauração aciona guardas amplos. Não reduza essa seleção para acelerar a entrega. Uma alteração de documentação não aciona protocolos de produto; alteração dos testes consumidores exige sua execução atual no `pnpm check`.

## Comunicação e manutenção

- Informe o que mudou, quais protocolos rodaram, quais resultados anteriores foram reutilizados e o resultado do gate final. Cite limitações reais.
- Depois de sucesso, só repita se houve mudança de entrada, falha ou preocupação concreta ainda aberta. Não edite fontes durante protocolo longo: o runner rejeita resultados instáveis.
- Preserve homologações humanas e de outras plataformas como pendentes. TypeScript não comprova um runtime nativo.
- Atualize o resumo de estado e a documentação afetada. Consulte o histórico apenas quando necessário.
- Commit/push/publicação seguem a autorização do usuário; o executor não faz nenhuma dessas ações.
- Use skills apenas quando contribuírem para a tarefa; scripts versionados são o mecanismo principal deste processo.
