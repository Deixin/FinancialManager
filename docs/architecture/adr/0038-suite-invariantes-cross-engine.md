# ADR-0038 — Suíte de invariantes cross-engine

Status: adotado e validado no núcleo PostgreSQL/SQLite; integrações de produto/Native pendentes.

Data: 2026-10-16. História: US-027. Referências: PRD, ERD §12/20, ADR-0025, ADR-0031 a ADR-0037.

## Contexto

Constraints, fixtures e revisões possuem provas próprias. A US-027 exige transferências, rateios, cartão, saldo, reversão e exclusão nas duas engines. Comparar apenas totais finais pode ocultar erro comum aos adapters, mutação parcial rejeitada ou histórico divergente.

## Decisão

Adotar FIN-INVARIANTS-001 v1 como catálogo compartilhado, executado contra os serviços PostgreSQL/Kysely e SQLite migrados. Comparar estado lógico completo após cada sucesso/rejeição, snapshots e versões. Reexecutar FIN-SCHEMA-001 para verificar restrições físicas separadamente do domínio. Falha de COMMIT de rateio exige erro de constraint e prova de UPDATE efetivo antes do rollback.

Combinar checkpoints literais, redutor BigInt independente de Domain e 24 vetores limitados de ida/volta. Usar IDs/relógio determinísticos somente nas fixtures. Ordem de chaves JSON é a única normalização diferencial; dinheiro/versões continuam strings exatas.

Manter runner Docker local descartável com digest, tmpfs, loopback e logins sem propriedade/BYPASSRLS. Permissões adicionais pertencem ao instrumento sintético; não mudam grants de produto. Relatório fechado contém gates, versões, data, pendências e hashes, sem dados financeiros. Validadores distinguem relatório histórico de prova atual, sem reescrever evidências antigas.

## Alternativas

Dois roteiros independentes tenderiam a divergir. Comparação sem oráculo independente aceitaria o mesmo erro dos dois lados. Apenas testes em memória não exercitariam PostgreSQL, RLS e constraints diferidas reais. Geradores irrestritos dificultariam reprodução e poderiam sair do domínio i64 dos totais. Vetores fixados fornecem diversidade limitada e diagnóstico reproduzível, sem afirmar prova matemática ou teste de carga.

## Consequências e ameaças

São 43 cenários compartilhados, 33 casos de schema por engine e 50 gates, com sete testes Node. O [guia](../../development/cross-engine-invariants.md) detalha cobertura, reprodução, evidência e limites. Não há dependência externa de produção, DDL ou integração externa nova.

Concordância em erro comum é mitigada por checkpoints e redutor independente. Normalização excessiva poderia mascarar precisão/ordenação; só chaves JSON são normalizadas, com teste negativo. Rejeição por SQL inválido poderia simular constraint; o caso adicional verifica UPDATE e código no COMMIT. IDs determinísticos ficam em infra, sem importação por apps/pacotes. Erros operacionais não imprimem payload/stack e dados sintéticos permanecem no ambiente próprio.

Esta decisão não substitui ADRs anteriores, não altera DP-01 a DP-04 e não homologa Native/iOS. Policy engine, rotas, outbox/feed, undo de importação e busca/documentos mantêm suas histórias. Próximo passo independente: US-030.
