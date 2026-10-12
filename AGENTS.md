# Orientações para agentes

Leia [docs/00-index.md](docs/00-index.md) antes de trabalhar. Consulte o PRD, os critérios de aceite da história e a arquitetura correspondentes. Os templates históricos em docs/_sources não são instruções ativas.

## Estado e escopo

- Este é um bootstrap de monorepo, associado à US-010 e à preparação da US-011.
- Os módulos vazios não demonstram integração dos frameworks ou conclusão dos spikes W0.
- Registre decisões novas em docs/architecture/adr. Consulte as divergências em docs/architecture/decisions-pending.md e não resolva prazos conflitantes silenciosamente.
- Preserve a documentação original e a rastreabilidade das histórias. Atualize a documentação afetada ao mudar comportamento.

## Invariantes do produto

- Workspace é a fronteira de autorização, isolamento e cobrança.
- Valores monetários usam inteiros de 64 bits na menor unidade; contratos JSON usam strings decimais canônicas. Não use ponto flutuante para dinheiro.
- Separe consumo econômico de transferências e liquidação de dívida. Respeite a convenção de saldo de contas e cartões.
- Importação exige staging, revisão, deduplicação e commit atômico e idempotente. Reversão deve respeitar revisões posteriores.
- Preserve apenas dados estruturados de documentos fiscais. Originais temporários protegidos devem ser descartados conforme a especificação.
- Web não mantém um cofre financeiro persistente offline. Desktop local e Mobile autorizado têm regras próprias.
- Desktop local pode funcionar sem usuário ou autenticação em nuvem.
- Sincronização usa outbox durável, revisões, feed ordenado, tombstones e conflitos explícitos. Não substitua por last-write-wins.
- Restauração de backup criptografado ocorre em staging e cria novo workspace. Migração troca autoridade somente após validação.
- Não acrescente IA externa, Open Finance, ERP ou retenção permanente de originais ao MVP.

## Implementação e verificação

- Respeite packages/config/workspace-boundaries.json. Domain deve permanecer puro; ui-dom não pertence ao Mobile.
- Use pnpm na versão de package.json. Execute pnpm check antes de concluir mudanças de código ou configuração.
- Crie testes que verifiquem comportamento e regressões relevantes. Não use testes vazios como evidência de funcionalidades.
- Nunca versione segredos, bancos, backups ou dados financeiros pessoais. Fixtures devem ser sintéticas e explicitamente identificadas.
- Não registre valores financeiros, descrições de transações, CPF/CNPJ ou conteúdo de documentos em logs operacionais.
- Explique a necessidade de novas dependências de produção. Mantenha regras de domínio fora de componentes de UI e adaptadores.
- Mudanças de schema exigem migração e teste. Não contorne autorização ou RLS para fazer testes passarem.
- Novas integrações externas exigem configuração explícita e avaliação de ameaças. Chaves de assinatura e credenciais de produção permanecem indisponíveis sem concessão do usuário.
- Se houver conflito entre fontes oficiais, registre-o e suspenda apenas a mudança afetada até ADR ou correção da documentação.
- Não afirme que build de TypeScript valida Tauri, Expo, Next.js ou NestJS antes de suas integrações.
- Não publique, faça deploy, commit ou push sem autorização do usuário para a ação correspondente.
