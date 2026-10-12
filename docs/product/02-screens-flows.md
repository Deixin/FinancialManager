# Financial Manager — Mapa de Telas e Fluxos
## Documento de experiência e navegação · v1.0 · 05/10/2026

> Artefato derivado do **PRD Financial Manager v1.0**. Este documento descreve a arquitetura de informação, o inventário de telas, os estados obrigatórios e os fluxos ponta a ponta do MVP. Não fixa identidade visual, componentes finais ou medidas de layout; esses pontos pertencem ao wireframe/protótipo.

---

## 00 · Objetivo, escopo e convenções

### Objetivo

O mapa transforma os requisitos do PRD em uma estrutura navegável para **Desktop, Web e Mobile**, com ênfase no trabalho principal do produto: ajudar a pessoa a responder **“para onde meu dinheiro está indo?”** sem perder o controle sobre onde seus dados ficam e quem pode acessá-los.

O artefato deve permitir que produto, design, engenharia e QA respondam, antes do wireframe:

- que telas existem no MVP;
- de onde cada tela é acessada e para onde pode levar;
- quais telas são locais, cloud ou compartilhadas entre os dois modos;
- quais ações dependem de papel/permissão;
- como o usuário entra, importa, revisa, categoriza, pesquisa, concilia, exporta e migra dados;
- como erros, conflitos, estados vazios e ações destrutivas aparecem;
- quais partes são P0, P1 e evolução.

### Convenções de identificadores

| Prefixo | Domínio |
| --- | --- |
| EN | Entrada, autenticação e recuperação |
| WS | Espaços/workspaces e seleção de contexto |
| VG | Visão geral/dashboard |
| MV | Movimentações e edição financeira |
| CT | Contas e cartões |
| IM | Importações e histórico de lotes |
| DC | Documentos, itens e conciliação |
| RP | Relatórios e detalhamento |
| CF | Configurações do espaço |
| MB | Membros, papéis e permissões |
| SY | Sincronização e conflitos |
| BK | Backup, migração, arquivamento e ciclo de vida |
| EX | Exportação e suporte |
| FL | Fluxo ponta a ponta |

### Legenda de prioridade e plataforma

**P0:** bloqueia o MVP. **P1:** desejável, mas não bloqueia o beta. **EV:** evolução.

**D:** Desktop. **W:** Web. **M:** Mobile. **L:** espaço exclusivamente local. **C:** espaço em nuvem.

### Regra central de contexto

Toda tela financeira opera dentro de **um único espaço ativo**. Alterar o espaço ativo limpa filtros incompatíveis, recalcula totais e aplica o novo escopo de permissão. Não existe uma “visão consolidada” automática entre espaço pessoal e empresas no MVP.

---

## 01 · Arquitetura de navegação

### 1.1 Desktop — modo local e cloud

A navegação principal do Desktop usa uma estrutura persistente com seletor de espaço e módulos do espaço ativo.

```text
Financial Manager Desktop
│
├── Seletor de espaço
│   ├── Espaços locais
│   ├── Espaços cloud
│   └── + Criar espaço
│
├── Visão geral
├── Movimentações
├── Contas e cartões
├── Importações
├── Documentos e itens
├── Relatórios
└── Configurações
    ├── Geral
    ├── Categorias e regras
    ├── Membros e permissões ........ cloud
    ├── Sincronização e dispositivos  cloud
    ├── Backup e restauração ......... local
    ├── Migração Local ↔ Nuvem ....... Desktop
    ├── Exportação
    └── Arquivar / excluir
```

No Desktop, a identidade e o espaço são conceitos separados. O usuário pode estar logado e ainda manter espaços exclusivamente locais que nunca foram enviados para a nuvem.

### 1.2 Web — cloud obrigatório

```text
Financial Manager Web
│
├── Entrada / cadastro
├── Seletor de espaço cloud
│
├── Visão geral
├── Movimentações
├── Contas e cartões
├── Importações
├── Documentos e itens
├── Relatórios
└── Configurações
    ├── Geral
    ├── Categorias e regras
    ├── Membros e permissões
    ├── Sincronização/dispositivos
    ├── Exportação
    └── Arquivar / excluir
```

A Web não possui workspace exclusivamente local e não mantém banco financeiro persistente para operação offline no MVP.

### 1.3 Mobile — consulta e operação cloud

No Mobile, a navegação precisa privilegiar frequência e legibilidade. Uma proposta de IA é:

```text
Barra inferior
├── Início
├── Movimentos
├── + Adicionar
├── Buscar
└── Mais
    ├── Contas e cartões
    ├── Importações
    ├── Documentos
    ├── Relatórios
    ├── Sincronização
    └── Configurações
```

O seletor de espaço fica no topo de Início e permanece disponível em “Mais”. Importação e revisão continuam funcionais no Mobile, mas usam etapas sequenciais em vez de tabelas muito densas.

### 1.4 Cabeçalho global

Elementos que devem permanecer previsíveis nas três plataformas, respeitando espaço e permissão:

- nome do espaço ativo;
- indicador **Local** ou **Nuvem**;
- estado de sincronização quando aplicável;
- acesso à busca global;
- avatar/conta quando autenticado;
- aviso de visão parcial quando o membro não vê todas as contas do espaço.

No Desktop local sem conta, avatar/login é substituído por ação discreta **“Entrar para usar a nuvem”**, sem bloquear o produto.

---

## 02 · Primeiro acesso e identidade

### EN-01 · Entrada Desktop — P0 · D/L+C

**Objetivo:** permitir que uma instalação nova entre no produto sem rede nem cadastro.

**Elementos principais:**
- Continuar sem conta;
- Entrar;
- Criar conta;
- explicação curta: uso local não envia dados financeiros;
- link para privacidade/termos quando houver conexão, sem impedir uso local essencial.

**Saídas:**
- Continuar sem conta → WS-01;
- Entrar → EN-02;
- Criar conta → EN-03.

**Estado sem rede:** Continuar sem conta continua disponível; provedores cloud são apresentados como indisponíveis.

### EN-02 · Entrar — P0 · D/W/M

Login por e-mail, Google ou Apple. E-mail possui recuperação de acesso. A tela não sugere que login enviará espaços locais existentes.

**Saídas:**
- sucesso com espaço existente → WS-03;
- sucesso sem espaço cloud → WS-01;
- esqueci minha senha → EN-04;
- retorno ao Desktop anônimo → EN-01.

### EN-03 · Criar conta — P0 · D/W/M

Campos mínimos para fluxo de e-mail e alternativas Google/Apple. Após cadastro, apresentar verificação quando aplicável.

**Regra UX:** cadastro cria identidade, não cria automaticamente workspace cloud antes da confirmação do guia.

### EN-04 · Recuperar acesso — P0 · D/W/M

Fluxo de e-mail seguro, estado “mensagem enviada”, redefinição e retorno à entrada. Não recupera senha de pacote de backup local.

### EN-05 · MFA individual — P0 · D/W/M

Acessível em configurações da conta. Interface recomenda ativação, permite configuração e recuperação segundo mecanismo definido na arquitetura. Imposição por administrador é evolução.

---

## 03 · Criação, seleção e contexto de espaços

### WS-01 · Guia do primeiro espaço — P0 · D/W/M

**Desktop anônimo:** permite somente **Local**.

**Desktop autenticado:** permite **Local** ou **Nuvem**.

**Web/Mobile:** cria somente **Nuvem**.

Etapas recomendadas:

1. **Para que você vai usar este espaço?** Pessoal / Empresa / Outro.
2. **Nome do espaço.** Nome livre; exemplos contextuais.
3. **Sobre quem/que organização é este espaço?** campos opcionais: nome, CPF/CNPJ, natureza jurídica/descrição.
4. **Onde os dados ficarão?** apenas quando a plataforma permitir escolha.
5. **Criar primeira conta financeira agora?** recomendado, mas pode pular.

**Saídas:**
- criar conta financeira → CT-02;
- pular → VG-01 com estado vazio orientado.

### WS-02 · Criar outro espaço — P0 · D/W/M

Acessado pelo seletor. Reusa WS-01, mas sem linguagem de “primeiro acesso”. No Desktop, autenticar-se não altera espaços locais existentes.

### WS-03 · Seletor de espaço — P0 · D/W/M

Cada item mostra:
- nome;
- tipo/finalidade;
- Local ou Nuvem;
- papel no espaço cloud;
- indicador de sincronização quando relevante;
- arquivado/atenção quando aplicável.

Ações por plataforma:
- abrir;
- criar espaço;
- Desktop: filtrar Local/Cloud;
- cloud: aceitar convite pendente quando houver.

### WS-04 · Convite pendente — P0 · D/W/M

Mostra remetente/espaço, papel, escopo de contas quando limitado e data de expiração. O usuário aceita ou recusa. Não existe link público anônimo.

---

## 04 · Visão geral

### VG-01 · Dashboard do espaço — P0 · D/W/M

**Perguntas que a tela deve responder:**
1. Quanto tenho disponível?
2. Quanto gastei no período?
3. Em quê estou gastando?

**Blocos mínimos:**
- saldo disponível;
- dívida de cartão separada;
- despesas no período;
- maiores categorias;
- gráfico/representação de composição;
- movimentações recentes;
- alertas de qualidade/confiança;
- próximos compromissos somente quando RF-09/P1 estiver disponível.

**Filtros:** período e contas autorizadas. Alterar filtro atualiza todos os blocos compatíveis.

**Drill-downs:**
- saldo → CT-01 ou RP-02 com contas filtradas;
- despesa total → RP-01;
- categoria → RP-03;
- movimentação recente → MV-03;
- alerta de importação → IM-02/IM-07;
- conflito → SY-02.

**Estados de confiança:**
- conta sem saldo de referência;
- importação em revisão;
- dados parcialmente sincronizados;
- conta fora do escopo do usuário;
- conflito aberto;
- cobertura parcial do período.

### VG-02 · Estado vazio inicial — P0 · D/W/M

Nunca exibir um dashboard zerado como se houvesse análise suficiente. Mostrar passo recomendado:

1. Adicionar conta;
2. importar extrato **ou** adicionar movimentação;
3. categorizar/revisar;
4. voltar ao painel.

No Desktop local, também lembrar backup após existir informação financeira relevante.

---

## 05 · Movimentações

### MV-01 · Lista de movimentações — P0 · D/W/M

**Colunas/campos principais:** data, nome, conta, categoria, tipo, valor e estado. Desktop/Web podem usar tabela; Mobile usa lista/cards compactos.

**Filtros:** período, conta, entrada/gasto/transferência, categoria, subcategoria, tags, origem, não classificado, conciliado/não conciliado.

**Ações:**
- abrir detalhe;
- adicionar;
- editar quando autorizado;
- selecionar para classificação em lote quando aplicável;
- exportar conforme permissão;
- abrir origem/importação.

### MV-02 · Nova movimentação — P0 · D/W/M

Tipos visíveis em linguagem natural:
- Entrada;
- Gasto;
- Transferência.

Campos: conta, data, valor, descrição/nome, categoria, subcategoria, tags, contraparte opcional e observação. Transferência exige origem e destino e deve ser atômica.

**Saldo inicial/ajuste:** não misturar ao fluxo padrão de gasto. Ajustes usam ação específica em CT-03.

### MV-03 · Detalhe da movimentação — P0 · D/W/M

Exibe:
- valor e tipo;
- descrição original e nome ajustado;
- conta;
- classificação/rateio;
- tags;
- contraparte;
- origem: manual/importação/documento;
- documento/itens vinculados;
- histórico/revisões disponíveis;
- conciliações;
- fatura/cartão quando aplicável.

**Ações autorizadas:** editar, dividir classificação, vincular/desvincular documento, restaurar quando excluído logicamente, excluir logicamente, abrir lote de origem.

### MV-04 · Editar classificação/rateio — P0 · D/W/M

Permite classificação simples ou múltiplas parcelas. A soma precisa coincidir com o total da movimentação. Tags podem valer para o lançamento inteiro; categorias/subcategorias ficam por parcela.

### MV-05 · Exclusão/restauração — P0 · D/W/M

Confirmação contextual informa efeito em saldo, conciliações e histórico. Em cloud, ação gera revisão sincronizável. Restauração não deve ressuscitar vínculo incompatível automaticamente.

---

## 06 · Contas e cartões

### CT-01 · Lista de contas e cartões — P0 · D/W/M

Seções separadas:
- dinheiro/disponibilidades;
- cartões e dívidas simples;
- contas arquivadas quando solicitado.

Cada item mostra saldo/valor devido conforme o tipo, data de referência, última atualização e alerta de incompletude.

### CT-02 · Nova conta — P0 · D/W/M

Campos:
- nome;
- tipo;
- moeda (BRL como padrão do MVP);
- saldo prévio opcional;
- data de referência;
- regra de referência de início/fim do dia quando necessário.

Tipos iniciais: corrente, poupança, digital, carteira/dinheiro, cartão; representação simples de investimento/dívida pode existir sem recursos avançados.

### CT-03 · Detalhe da conta — P0 · D/W/M

Exibe saldo calculado, referência, movimentos, importações relacionadas e estado de conferência.

Ações:
- editar nome/metadados;
- corrigir/adicionar saldo de referência;
- importar extrato;
- adicionar movimentação;
- arquivar conta;
- ver divergência de saldo.

### CT-04 · Cartão — P0 · D/W/M

Visão simplificada:
- compras importadas;
- créditos/estornos;
- pagamentos de fatura conciliados;
- período/fatura quando conhecido;
- dívida atual quando calculável.

Não projetar parcelas futuras que não estejam na fonte. Não somar pagamento da fatura como nova despesa de consumo.

### CT-05 · Conferir saldo — P0 · D/W/M

Mostra saldo esperado pelo sistema, saldo de referência informado/importado, diferença e registros considerados. Ação de ajuste exige confirmação e cria movimento identificado como ajuste, não como receita/despesa automática.

---

## 07 · Importações

### IM-01 · Central de importações — P0 · D/W/M

Mostra:
- iniciar importação;
- lotes em revisão;
- lotes concluídos;
- lotes desfeitos;
- erros/falhas;
- tipo/formato, conta, período, autor e data.

### IM-02 · Selecionar origem e arquivo — P0 · D/W/M

Etapas:
1. escolher conta de destino;
2. selecionar arquivo;
3. detectar tipo/layout;
4. mostrar compatibilidade e período encontrado;
5. quando CSV/XLSX, seguir para mapeamento.

**Desktop local:** processamento permanece local. Falta de suporte não autoriza envio externo.

### IM-03 · Mapear CSV/XLSX — P0 · D/W/M

Mapeia data, descrição, valor ou débito/crédito, moeda e identificadores opcionais. Preview de linhas e convenções de separador/formatação. Salvar mapeamento como preferência do espaço pode ser oferecido.

### IM-04 · Processando/normalizando — P0 · D/W/M

Estado transitório com progresso quando mensurável. Não alterar saldo. Se falhar, mostrar motivo e permitir corrigir/recomeçar sem criar lote financeiro parcial.

### IM-05 · Revisão pré-importação — P0 · D/W/M

Tela crítica do MVP.

Cada registro mostra:
- incluir/excluir;
- descrição original;
- nome proposto;
- data;
- valor/tipo;
- categoria proposta;
- conta;
- situação: novo, repetido, possível repetido, atualização, inválido;
- regra aplicada quando houver.

Ações:
- editar linha;
- aplicar categoria/nome em lote;
- filtrar por situação;
- abrir comparação de duplicidade;
- confirmar somente selecionados;
- cancelar tudo.

Resumo fixo: quantidade e valores de novos/atualizados/ignorados/inválidos.

### IM-06 · Comparar possível duplicidade — P0 · D/W/M

Mostra lado a lado o registro recebido e o já existente, com evidências: identificador, data, valor, conta e descrição. Ações:
- manter atual;
- atualizar campos selecionados;
- apenas vincular evidência;
- manter ambos.

Nunca chamar escore não calibrado de “probabilidade”.

### IM-07 · Confirmar importação — P0 · D/W/M

Resumo final do que será feito. Confirmação cria operação idempotente e lote auditável. Em cloud offline, a interface distingue “confirmado neste dispositivo” de “confirmado no servidor”.

### IM-08 · Resultado do lote — P0 · D/W/M

Apresenta criados, atualizados, vinculados, ignorados e erros. Links para movimentos, regras sugeridas e relatório do lote.

### IM-09 · Histórico/detalhe do lote — P0 · D/W/M

Exibe autor, arquivo/origem, versão do leitor, conta, período, itens afetados, revisões e vínculos. Ação **“Desfazer lote”** quando autorizada.

### IM-10 · Prévia de reversão — P0 · D/W/M

Antes de desfazer:
- criações a remover;
- versões a restaurar;
- vínculos a retirar;
- edições posteriores encontradas;
- conflitos que exigem decisão.

Se houver dependências, o usuário resolve item a item ou cancela. O desfazimento vira novo evento no histórico.

### IM-11 · Regras sugeridas após correção — P0 · D/W/M

Após renomear/categorizar padrão recorrente: **“Aplicar esta regra às próximas importações deste espaço?”**. Mostrar condição, efeito, exemplos e opção de editar antes de salvar.

---

## 08 · Categorias, regras e contrapartes

### CF-01 · Categorias — P0 · D/W/M

Lista hierárquica simples de categorias e subcategorias. Ações de criar, renomear, ordenar e arquivar. Categoria em uso não é apagada sem remapeamento ou arquivamento.

### CF-02 · Tags — P0 · D/W/M

Criar, renomear, pesquisar e arquivar tags. Avisar que tags sobrepostas não representam partes aditivas do orçamento.

### CF-03 · Regras de importação — P0 · D/W/M

Lista de regras com prioridade, condição, ação, status e último uso. Editar/desativar. Testar regra contra amostra sem alterar movimentos. Aplicação retroativa sempre usa prévia e confirmação.

### CF-04 · Contrapartes — P0 · D/W/M

Cadastro leve de nome de exibição, identificador opcional e etiquetas como cliente/fornecedor/outro. Não evoluir para CRM no MVP.

---

## 09 · Documentos, itens e conciliação

### DC-01 · Central de documentos e itens — P0 · D/W/M

Abas/filtros:
- documentos;
- itens;
- não vinculados;
- com divergência;
- conciliados.

Ação principal: **Adicionar documento**.

### DC-02 · Selecionar documento — P0 · D/W/M

Prioridades: XML NF-e/NFC-e homologado e PDF textual homologado. P1: imagem/QR/outros comprovantes.

A tela deve informar que o arquivo original não será mantido no MVP após extração, salvo temporariamente apenas durante o processamento necessário.

### DC-03 · Revisar extração — P0 · D/W/M

Mostra tipo, chave/identificador, emissor, datas, total, descontos/acréscimos e itens. Campos ausentes permanecem vazios. Divergências e proveniência aparecem antes de confirmar.

Ações:
- corrigir campo;
- corrigir item;
- descartar extração;
- confirmar dados extraídos;
- seguir para conciliação/criação de movimento.

### DC-04 · Detalhe do documento — P0 · D/W/M

Dados estruturados, itens, total, ajustes, origem e vínculos financeiros. O original não está disponível por padrão; ação “Selecionar arquivo novamente” pode refazer a extração.

### DC-05 · Itens do documento — P0 · D/W/M

Lista com descrição original/ajustada, quantidade, unidade, valor unitário, descontos, acréscimos e valor líquido. Permite categorizar itens e abrir rateio.

### DC-06 · Divergência de total/rateio — P0 · D/W/M

Quando soma de itens/ajustes não confere, mostrar:
- total do documento;
- total calculado;
- diferença;
- distribuição proporcional sugerida para desconto global quando aplicável.

Bloqueia rateio financeiro confirmado enquanto inconsistência não estiver resolvida ou explicitamente registrada.

### DC-07 · Conciliação assistida — P0 · D/W/M

Mostra documento à esquerda e candidatos à direita (ou sequencialmente no Mobile). Evidências: valor, datas, contraparte, identificadores, conta e descrição.

Ações:
- vincular candidato;
- alocar valor parcial;
- procurar outro movimento;
- criar novo movimento;
- deixar não conciliado.

Suporta vários pagamentos para um documento e vários documentos para um pagamento, sem permitir alocação superior ao valor disponível sem ajuste explícito.

### DC-08 · Busca global/detalhada — P0 · D/W/M

Pesquisa descrições, contrapartes, tags e itens. Filtros: período, conta, categoria, subcategoria, tag, fornecedor e vínculo.

Ao buscar **“energético”**, resultado de item mostra:
- estabelecimento/documento;
- data;
- produto;
- quantidade;
- valor unitário quando conhecido;
- valor líquido da linha;
- total dos itens encontrados no período.

A soma não inclui o valor total das notas. Distinguir “valor dos itens nas notas” de “valor pago conciliado”.

---

## 10 · Relatórios

### RP-01 · Central de relatórios — P0 · D/W/M

Entradas principais:
- Despesas de consumo;
- Entradas e saídas de caixa;
- Gastos por categoria;
- Saldo por conta;
- Itens encontrados/pesquisa;
- Comparação entre períodos.

Não usar “DRE” no MVP.

### RP-02 · Saldo e disponibilidade — P0 · D/W/M

Lista contas incluídas, saldo de referência, movimentos posteriores e alertas. Dívidas aparecem separadas. Visão parcial quando permissões restringem contas.

### RP-03 · Gastos por categoria — P0 · D/W/M

Gráfico + alternativa tabular. Cada categoria abre movimentos/rateios correspondentes. “Não classificado” nunca some do total.

### RP-04 · Entradas e saídas — P0 · D/W/M

Mostra caixa efetivo e separa transferências, pagamento de cartão e ajustes. Não chama diferença de lucro.

### RP-05 · Comparar períodos — P0 · D/W/M

Semana, mês, semestre, ano e intervalo personalizado. Informa mudanças de cobertura que prejudicam comparabilidade: nova conta, período incompleto ou importação pendente.

### RP-06 · Detalhe da evidência — P0 · D/W/M

Todo valor agregado deve permitir abrir os registros que o compõem, mantendo filtros e base temporal. É uma regra transversal de explicabilidade, não apenas uma tela isolada.

---

## 11 · Membros, permissões e colaboração cloud

### MB-01 · Membros do espaço — P0 · D/W/M · C

Lista pessoa, papel, escopo, status de convite, acesso offline permitido e última atividade relevante quando apropriado.

### MB-02 · Convidar membro — P0 · D/W/M · C

Campos:
- e-mail/destinatário;
- papel: Administrador, Editor ou Leitor;
- contas/recursos acessíveis;
- exportação permitida ou negada;
- acesso offline permitido/negado;
- expiração do convite.

Proprietário não é criado por convite comum; transferência usa fluxo próprio.

### MB-03 · Editar acesso — P0 · D/W/M · C

Mostra papel e capacidades efetivas. Um administrador não concede a si mesmo permissões negadas nem transfere propriedade.

### MB-04 · Revogar acesso — P0 · D/W/M · C

Confirma efeito: servidor bloqueia imediatamente novas operações; dispositivos recebem solicitação de limpeza na próxima conexão; cópias/exportações antigas podem persistir fora do controle técnico. Operações pendentes são revalidadas.

### MB-05 · Transferir propriedade — P0 · D/W/M · C

Somente proprietário. Exige autenticação recente, seleção de membro elegível e aceite do destinatário. Até aceite, a propriedade atual permanece. Registrar auditoria.

### MB-06 · Permissões insuficientes — P0 · D/W/M

Estado reutilizável em qualquer tela/ação. Explica qual capacidade está ausente sem revelar dados escondidos. Não mostrar detalhes de contas proibidas no próprio erro.

---

## 12 · Sincronização e conflitos

### SY-01 · Estado de sincronização — P0 · D/M · C

Indicadores:
- Sincronizado;
- Salvo neste dispositivo / aguardando envio;
- Sincronizando;
- Conflito;
- Offline;
- Acesso precisa ser revalidado;
- Acesso revogado.

Web mostra apenas conectividade/estado do servidor, pois não mantém modo offline financeiro no MVP.

### SY-02 · Central de conflitos — P0 · D/M/W leitura · C

Lista registros com conflitos pendentes, tipo de conflito e impacto. Leitor pode visualizar aviso; resolver exige escrita adequada.

### SY-03 · Resolver conflito — P0 · D/M/W · C

Comparação de:
- versão-base;
- versão local;
- versão remota confirmada.

Para campos independentes, pode haver merge sugerido. Para valor, data, conta, categoria ou exclusão concorrente, exigir decisão explícita. Resolver cria nova revisão.

### SY-04 · Dispositivos e acesso offline — P0 · D/W/M · C

Lista dispositivos autorizados, última sincronização, offline habilitado e estado de revalidação. Proprietário controla a permissão de cache offline por membro/dispositivo conforme política do MVP.

---

## 13 · Backup, migração e ciclo de vida

### BK-01 · Backup local — P0 · D/L

Explica que o espaço existe apenas naquele computador. Ações:
- Criar backup criptografado;
- Restaurar backup;
- ver última data de backup criada pelo app quando conhecida.

Criação solicita senha/chave de recuperação e destino de arquivo. O aplicativo não guarda a senha do pacote.

### BK-02 · Restaurar backup — P0 · D/L

Selecionar pacote → informar segredo → validar integridade → apresentar prévia → restaurar como novo espaço por padrão. Erro de senha ou adulteração não modifica espaço existente.

### BK-03 · Migrar Local → Nuvem — P0 · D

Etapas:
1. explicar o que muda e o que será enviado;
2. entrar/criar conta se necessário;
3. confirmar finalidade/armazenamento;
4. revisar contagens, totais e plano aplicável;
5. criar snapshot local consistente;
6. enviar e validar;
7. ativar espaço cloud;
8. só então permitir convites.

Falha preserva origem local e oferece retomar/cancelar. Login por si só nunca dispara este fluxo.

### BK-04 · Migrar Nuvem → Local — P0 · D/C→L

Somente proprietário no Desktop.

Etapas:
1. autenticação recente;
2. verificar conexão e pendências;
3. mostrar última sincronização dos dispositivos conhecidos;
4. impedir novas gravações cloud/ponto de corte;
5. baixar snapshot;
6. verificar contagens e totais;
7. disponibilizar cópia local;
8. revogar compartilhamento cloud;
9. arquivar origem cloud por 30 dias.

Se algum dispositivo tiver pendência não enviada, mostrar risco antes do ponto de corte.

### BK-05 · Espaços arquivados — P0 · D/W/M · C

Lista nome, data de arquivamento, data prevista de exclusão e motivo/origem. Ações conforme permissão:
- restaurar dentro da janela;
- solicitar exclusão definitiva.

### BK-06 · Arquivar espaço — P0 · D/W/M · C

Confirmação de alto impacto nomeia o espaço e explica: interromper escrita/sincronização, retirar acesso operacional e manter recuperação por 30 dias.

### BK-07 · Excluir definitivamente — P0 · D/W/M · C

Disponível sobre espaço arquivado conforme regras. Mostra datas concretas para remoção operacional e expiração de backups segundo política vigente. Exige autenticação recente e confirmação forte.

### BK-08 · Falha/retomada de migração — P0 · D

Estado obrigatório com origem preservada, etapa concluída, etapa pendente e ação segura de retomar ou cancelar. Nunca apresentar duas bases como ativas e equivalentes sem definir qual é a fonte de verdade.

---

## 14 · Exportação, suporte e configurações gerais

### EX-01 · Exportar dados — P0 · D/W/M

Formatos P0:
- CSV para movimentações/itens;
- JSON versionado para estrutura completa autorizada.

Fluxo: selecionar conjunto → filtros → campos sensíveis/mascaramento → prévia → gerar. Respeita escopo e permissão de exportação. Não inclui tokens ou outro espaço.

### EX-02 · Prévia de exportação — P0 · D/W/M

Mostra período, contas, quantidade de registros, moeda/base temporal e campos removidos/mascarados. Permite revisar antes de gerar o arquivo.

### EX-03 · Autorizar suporte — P0 · D/W/M · C

Somente proprietário. Mostra escopo, motivo e validade. Proposta v1: leitura até 24 h e exportação desligada. Acesso pode ser revogado antecipadamente.

### EX-04 · Acessos de suporte ativos — P0 · D/W/M · C

Lista quem/qual sessão, escopo, início, expiração e status. Link para auditoria.

### CF-05 · Configurações gerais do espaço — P0 · D/W/M

Nome, finalidade, dados opcionais de pessoa/organização, moeda padrão/limites do MVP e preferências de apresentação. Indica claramente Local/Nuvem.

### CF-06 · Configurações da conta — P0 · D/W/M autenticado

Perfil, provedores vinculados, senha quando aplicável, MFA, sessões/dispositivos e encerramento da identidade respeitando propriedades de espaços.

---

## 15 · Mapa resumido de telas por plataforma

| ID | Tela | Desktop | Web | Mobile | Local | Cloud | Prioridade |
| --- | --- | :---: | :---: | :---: | :---: | :---: | --- |
| EN-01 | Entrada Desktop | ✓ | — | — | ✓ | ✓ | P0 |
| EN-02/03/04 | Login, cadastro, recuperação | ✓ | ✓ | ✓ | — | ✓ | P0 |
| WS-01/02/03 | Criar/selecionar espaço | ✓ | ✓ | ✓ | ✓ D | ✓ | P0 |
| VG-01/02 | Dashboard/estado vazio | ✓ | ✓ | ✓ | ✓ | ✓ | P0 |
| MV-01–05 | Movimentações | ✓ | ✓ | ✓ | ✓ | ✓ | P0 |
| CT-01–05 | Contas/cartões/saldo | ✓ | ✓ | ✓ | ✓ | ✓ | P0 |
| IM-01–11 | Importações/lotes | ✓ | ✓ | ✓ | ✓ | ✓ | P0 |
| CF-01–04 | Categorias/tags/regras/contrapartes | ✓ | ✓ | ✓ | ✓ | ✓ | P0 |
| DC-01–08 | Documentos/itens/conciliação/busca | ✓ | ✓ | ✓ | ✓ | ✓ | P0 |
| RP-01–06 | Relatórios/drill-down | ✓ | ✓ | ✓ | ✓ | ✓ | P0 |
| MB-01–06 | Membros/permissões | ✓ | ✓ | ✓ | — | ✓ | P0 |
| SY-01–04 | Sync/conflitos/dispositivos | ✓ | ✓ (estado) | ✓ | — | ✓ | P0 |
| BK-01/02 | Backup/restauração local | ✓ | — | — | ✓ | — | P0 |
| BK-03/04/08 | Migração Local ↔ Cloud | ✓ | acompanha | acompanha | ✓ | ✓ | P0 |
| BK-05–07 | Arquivar/excluir cloud | ✓ | ✓ | ✓ | — | ✓ | P0 |
| EX-01/02 | Exportação | ✓ | ✓ | ✓ | ✓ | ✓ | P0 |
| EX-03/04 | Suporte autorizado | ✓ | ✓ | ✓ | — | ✓ | P0 |
| CF-05/06 | Configurações espaço/conta | ✓ | ✓ | ✓ | ✓ (espaço) | ✓ | P0 |

**Observações:** na Web, sincronização significa visualizar estado do servidor/conflitos; não existe fila financeira offline no MVP. Em modo local, CF-05 existe para o espaço, enquanto CF-06 exige autenticação e portanto não se aplica ao uso anônimo.

---

## 16 · Fluxos ponta a ponta do MVP

### FL-01 · Primeiro valor — Desktop local anônimo

**Objetivo:** chegar de instalação nova a uma resposta útil sem cadastro.

```text
EN-01 Continuar sem conta
  → WS-01 Criar espaço Local
  → CT-02 Criar primeira conta + saldo prévio opcional
  → VG-02 Estado inicial
  → IM-02 Selecionar extrato
  → [IM-03 se CSV/XLSX]
  → IM-05 Revisar
  → IM-06 Resolver correspondências quando necessário
  → IM-07 Confirmar
  → IM-08 Resultado
  → VG-01 Dashboard
  → RP-03 Abrir maiores categorias
```

**Sucesso:** usuário identifica as três maiores categorias.  
**Falha segura:** cancelar qualquer etapa antes de IM-07 não altera saldo.  
**Referências:** RF-01–03, RF-05–07, RF-10–13, RF-23–24, CT-01/03/04/16.

### FL-02 · Primeiro valor — Web/Mobile cloud

```text
EN-03 Criar conta / EN-02 Entrar
  → WS-01 Criar espaço Nuvem
  → CT-02 Criar conta financeira
  → IM-02 Importar ou MV-02 adicionar manualmente
  → revisão/confirmar
  → VG-01
```

Sem autenticação, Web/Mobile não entram em dados financeiros.

### FL-03 · Adicionar movimentação manual

```text
VG-01 ou MV-01
  → MV-02
  → escolher Entrada/Gasto/Transferência
  → preencher conta, data, valor, classificação
  → validar
  → salvar
  → MV-03 / retorno à origem
```

Transferência cria os dois lados de forma atômica e não entra como consumo.

### FL-04 · Importar extrato com duplicidades

```text
IM-01
  → IM-02 arquivo/conta
  → parser/mapeamento
  → IM-05 revisão
      ├─ novos → incluir
      ├─ repetidos confirmados → manter atual por padrão
      ├─ possíveis repetidos → IM-06
      └─ inválidos → corrigir ou excluir conscientemente
  → IM-07 confirmação
  → IM-08 resultado
```

Após correção recorrente, pode seguir para IM-11 e criar regra.

### FL-05 · Corrigir descrição e criar regra

```text
IM-05 ou MV-03
  → editar “AE/C centro” para “Supermercado X”
  → sugerir IM-11
  → mostrar condição + exemplos + efeito
  → usuário ativa regra
  → CF-03 para manutenção futura
```

A regra vale somente naquele espaço.

### FL-06 · Desfazer importação

```text
IM-01 / IM-09
  → Desfazer lote
  → IM-10 prévia
      ├─ sem alterações posteriores → confirmar reversão
      └─ com dependências → resolver conflito item a item
  → registrar novo evento de reversão
  → recalcular saldos/relatórios
```

Nenhuma edição posterior de terceiro é apagada silenciosamente.

### FL-07 · Ler documento e conciliar compra

```text
DC-01
  → DC-02 selecionar XML/PDF homologado
  → extração
  → DC-03 revisão
  → confirmar dados
  → DC-07 conciliação
      ├─ vincular movimento existente
      ├─ alocar em vários movimentos
      ├─ criar novo movimento
      └─ manter não conciliado
  → DC-04 detalhe
```

O arquivo original é descartado conforme política do MVP; dados estruturados permanecem.

### FL-08 · Pesquisar item específico

```text
Busca global / DC-08
  → digitar “energético”
  → aplicar período/filtros
  → resultados em itens de notas
  → totalizar somente linhas encontradas
  → abrir DC-04/DC-05 ou MV-03 conciliado
```

### FL-09 · Entender gastos pelo dashboard

```text
VG-01
  → selecionar período
  → abrir “Despesas”
  → RP-03 gastos por categoria
  → selecionar categoria
  → RP-06 evidências
  → MV-03 / DC-05
```

O usuário sempre consegue chegar do agregado à evidência.

### FL-10 · Convidar contador/editor

```text
CF/MB-01
  → MB-02 Convidar
  → escolher Editor
  → limitar contas/recursos se necessário
  → decidir exportação/offline
  → enviar convite
  → WS-04 no destinatário
  → aceitar
  → acesso conforme escopo
```

### FL-11 · Revogar colaborador

```text
MB-01
  → MB-03
  → Revogar
  → MB-04 confirmação
  → bloquear servidor
  → invalidar/revalidar filas pendentes
  → solicitar limpeza de cache na próxima conexão
```

A interface explica o limite sobre cópias/exportações já feitas.

### FL-12 · Edição offline cloud e sincronização

```text
D/M com offline autorizado
  → editar/criar registro
  → estado “Salvo neste dispositivo”
  → fila persistente
  → reconectar
  → revalidar identidade/permissões/versão
      ├─ sem conflito → sincronizar
      └─ conflito → SY-02 → SY-03
```

### FL-13 · Resolver conflito financeiro

```text
SY-02
  → abrir conflito
  → SY-03 base x local x remoto
  → escolher/mesclar versão autorizada
  → validar regra financeira
  → salvar nova revisão
  → sincronizar
```

Servidor mantém a revisão confirmada anterior até a resolução.

### FL-14 · Criar backup local

```text
BK-01
  → Criar backup
  → escolher segredo
  → escolher destino
  → gerar pacote criptografado/versionado
  → validar pacote
  → confirmação + orientação para guardar segredo separadamente
```

### FL-15 · Restaurar backup local

```text
BK-01
  → BK-02
  → selecionar pacote
  → informar segredo
  → validar integridade
  → prévia de contas/registros
  → restaurar como novo espaço
  → VG-01
```

Falha não substitui dados existentes.

### FL-16 · Migrar espaço Local → Nuvem

```text
CF/BK-03
  → explicar envio e finalidade
  → login/cadastro se necessário
  → confirmar snapshot
  → transferir
  → validar contagens/totais
      ├─ falha → BK-08, origem local preservada
      └─ sucesso → ativar cloud
  → espaço aparece como Nuvem
  → opcionalmente convidar membros
```

### FL-17 · Migrar espaço Nuvem → Local

```text
BK-04 no Desktop
  → autenticação recente
  → verificar pendências/dispositivos
  → ponto de corte
  → baixar snapshot
  → validar contagens/totais
      ├─ falha → BK-08, cloud continua fonte de verdade
      └─ sucesso → ativar espaço local
  → revogar compartilhamento
  → cloud vai para BK-05 por 30 dias
```

### FL-18 · Arquivar e excluir espaço cloud

```text
Configurações
  → BK-06 Arquivar
  → espaço sai da operação
  → BK-05 Arquivados
      ├─ Restaurar dentro de 30 dias
      └─ BK-07 Excluir definitivamente
            → autenticação recente
            → confirmar datas/retenção residual
            → solicitação de exclusão
```

### FL-19 · Exportar dados

```text
EX-01
  → escolher movimentações/itens/JSON completo
  → filtros e escopo
  → mascaramento opcional
  → EX-02 prévia
  → gerar
  → registrar auditoria cloud quando aplicável
```

### FL-20 · Autorizar suporte temporário

```text
Configurações cloud
  → EX-03
  → definir motivo/escopo
  → autenticação recente
  → ativar acesso temporário
  → EX-04 acompanhar/revogar
  → expirar automaticamente
```

### FL-21 · Pagamento de cartão sem duplicar gasto

```text
Importar fatura/cartão
  → compras entram como consumo
  → importar extrato bancário com pagamento da fatura
  → detectar relação conta ↔ cartão
  → conciliar pagamento como liquidação de dívida
  → RP-03 não duplica consumo
  → RP-04 mostra saída de caixa no pagamento
```

### FL-22 · Saldo divergente

```text
VG-01 alerta / CT-03
  → CT-05 Conferir saldo
  → comparar referência x calculado
  → revisar registros/período
      ├─ erro de importação → abrir lote/registro
      └─ ajuste real necessário → confirmar ajuste identificado
```

---

## 17 · Estados transversais obrigatórios

Os estados abaixo devem existir como padrões reutilizáveis, não implementações improvisadas por módulo.

| Estado | Mensagem/objetivo | Ação principal |
| --- | --- | --- |
| Vazio | Explicar por que não há dados | Criar/importar algo relevante |
| Carregando | Indicar operação sem sugerir conclusão | Cancelar quando seguro |
| Offline local | Operação normal no Desktop local | Nenhuma barreira artificial |
| Offline cloud | Dizer o que está apenas no dispositivo | Tentar sincronizar/reconectar |
| Falha de arquivo | Explicar formato/layout incompatível | Selecionar outro ou cadastrar manualmente |
| Revisão parcial | Informar que nada foi integrado ainda | Continuar revisão/cancelar |
| Possível duplicidade | Mostrar evidências | Comparar e decidir |
| Sem permissão | Não vazar detalhes proibidos | Voltar/solicitar acesso fora do fluxo financeiro |
| Saldo incompleto | Explicar ausência de referência/histórico | Informar/conferir saldo |
| Conflito | Mostrar que servidor preserva revisão confirmada | Resolver conflito |
| Arquivado | Bloquear escrita e mostrar data de expiração | Restaurar ou excluir |
| Migração interrompida | Explicar fonte de verdade atual | Retomar/cancelar |
| Exclusão em andamento | Mostrar cronograma conhecido | Sem promessa de remoção instantânea de backup |
| Visão parcial | Informar que totais cobrem só contas autorizadas | Ver escopo permitido |

---

## 18 · Regras de navegação e segurança da interface

1. **Contexto de espaço sempre visível.** Ações destrutivas repetem o nome do espaço.
2. **Permissão é aplicada no backend e refletida na UI.** Esconder botão não é controle de acesso.
3. **Nenhum valor agregado sem evidência.** Dashboard/relatório sempre oferece drill-down.
4. **Origem é preservada.** Renomear não remove descrição original; importar não esconde lote.
5. **Revisar antes de integrar.** Arquivo selecionado não altera finanças antes da confirmação.
6. **Desfazer é explícito.** Reversões mostram impacto e conflitos antes de executar.
7. **Local e Cloud têm linguagem constante.** Não usar “sincronizado” para workspace local.
8. **Login não migra dados.** Migração é um fluxo separado e consentido.
9. **Offline cloud não é local exclusivo.** O cliente informa fila, revalidação e estado de servidor.
10. **Ação irreversível exige contexto e autenticação recente quando cloud.**
11. **Ausência de dados ≠ zero.** Indicadores incompletos devem dizer por quê.
12. **Moedas incompatíveis não são somadas silenciosamente.**
13. **Gráficos nunca são a única representação.** Sempre oferecer tabela/texto equivalente.
14. **Descrições/documentos são conteúdo, nunca comandos.** Não executar links/scripts/macros recebidos.
15. **Busca respeita o mesmo escopo que listas, relatórios e exportação.**

---

## 19 · Priorização para wireframes/protótipos

### Pacote A — caminho crítico de valor local

Desenhar primeiro:
- EN-01;
- WS-01/03;
- VG-01/02;
- CT-01/02/03;
- IM-02/03/05/06/07/08;
- MV-01/03;
- RP-03/06;
- BK-01/02.

Essas telas validam o diferencial “anônimo/local + entender gastos”.

### Pacote B — qualidade dos dados

- IM-09/10/11;
- CF-01/02/03;
- DC-01/02/03/04/05/06/07/08;
- CT-04/05;
- RP-01/04/05.

### Pacote C — cloud e colaboração

- EN-02/03/04/05;
- MB-01–06;
- SY-01–04;
- BK-03/04/05/06/07/08;
- EX-01–04;
- CF-06.

### Pacote D — Mobile adaptation

Depois que os fluxos críticos estiverem aprovados em comportamento, desenhar versões Mobile que preservem as mesmas decisões e critérios, reorganizando densidade em etapas.

---

## 20 · Cobertura do PRD pelo mapa

| Requisito do PRD | Telas/fluxos principais |
| --- | --- |
| RF-01 Entrada/cadastro | EN-01–05, FL-01/02 |
| RF-02 Primeiro espaço | WS-01, FL-01/02 |
| RF-03 Múltiplos espaços | WS-02/03 |
| RF-04 Titularidade | MB-05, BK-06/07 |
| RF-05–07 Contas/saldo | CT-01–05, MV-02, FL-03/22 |
| RF-08 Cartão | CT-04, FL-21 |
| RF-09 Compromissos P1 | extensão futura de VG/RP |
| RF-10–13 Importação | IM-02–08, FL-04 |
| RF-14 Histórico/reversão | IM-09/10, FL-06 |
| RF-15 Categorias/tags | CF-01/02, MV-04 |
| RF-16 Regras/contrapartes | IM-11, CF-03/04, FL-05 |
| RF-17–19 Documentos | DC-02/03/04, FL-07 |
| RF-20–22 Itens/conciliação | DC-05–08, FL-07/08 |
| RF-23–24 Painel/relatórios | VG-01/02, RP-01–06, FL-09 |
| RF-25–28 Permissões | MB-01–06, EN-05, FL-10/11 |
| RF-29–31 Sync/conflitos | SY-01–04, FL-12/13 |
| RF-32 Backup | BK-01/02, FL-14/15 |
| RF-33–34 Migração | BK-03/04/08, FL-16/17 |
| RF-35–37 Privacidade/ciclo | EN-01, BK-05–07, FL-18 |
| RF-38 Exportação | EX-01/02, FL-19 |
| RF-39 Conta/direitos | CF-06 e fluxo jurídico/operacional associado |
| RF-40 Suporte | EX-03/04, FL-20 |
| RF-41 Auditoria | detalhes de lote, membros, exportação e suporte |
| RNF-12 UX/acessibilidade | estados transversais + todas as telas |

---

## 21 · Telas explicitamente fora do MVP

Não desenhar como telas funcionais de produto no primeiro ciclo, para evitar escopo fantasma:

- conexão Open Finance/bancos em tempo real;
- assistente/chat financeiro com IA;
- configuração de IA externa;
- DRE contábil;
- contas a pagar/receber completas;
- centros de custo e projetos;
- previsão de caixa automatizada;
- aprovação em dois níveis;
- emissão fiscal;
- pagamento de contas;
- cálculo tributário;
- rentabilidade/cotação de investimentos;
- self-host/console empresarial de instalação;
- cobrança automática do beta.

Pontos de extensão podem existir no modelo e arquitetura, mas não devem aparecer como navegação vazia.

---

## 22 · Casos de teste de navegação prioritários

1. Uma instalação Desktop offline consegue EN-01 → WS-01 → CT-02 → MV/IM → VG sem login.
2. Login no Desktop não altera nem envia um espaço local existente.
3. Trocar de Empresa A para Pessoal limpa resultados e nunca mantém dados da empresa na tela.
4. Cancelar IM-05 deixa saldo/totais inalterados.
5. Confirmar IM-07 duas vezes não duplica transações.
6. IM-06 permite manter duas compras legítimas de mesmo valor/data.
7. Desfazer em IM-10 preserva uma edição posterior feita por outro usuário.
8. CT-04 + FL-21 não contam compra e pagamento da fatura como duas despesas.
9. DC-08 soma somente itens encontrados, não notas inteiras.
10. Leitor sem exportação não alcança EX-01 por deep link/ação indireta.
11. Um membro com duas contas permitidas vê VG/RP apenas sobre essas duas e recebe indicação de visão parcial.
12. D/M offline mostra “salvo neste dispositivo” e não “sincronizado”.
13. SY-03 preserva versão-base/local/remota até resolução.
14. BK-02 com senha errada não substitui workspace existente.
15. BK-03 falho preserva o local como fonte de verdade.
16. BK-04 só arquiva cloud depois de validar cópia local.
17. BK-06/07 exibem o nome correto do espaço e datas de retenção.
18. EX-02 não contém campo de conta fora do escopo do membro.
19. EX-03 expira e aparece no histórico de auditoria.
20. Navegação por teclado/leitor de tela alcança ações principais e alternativas textuais dos gráficos.

---

## 23 · Decisões para o próximo artefato visual

O presente mapa fecha **o que existe e como se conecta**, mas deixa deliberadamente para wireframes/UI:

- densidade exata do sidebar e da barra inferior;
- aparência de cards e gráficos;
- sistema visual, tipografia, cores e iconografia;
- modais versus páginas dedicadas em telas grandes;
- gestos Mobile;
- padrões específicos de tabela virtualizada;
- animações e microinterações.

Recomendações para a próxima etapa:

1. validar primeiro o fluxo FL-01 com um wireframe de baixa fidelidade;
2. testar IM-05/IM-06 cedo, pois é a maior superfície de complexidade cognitiva;
3. validar a compreensão visual de **Local x Nuvem** antes de investir em identidade final;
4. testar RP-03/RP-06 para garantir que o usuário realmente entende “para onde o dinheiro foi”;
5. só depois consolidar um design system compartilhado entre Web/Desktop e adaptação Mobile.

---

## 24 · Controle do documento

**Versão:** 1.0  
**Data:** 05/10/2026  
**Fonte de verdade funcional:** PRD Financial Manager v1.0  
**Próximo artefato recomendado:** modelo de dados/ERD ou wireframes de baixa fidelidade. Pelo plano original do projeto, o próximo documento formal é o **Modelo de Dados/ERD**, seguido pela **Arquitetura Técnica do MVP**.

Alterações futuras que mudem o escopo funcional devem atualizar primeiro o PRD ou registrar explicitamente a decisão e, em seguida, revisar os IDs de telas/fluxos afetados neste documento.
