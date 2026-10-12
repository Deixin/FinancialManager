# Financial Manager
## Documento de requisitos do produto

**PRD mestre · Versão 1.0 · 5 de outubro de 2026**

### Entender para onde o dinheiro está indo, sem perder o controle sobre os próprios dados.

Aplicativo de controle financeiro para pessoas físicas, com evolução para MEI, pequenas empresas e organizações maiores. Transforma extratos e documentos em movimentações organizadas, explicáveis e pesquisáveis.

**Desktop no MVP: local + nuvem. Web e Mobile: nuvem.**

| Identificação | Definição |
| --- | --- |
| Documento | PRD-FM-001 |
| Etapa | Especificação do MVP para beta fechado |
| Mercado inicial | Brasil; interface em português brasileiro |
| Público prioritário | Pessoa física; depois MEI e pequenas empresas; por último empresas maiores |
| Fonte de requisitos | Decisões registradas na conversa do projeto até 05/10/2026 |
| Estado | Base consolidada; detalhamentos propostos explicitamente identificados |
| Artefatos derivados | Mapa de telas e fluxos, modelo de dados/ERD e arquitetura técnica |

### Síntese executiva

O primeiro valor entregue não é um módulo contábil nem uma conversa com IA: é permitir que uma pessoa importe seus dados, corrija o que for necessário e descubra seus principais gastos. O produto deve explicar de onde cada número veio, evitar duplicidades e preservar a possibilidade de desfazer operações.

No Desktop, a pessoa pode começar sem cadastro, criar espaços locais ilimitados e manter seus dados financeiros no computador. Nuvem, colaboração e processamento externo são decisões separadas, nunca consequências silenciosas do login.

O MVP inclui o núcleo financeiro, importação revisável, leitura de documentos estruturados, busca em itens de notas, histórico, backup, sincronização e compartilhamento controlado. Funcionalidades empresariais avançadas, Open Finance e IA externa ficam para evolução.

**Limite deste documento:** especificar o que o produto precisa fazer e como demonstrar seu funcionamento. Não substitui o ERD, a arquitetura, a matriz final de sistemas operacionais ou uma validação jurídica.

<!-- pagebreak -->

## 01 · Visão, resultados e princípios

### Problema e proposta de valor

**Problema central:** “Não sei para onde meu dinheiro está indo.” O usuário reúne informações dispersas em contas, faturas, comprovantes e notas; descrições pouco claras e registros repetidos dificultam uma leitura confiável.

**Proposta:** centralizar e explicar os dados disponíveis, preservando origem, edição pelo usuário e controle de armazenamento. Uma compra pode possuir um registro financeiro, evidências de pagamento e itens detalhados, sem se tornar várias despesas.

### Público e trabalho principal

| Prioridade | Público | Resultado esperado |
| --- | --- | --- |
| 1 | Pessoa física, inclusive sem educação financeira | Identificar principais gastos, conferir saldos e pesquisar compras |
| 2 | MEI e pequenas empresas | Separar finanças pessoais e empresariais; compartilhar um espaço com contador ou equipe |
| 3 | Empresas maiores | Evoluir para governança, integrações e instalação privada, sem misturar dados entre empresas |

O MVP atende prioritariamente o primeiro grupo. O cadastro de espaços empresariais é permitido, mas não implica entregar um ERP ou contabilidade completa. Os perfis acima são hipóteses de uso derivadas do levantamento, não resultados de pesquisa de mercado.

### Resultados que o MVP deve permitir

Depois de importar um arquivo compatível, o usuário deve conseguir identificar seus maiores gastos no período, explicar divergências de saldo e corrigir classificações. No Desktop, deve fazer isso sem cadastro nem envio de conteúdo financeiro. Ao optar pela nuvem, deve entender quem terá acesso e como interromper o compartilhamento.

### Princípios de decisão

**Confiança antes de automação:** sugestões não alteram silenciosamente valores, datas ou correspondências incertas. **Origem verificável:** números levam aos registros que os compõem. **Privacidade por espaço:** a conta autentica uma pessoa; o workspace delimita dados e permissões. **Simplicidade progressiva:** configurações avançadas não bloqueiam a primeira importação. **Reversibilidade responsável:** desfazer preserva o histórico e respeita alterações posteriores.

### Como interpretar este PRD

**Decisão consolidada** corresponde ao que foi definido na conversa. **Proposta v1** é um detalhamento necessário para implementar ou testar; não é apresentado como aprovação prévia do usuário. **P0** bloqueia a conclusão do MVP. **P1** tem prioridade menor e não bloqueia o beta. **Evolução** permanece fora do MVP. Metas numéricas são propostas de validação, não resultados já medidos nem promessas comerciais.

<!-- pagebreak -->

## 02 · Plataformas e armazenamento

### Matriz de capacidades do MVP

| Capacidade | Desktop | Web | Mobile |
| --- | --- | --- | --- |
| Cliente incluído no MVP | Sim | Sim | Sim |
| Espaço exclusivamente local | Sim | Não | Não |
| Uso financeiro sem cadastro | Sim, em espaços locais | Não | Não |
| Acesso a espaços em nuvem | Sim | Sim | Sim |
| Edição offline em espaço cloud | Sim, se autorizada | Não no MVP | Sim, se autorizada |
| Backup de espaço local | Criar e restaurar | Não se aplica | Não se aplica |
| Migração local ↔ nuvem | Conduzida pelo Desktop | Acompanha estado | Acompanha estado |

**Decisão consolidada:** Desktop não é uma entrega posterior. O MVP não está completo sem seu modo local funcional. Web e Mobile não criam cofres anônimos; são clientes de espaços em nuvem.

### Local exclusivo não é o mesmo que cache offline

Um espaço local existe no Desktop, não tem membros remotos e não depende de identidade na plataforma. Um espaço cloud pode manter uma cópia operacional criptografada em dispositivos autorizados para funcionar offline. Essa cópia continua sujeita às regras do espaço e à revalidação de acesso.

**Proposta v1 para Web:** exigir conexão para leitura atualizada e gravações; não manter banco financeiro persistente no navegador. O cache da aplicação pode conter recursos de interface, não extratos ou saldos. Dados já exibidos podem permanecer em memória na sessão, com indicação de desconexão; isso não constitui um modo offline com garantia de recuperação. Tokens e preferências estritamente necessárias são tratados separadamente.

**Proposta v1 para Mobile e Desktop cloud:** acesso offline depende de habilitação do proprietário e do dispositivo, com aviso sobre a criação da cópia. Sem autorização, o cliente funciona online. Revogação não apaga magicamente cópias de um aparelho desconectado; o limite é comunicado e tratado na seção 13.

### Cobertura operacional

A matriz de versões suportadas será fechada na arquitetura. Para dimensionar o beta, propõe-se Windows 11 x64 como primeiro alvo Desktop; Android e iOS como alvos Mobile; navegadores modernos homologados na Web. macOS e Linux não são declarados suportados antes de testes e distribuição assinada. Essa priorização de sistemas operacionais é hipótese, não alteração do compromisso com os três tipos de cliente.

**Aceite de plataforma:** o mesmo conjunto de dados homologado produz os mesmos saldos e totais nas três interfaces; o Desktop local continua utilizável com a rede bloqueada.

<!-- pagebreak -->

## 03 · Escopo e prioridades

### Compromisso do MVP

| Área | P0 — necessário para concluir o MVP |
| --- | --- |
| Desktop local | Sem cadastro; espaços ilimitados; banco e backup criptografados; restauração |
| Núcleo financeiro | Contas, saldo de referência, receitas, despesas, transferências e cartão simplificado |
| Organização | Categorias editáveis por espaço, subcategorias, tags e regras de descrição |
| Entrada de dados | Lançamento manual; OFX, CSV e XLSX; PDFs textuais homologados; revisão antes de integrar |
| Qualidade de dados | Detecção de repetidos, conciliação assistida, lotes reversíveis e histórico |
| Documentos | XML de NF-e/NFC-e homologado; dados extraídos, itens, rateios e pesquisa detalhada |
| Leitura financeira | Painel de saldos, despesas, composição por categoria e comparação entre períodos |
| Cloud | E-mail, Google e Apple; múltiplos espaços; membros, permissões e sincronização |
| Controle do usuário | Exportação autorizada, migração local/cloud, arquivamento e exclusão |
| Segurança | Isolamento de espaços, proteção de chaves, auditoria cloud e resposta a incidentes |

### P1 — menor prioridade no ciclo inicial

Lançamentos futuros e recorrências simples; expansão do catálogo de PDFs; OCR local para imagens e documentos digitalizados; outros tipos de comprovante e leitores específicos de NFS-e. O núcleo pode ser testado antes dessas entregas. “Contas futuras” só aparece com conteúdo verificável; sua ausência não será preenchida por previsões inventadas.

**Recorte proposto de formatos:** suportar uma extensão não significa suportar qualquer layout. O beta deve publicar quais bancos, tipos de documento e versões de leitor foram homologados. O catálogo mínimo terá arquivos reais autorizados ou versões sintéticas equivalentes; não há bancos aprovados por presunção. XLS legado e documentos protegidos por senha podem exigir conversão externa no primeiro corte.

### Fora do MVP

Open Finance e conexão automática com bancos; IA generativa e interpretação externa de documentos; chat financeiro integrado; guarda permanente dos arquivos originais; emissão ou escrituração fiscal; DRE contábil ou por competência; contas a pagar/receber empresariais; previsões de caixa; centros de custo; projetos financeiros; folha de pagamento; execução de pagamentos; cálculo de impostos; cotações e rentabilidade de investimentos; câmbio automático; parcelamento projetado; aprovação em dois níveis; notificações push; instalação empresarial própria.

Esses itens terão pontos de extensão, não telas vazias nem estruturas completas implementadas antecipadamente. O produto é de organização financeira e não deve sugerir que valida a autenticidade fiscal de um documento, substitui um contador ou movimenta dinheiro.

<!-- pagebreak -->

## 04 · Identidade, entrada e espaços

### RF-01 · Entrada e cadastro — P0

No Desktop, a primeira tela oferece **“Continuar sem conta”**, **“Entrar”** e **“Criar conta”**, sem esconder a primeira opção. Web e Mobile exigem autenticação para dados financeiros. O modo sem conta não gera um usuário remoto anônimo ou identificador de rastreamento financeiro.

Login cloud por e-mail, Google ou Apple. E-mail terá verificação e recuperação de acesso. Vincular provedores exige comprovação de controle das identidades; coincidência de e-mail não autoriza fusão automática. Sair da conta não remove espaços exclusivamente locais do Desktop.

**Aceite:** uma instalação nova permite chegar ao primeiro painel local sem rede ou e-mail; login e logout não enviam nem excluem espaços locais.

### RF-02 · Primeiro espaço — P0

O guia pede nome, finalidade pessoal/empresarial/outra e, quando aplicável, modo de armazenamento. Dados como nome da pessoa ou organização, CPF/CNPJ e natureza jurídica são opcionais e editáveis; não bloqueiam o uso pessoal. O termo principal da interface será **“Espaço”**, correspondente a workspace; “projeto” não será usado como sinônimo técnico.

Identificadores fiscais são texto, não números de cálculo. A validação deve aceitar formatos de CNPJ numérico e alfanumérico conforme especificação oficial aplicável, sem descartar zeros iniciais. [S7]

### RF-03 · Múltiplos espaços — P0

Uma identidade pode participar de muitos espaços com papéis diferentes. O Desktop pode manter, ao mesmo tempo, espaços locais e cloud. Categorias, regras, contatos, histórico, permissões e configuração pertencem a cada espaço. Não existe consolidação automática de dados entre empresas ou entre a PF e a PJ.

O seletor apresenta nome, tipo, **Local/Nuvem**, papel e estado de sincronização. Alterar de espaço limpa filtros e resultados incompatíveis e impede reaproveitamento acidental de dados privados.

### RF-04 · Titularidade operacional — P0

Cada espaço cloud possui um proprietário, responsável pela gestão e futura cobrança. Transferência de propriedade exige autenticação recente, aceite do destinatário e registro de auditoria. O último proprietário não pode sair nem excluir sua conta sem transferir ou encerrar o espaço.

O proprietário funcional não se torna automaticamente o único titular jurídico de todos os dados ali registrados. A função de controlador/operador será avaliada por finalidade e fluxo, conforme as definições legais. [S1]

**Aceite:** um contador participa de duas empresas sem que uma consulta, exportação ou pesquisa de uma delas exponha a outra.

<!-- pagebreak -->

## 05 · Contas, lançamentos e saldo

### RF-05 · Contas financeiras — P0

Cadastrar nome, tipo, moeda, saldo prévio e data de referência. Tipos iniciais: conta corrente, poupança, conta digital, carteira/dinheiro e cartão. Investimentos e empréstimos podem ser representados por contas patrimoniais ou de dívida simples, sem avaliação de carteira, amortização automática ou rentabilidade. A interface deixa esses limites explícitos.

**Proposta v1:** operar em BRL no primeiro corte, preservando código de moeda no modelo. Arquivos em outra moeda são sinalizados e não entram silenciosamente no total em reais. Valor original de compra internacional pode ser informativo; o lançamento usa o valor liquidado em BRL quando fornecido pela fatura. Conversão manual/automática e consolidação multimoeda são evolução.

### RF-06 · Lançamentos manuais e importados — P0

Campos mínimos: identificador, espaço, conta, tipo de movimento, data financeira, valor, descrição original quando existente, nome de exibição, categoria, origem e estado. Campos opcionais: subcategoria, tags, contraparte, observação e documento associado. A descrição recebida permanece disponível mesmo depois de renomear.

Um registro pode ser dividido em classificações cujo total precisa coincidir com seu valor. Editar, excluir logicamente e restaurar gera histórico. Anotações, categorias e evidências não movimentam saldo por si mesmas. Alterações são atômicas: nunca deixar metade de uma transferência aplicada.

### RF-07 · Saldo de referência e conferência — P0

**Saldo calculado da conta = saldo de referência + movimentos confirmados posteriores à referência**, respeitando a convenção de sinal do tipo de conta. A referência deve dizer se representa início ou fim do dia; quando houver ambiguidade, pedir confirmação antes de usar.

Um saldo informado em extrato é uma referência de conferência, não autorização para reescrever o histórico. Divergências mostram período, diferença e registros considerados. Ajustes dependem de confirmação, ficam identificados e não são tratados automaticamente como receita ou despesa.

### Regras de integridade

**RN-01:** dinheiro é calculado com precisão decimal adequada, sem arredondamento acumulado por ponto flutuante binário. **RN-02:** ausência de saldo inicial ou de histórico completo produz indicação de saldo estimado/incompleto. **RN-03:** importações anteriores à referência não podem ser contadas novamente no saldo posterior. **RN-04:** transferências internas afetam as contas, mas não são receitas/despesas de consumo. **RN-05:** o saldo consolidado só inclui contas acessíveis e moedas compatíveis; disponibilidades e dívidas aparecem separadamente.

**Aceite:** saldo prévio de R$ 1.000, receita de R$ 500 e despesa de R$ 200 resultam em R$ 1.300. Uma transferência de R$ 100 entre duas contas próprias preserva o total consolidado.

<!-- pagebreak -->

## 06 · Cartões, períodos e compromissos

### RF-08 · Cartão simplificado — P0

Importar os itens apresentados na fatura, incluindo compras, parcelas explicitamente identificadas, estornos, tarifas e juros informados. Guardar referência à fatura/período quando disponível. “03/10” pode ser armazenado como parcela observada, sem gerar automaticamente as sete parcelas restantes.

O pagamento de fatura sai da conta bancária e reduz a dívida do cartão; não cria uma segunda despesa de consumo. Reconhecer a compra e liquidar a dívida são eventos distintos. Pagamentos parciais e créditos são representáveis, mas juros futuros não são calculados nem presumidos.

**RN-06:** importar uma fatura e o extrato que a pagou não pode duplicar os gastos. **RN-07:** quando só o pagamento estiver disponível, mostrar “Pagamento de cartão sem detalhamento”; não inventar categorias. Ao importar os itens depois, substituir a apresentação provisória mediante conciliação, sem somar pagamento e compras como consumo.

### Duas leituras que não devem ser confundidas

**Despesas por compra/lançamento:** visão principal para entender o destino do dinheiro; usa a data atribuída ao gasto, preservando a data da fonte. Na fatura com data ambígua, o usuário confirma a convenção. Não se trata de contabilidade por competência.

**Entradas e saídas de caixa:** visão da movimentação das disponibilidades; registra a saída no pagamento do cartão e identifica transferências, aplicações e liquidação de dívida. O cabeçalho informa a base utilizada. Não chamar nenhuma dessas visões de DRE no MVP.

**Exemplo de teste:** compra de R$ 120 em setembro e pagamento em outubro. A visão de consumo mostra R$ 120 em setembro; a de caixa mostra R$ 120 saindo em outubro. O pagamento não adiciona R$ 120 ao consumo de outubro. Um estorno posterior fica vinculado e claramente datado, sem alterar silenciosamente relatórios fechados pelo usuário.

### RF-09 · Compromissos futuros simples — P1

Permitir informar data, valor previsto, descrição, conta e recorrência opcional. Estados: previsto, confirmado como realizado e cancelado. Um compromisso não altera o saldo realizado e pode ser vinculado a um pagamento importado, evitando um novo lançamento.

Não apresentar previsão como saldo garantido. “Sem compromissos cadastrados” é diferente de “Você não tem contas a pagar”. Parcelas futuras só aparecem quando cadastradas ou efetivamente fornecidas por fonte compatível. Sem esse módulo, o painel não promete cobertura de contas futuras.

Tags como “atrasado” são organização do usuário, não um mecanismo de competência contábil ou apuração de inadimplência.

<!-- pagebreak -->

## 07 · Importação e revisão

### RF-10 · Receber e interpretar arquivos — P0

O usuário escolhe o espaço e a conta de destino antes de integrar informações. O sistema identifica o formato, aplica um leitor versionado e informa compatibilidade, período, moeda e eventuais limitações. No modo local, leitura, normalização e revisão ocorrem no próprio Desktop.

OFX usa identificadores de origem quando disponíveis; CSV e XLSX oferecem mapeamento de colunas, data, separador decimal e sinal de débito/crédito. Planilhas não executam fórmulas ou macros recebidas. PDFs textuais exigem leitor homologado; falhas de interpretação não são tratadas como lançamentos válidos.

Arquivos incompatíveis recebem motivo e alternativa prática, como importar OFX/CSV ou cadastrar manualmente. A falta de suporte a um layout não autoriza envio a OCR ou IA externos.

### RF-11 · Área de preparação — P0

Antes da confirmação, nenhum item altera o saldo ou os relatórios. A revisão apresenta descrição original e nome proposto, data, valor, categoria, conta, origem e situação: novo, repetido confirmado, possível repetido, atualizado ou inválido.

O usuário pode editar, filtrar, selecionar e excluir linhas da integração. A tela resume quantidades e valores por ação, registra erros por linha e exige confirmação explícita. Linhas inválidas só podem ser ignoradas mediante exclusão consciente; não desaparecer silenciosamente.

**Aceite:** cancelar a revisão de um arquivo com 500 registros deixa o espaço inalterado. Confirmar 450 linhas selecionadas integra exatamente essas linhas, com o resumo correspondente.

### RF-12 · Duplicidade — P0

Combinar identificadores confiáveis da fonte, conta, valor, data e descrição. Hash do arquivo ajuda a reconhecer reenvios, mas não substitui a análise de registros. Duas compras legítimas com mesmo valor e data podem coexistir.

**Repetição comprovada:** mesmo identificador consistente na mesma origem e conta; mostrar como já integrado. **Correspondência provável:** apresentar evidências e pedir decisão. Nenhum escore de similaridade deve ser apresentado como probabilidade estatística sem calibração.

Ações: manter registro atual; atualizar campos selecionados; vincular evidência; manter ambos. Atualização mostra diferenças e preserva personalizações por padrão. Divergência de valor num identificador repetido requer atenção, não substituição automática.

### RF-13 · Confirmação idempotente — P0

A integração tem um identificador de operação que evita reaplicação após repetição de clique, timeout ou reconexão. O lote confirmado aplica alterações de forma transacional e produz comprovante interno com autor, origem, versão do leitor, quantidades e resultado.

**Aceite:** reenvio da mesma confirmação não aumenta a quantidade de transações; importar períodos sobrepostos oferece revisão das correspondências sem bloquear transações legítimas.

<!-- pagebreak -->

## 08 · Histórico, reversão e organização

### RF-14 · Desfazer lote — P0

O histórico reúne importações e operações manuais. Cada lote distingue criações, atualizações e vínculos; guarda o estado anterior necessário para uma reversão controlada, sem depender da retenção do arquivo original.

Desfazer primeiro apresenta uma prévia: itens a remover, versões a restaurar, vínculos a desfazer e conflitos. Registros criados pelo lote e não alterados depois podem ser revertidos em conjunto. Atualizações posteriores, conciliações ou referências externas impedem uma reversão destrutiva automática e exigem decisão explícita.

**Aceite:** desfazer um lote sem alterações posteriores devolve saldos e totais ao estado anterior. Se outra pessoa editou uma transação, a reversão preserva essa edição ou solicita resolução; nunca a apaga silenciosamente. O próprio desfazimento permanece no histórico.

### RF-15 · Categorias, subcategorias e tags — P0

Categorias padrão são oferecidas por tipo de espaço e podem ser renomeadas, criadas, reorganizadas e arquivadas. Subcategorias e tags são entradas do usuário; sugestões não criam estruturas indefinidamente. Categorias usadas não desaparecem do histórico: exclusão exige remapeamento ou arquivamento.

Cada parcela de classificação possui uma categoria e, opcionalmente, uma subcategoria; tags podem ser múltiplas. Um lançamento sem detalhamento usa classificação única. Rateios distribuem o valor e não criam dinheiro adicional. Consultas por várias tags devem deduplicar os registros; agrupamentos sobrepostos precisam avisar que suas somas não são aditivas.

### RF-16 · Regras pessoais e contrapartes — P0

Depois de corrigir “AE/C centro” para “Supermercado X”, oferecer **“Aplicar esta regra às próximas importações deste espaço?”**. A regra pode usar texto, conta ou identificador da contraparte e propor nome/categoria. Mostra exemplos antes de ativar, tem prioridade explícita e pode ser editada ou desativada.

Correção pontual não autoriza uma regra global. Aplicação retroativa requer prévia e confirmação; mudanças nunca atingem outros espaços. Regras conflitantes aparecem na revisão. A descrição original é preservada.

**Contrapartes recomendadas:** cadastro leve de pessoa/organização, nome de exibição e identificador opcional, com etiquetas de cliente, fornecedor ou outro. Empregados e sócios não recebem módulos próprios no MVP. Evitar coletar endereço, dados de folha ou outros campos sem uso definido.

**Aceite:** uma regra de supermercado criada no espaço pessoal não afeta o espaço da empresa. Pesquisar pela descrição original continua encontrando a movimentação renomeada.

<!-- pagebreak -->

## 09 · Leitura de documentos

### RF-17 · Extração estruturada — P0

Priorizar XML de NF-e/NFC-e homologado; usar PDF com texto quando o layout tiver leitor validado. O Portal Nacional da NF-e publica pacotes de esquemas XML, referência para versionar os leitores em vez de presumir um formato imutável. [S3]

Extrair, quando disponível: tipo de documento, identificador/chave, emissor, destinatário necessário ao vínculo, datas, total, descontos, acréscimos e itens. Campos ausentes permanecem ausentes; não inferir CPF/CNPJ, impostos ou preços para “completar” o documento.

Validação estrutural verifica formato e consistência dos campos; **não equivale a consulta de autorização fiscal ou comprovação de autenticidade**. O sistema não declara uma nota fiscal válida perante o Fisco apenas porque conseguiu lê-la. Consulta externa e certificados digitais não são requisitos do MVP.

### RF-18 · Revisão e descarte do original — P0

Antes de confirmar, apresentar dados, origem de cada campo relevante e alertas de divergência. Na ausência de suporte confiável, permitir correção manual ou abandonar a extração. Documento recebido não gera automaticamente uma despesa realizada: é preciso vinculá-lo a um registro existente ou confirmar um novo lançamento.

**Decisão consolidada:** no MVP, persistir dados extraídos e proveniência mínima, não anexar XML, PDF ou imagem original. Nome do arquivo, hash, versão do leitor e posição da linha/página podem ser guardados dentro do espaço; não manter o conteúdo integral em logs ou backups disfarçados de metadados.

**Proposta v1:** originais temporários ficam preferencialmente em memória; quando armazenamento temporário for indispensável, ficam protegidos, fora de backups e são descartados ao concluir/cancelar, com limpeza de falhas em até 24 horas. Não apagar o arquivo que o usuário escolheu em sua pasta. Informar que, sem o original anexado, uma nova extração dependerá de selecioná-lo novamente.

### RF-19 · Imagens, QR e outros comprovantes — P1

Fotos, recibos, boletos, comprovantes PIX e NFS-e entram por leitores homologados ou preenchimento assistido. OCR local pode ser incluído sem IA externa. Código/QR pode identificar uma chave ou endereço, mas não garante obter todos os dados ou itens.

Abrir endereço de consulta é uma ação de rede distinta, com aviso. Não executar links, macros, scripts ou instruções encontrados no documento. Documentos e descrições são dados não confiáveis, nunca comandos para o aplicativo.

**Aceite:** falha de leitura não muda o saldo; confirmar uma nota salva seus campos e itens sem conservar o arquivo original nos repositórios da aplicação.

<!-- pagebreak -->

## 10 · Itens, busca e conciliação

### RF-20 · Detalhamento e rateio — P0

Um documento pode ter múltiplos itens, com descrição original, nome ajustado, quantidade, unidade, preço unitário, desconto, acréscimos e valor líquido. Itens podem receber categorias distintas. Guardar precisão suficiente para preços e quantidades; arredondar valores monetários finais de forma determinística.

**RN-08:** a soma dos itens e ajustes deve reconciliar com o total do documento. Divergência fica visível e bloqueia o rateio confirmado até correção ou registro explícito da diferença. Quando um desconto global não vier rateado, propor distribuição proporcional e mostrar o resultado; o usuário pode revisar. Impostos já incluídos no preço não são somados novamente como despesa.

### RF-21 · Busca detalhada — P0

Pesquisar descrições de lançamentos, contrapartes, tags e itens de documentos. Ignorar diferença de maiúsculas e acentos, preservando o texto original. Filtros: espaço, contas autorizadas, período, categoria, subcategoria, tag, fornecedor e situação de vínculo.

Ao buscar “energético”, mostrar documento, estabelecimento, data, produto, quantidade, valor unitário quando conhecido, valor líquido da linha e soma no período. A soma deve considerar apenas os itens encontrados, nunca o total completo de cada supermercado. A mesma nota vinculada a vários pagamentos não duplica itens.

**Exemplo de aceite:** três notas contêm, respectivamente, 2 × R$ 8,00, 1 × R$ 9,00 e 3 × R$ 7,50 do produto. A busca apresenta seis unidades e R$ 47,50, antes de eventuais descontos identificados. Não soma o valor das três compras completas.

O resultado informa a base temporal: por padrão, data da compra/documento. Distinguir **“Valor dos itens nas notas”** de **“Valor pago conciliado”**. Sem conciliação suficiente, não afirmar que todo o valor foi pago naquele período.

### RF-22 · Conciliação assistida — P0

Sugerir vínculos entre documento, compra, transação bancária e pagamento com base em valor, datas, identificação e contexto. Mostrar evidências e divergências, sem confirmar correspondências incertas automaticamente.

Permitir que um documento seja pago por mais de um movimento e que um pagamento liquide vários documentos, com valores alocados e saldo pendente de conciliação. A soma alocada não pode exceder o valor disponível sem ajuste explicitamente identificado. Isso não cria um módulo empresarial de cobrança.

**Aceite:** importar despesa manual, nota e extrato da mesma compra resulta em uma despesa com evidências vinculadas, após confirmação. Desvincular uma nota não exclui o pagamento bancário original.

<!-- pagebreak -->

## 11 · Painel, relatórios e explicabilidade

### RF-23 · Visão inicial — P0

O painel deve responder **quanto tenho disponível**, **quanto gastei no período** e **em quê**. Apresentar saldo das contas acessíveis, despesas categorizadas, maiores categorias e movimentações recentes. Dívida de cartão e outras dívidas ficam em área separada do dinheiro disponível.

Cada número abre a lista que o compõe, preservando filtros, período e base de cálculo. Comparações por semana, mês, semestre, ano e intervalo personalizado usam critérios equivalentes e exibem mudanças de cobertura, como uma nova conta ou importação incompleta.

### RF-24 · Relatórios simples — P0

| Indicador | Regra de apresentação |
| --- | --- |
| Saldo disponível | Contas de disponibilidade selecionadas, com saldo de referência e movimentações válidas |
| Despesas de consumo | Gastos classificados, líquidos de estornos conforme datas; sem transferências ou pagamento duplicado de cartão |
| Entradas e saídas de caixa | Movimentos efetivos das disponibilidades, separando transferências e liquidação de dívidas |
| Gastos por categoria | Soma dos rateios; itens detalhados substituem, e não se somam, à classificação total da mesma compra |
| Itens encontrados | Valores das linhas de documento que correspondem à busca; indicar vínculo e base temporal |
| Próximos compromissos | Apenas valores conhecidos/cadastrados quando RF-09 estiver disponível |

Valores sem categoria aparecem em **“Não classificado”**, não são omitidos. Ajustes de saldo possuem uma linha própria. O sistema não chama a diferença entre entradas e saídas de lucro contábil e não rotula relatórios como DRE no MVP.

**RN-09:** nenhuma consulta soma moedas diferentes sem conversão explícita. **RN-10:** ausência de dados é diferente de valor zero. **RN-11:** relatórios e busca respeitam o mesmo conjunto de permissões que os registros de origem. **RN-12:** filtros por tags sobrepostas não multiplicam despesas.

### Estados de confiança

Mostrar data da última atualização, contas cobertas e alertas relevantes: importação pendente, saldo inicial ausente, conciliação incompleta ou conflito. Um indicador pode estar atualizado para uma conta e incompleto para outra; não mostrar um selo global de “conferido” sem cobertura suficiente.

**Aceite:** o total de “Alimentação” corresponde exatamente à lista aberta ao clicar no indicador. Uma categoria sem movimentos não se confunde com falha de importação. Um leitor com acesso a apenas duas contas vê totais somente dessas contas, identificados como visão parcial.

<!-- pagebreak -->

## 12 · Colaboração e permissões

### RF-25 · Papéis por espaço — P0

| Ação padrão | Proprietário | Administrador | Editor | Leitor |
| --- | --- | --- | --- | --- |
| Consultar dados autorizados | Sim | Sim | Sim | Sim |
| Criar/editar lançamentos | Sim | Sim | Sim | Não |
| Importar e conciliar | Sim | Sim | Sim | Não |
| Gerenciar categorias/regras | Sim | Sim | Sim | Não |
| Gerenciar membros comuns | Sim | Sim, limitado | Não | Não |
| Exportar dados | Sim | Com concessão | Com concessão | Com concessão |
| Transferir propriedade/cobrança | Sim | Não | Não | Não |
| Migrar, excluir espaço ou liberar suporte | Sim | Não | Não | Não |

**Proposta v1:** o proprietário controla concessões de exportação, acesso offline e acesso a contas específicas. Um administrador não pode se promover a proprietário nem conceder a si mesmo permissões negadas. Editor pode desfazer operações dentro de seu escopo; reversões de terceiros exigem administrador/proprietário.

### RF-26 · Escopo efetivo — P0

Permissão combina papel, contas/recursos acessíveis e capacidades adicionais. A API e a sincronização aplicam o escopo, não apenas a interface. Contas restritas não aparecem em totais, busca, autocompletar, itens de documentos, histórico ou exportações. Documentos com conteúdo de escopos diferentes precisam ser ocultados ou apresentados com campos filtrados de forma segura.

Ocultar saldo é uma preferência distinta de ocultar movimentações. O produto deve avisar que quem vê histórico completo e referências pode inferir valores; esconder um componente visual não equivale a confidencialidade matemática.

### RF-27 · Convites e revogação — P0

Convite possui destinatário, papel, escopo e expiração; exige conta própria para aceite e não cria link público de consulta. A pessoa pode acessar muitos espaços. Revogação encerra sessões e novas leituras/gravações no servidor, e solicita limpeza de caches na próxima conexão. Operações pendentes são revalidadas antes de entrar no espaço.

### RF-28 · MFA e aprovações — P0/Pós-MVP

MFA individual é oferecido e recomendado pela interface, com recuperação segura; a imposição de MFA a todos os membros pelo administrador fica para evolução, conforme a decisão mais recente do levantamento. Ações de alto impacto exigem autenticação recente.

Aprovação em dois níveis está prevista para evolução, sem workflow completo no MVP. A arquitetura deve permitir introduzi-la sem presumir que edição e aprovação são sempre a mesma autorização.

**Aceite:** leitor sem exportação não consegue gerar arquivo pela API, por URL direta ou por ação em lote. A limitação reduz exposição, mas não impede captura de tela, cópia manual ou retenção de conteúdo já visto.

<!-- pagebreak -->

## 13 · Sincronização e conflitos

### RF-29 · Sincronização de espaços cloud — P0

Desktop e Mobile autorizados mantêm fila persistente de operações offline, identificadores idempotentes e versão de origem. A interface distingue **salvo neste dispositivo**, **aguardando envio**, **sincronizado**, **conflito** e **acesso revogado**. Uma operação local não é apresentada como salva na nuvem antes de confirmação do servidor.

Ao reconectar, o servidor revalida identidade, papel, recursos acessíveis, estado do espaço e versão dos registros. Operações repetidas não são reaplicadas. Relógio do aparelho não decide sozinho a ordem de alterações. Ações dependentes, como transferência e seu vínculo, são tratadas de forma consistente.

### RF-30 · Conflitos explícitos — P0

Alterações em campos independentes podem ser mescladas se não violarem regras de negócio. Mudanças concorrentes no mesmo valor, data, conta, categoria ou exclusão exigem comparação entre versão-base, versão local e versão remota. Não usar silenciosamente “a última alteração vence” em dados financeiros.

Exemplo: uma pessoa altera R$ 100 para R$ 120 e outra exclui o registro. O sistema mostra as duas ações e pede resolução autorizada. Resolver produz uma nova revisão; as alternativas anteriores permanecem no histórico enquanto os dados forem retidos.

Totais indicam quando há alterações locais ainda não aceitas. No conflito, o servidor mantém a última revisão confirmada até resolução; a interface não incorpora simultaneamente as duas propostas. Um leitor pode ver o aviso, mas não resolver um conflito que exija escrita.

### RF-31 · Exclusões e revogação — P0

Exclusões sincronizadas usam marcadores e versões para não ressuscitar registros a partir de clientes antigos. Depois de limpeza definitiva, um cliente obsoleto deve refazer a sincronização e não reenviar toda sua base como registros novos. Mudanças de modo local/cloud incrementam uma geração de sincronização que invalida vínculos anteriores.

**Proposta v1 de segurança offline:** habilitação por espaço e dispositivo, desativada por padrão para convidados, com revalidação online em até 24 horas. Após expirar, bloquear acesso ao cache até autenticação. O modo exclusivamente local não possui essa restrição.

Nenhum mecanismo garante apagar dados de um dispositivo hostil ou permanentemente desconectado. Revogação vale imediatamente no servidor e na próxima comunicação do cliente; cópias/exportações anteriores podem persistir. Alterações pendentes de um membro revogado não são publicadas automaticamente e seguem procedimento autorizado de recuperação.

**Aceite:** repetir a fila não duplica movimentos; dois dispositivos alterando o mesmo valor geram conflito visível; perda de conexão e reinício preservam a fila; cliente revogado não consegue enviar alterações.

<!-- pagebreak -->

## 14 · Backup e migração de armazenamento

### RF-32 · Backup local criptografado — P0

Exportar um pacote próprio, versionado e protegido por senha/chave de recuperação, com contas, lançamentos, itens, regras, categorias e histórico incluído na política. Verificar integridade antes de substituir qualquer dado. A restauração oferece prévia e cria um espaço independente por padrão; não reconecta automaticamente uma cópia antiga ao espaço cloud.

A senha do pacote não é guardada pelo serviço. Biometria ou PIN podem desbloquear a chave no aparelho, mas não recuperam um backup sem segredo de recuperação. Informar: perda do dispositivo e do backup/chave pode ser irrecuperável. Guardar arquivo em pasta sincronizada por terceiro é escolha externa ao aplicativo e deve ser advertida.

**Aceite:** pacote restaurado em outra instalação reproduz saldos, itens e regras; senha errada ou arquivo adulterado falha sem destruir o espaço existente.

### RF-33 · Local → nuvem — P0

Disponível ao proprietário local após login. Mostrar dados a enviar, finalidade, plano aplicável, cópias nos dispositivos e política de retenção. A autorização é específica para aquele espaço; fazer login não envia todos os espaços locais.

Preparar snapshot consistente, transmitir de forma protegida, validar contagens/totais e só concluir a mudança após confirmação do servidor. Até lá, preservar a origem e mostrar o estado da migração. Uma falha não transforma o espaço em duas bases ativas divergentes. Membros só são convidados depois da ativação cloud.

### RF-34 · Nuvem → local — P0

Somente o proprietário, usando o Desktop, pode conduzir a operação. Exigir autenticação recente, conexão e resolução das pendências conhecidas. Avisar que dados ainda não enviados por outros aparelhos não fazem parte do snapshot; mostrar a última sincronização dos dispositivos conhecidos.

Criar ponto de corte consistente, suspender novas gravações cloud, baixar e verificar a cópia completa, disponibilizá-la localmente e revogar o compartilhamento da versão cloud. Se houver falha antes da conclusão, manter possibilidade segura de retomar ou cancelar. Nunca arquivar a origem antes de verificar o destino.

A versão cloud entra em arquivamento recuperável por 30 dias. Restaurá-la mostra a data do snapshot e exige escolher a base a manter; não mescla automaticamente alterações do espaço local posterior. O fluxo de exclusão residual está na seção 15.

**Aceite:** contagens, saldos e itens coincidem antes/depois; membros antigos perdem acesso cloud; um aparelho offline antigo não recria o espaço compartilhado; o arquivo local continua acessível sem login após a migração.

<!-- pagebreak -->

## 15 · Privacidade, arquivamento e exclusão

### RF-35 · Finalidades e fronteiras — P0

Não vender dados financeiros, utilizá-los para publicidade comportamental, treinar modelos ou reutilizá-los para finalidades incompatíveis. O serviço processa o necessário para oferecer as funções escolhidas, segurança e obrigações aplicáveis, de forma informada. Cloud não significa dado público; também não será anunciado como criptografia ponta a ponta ou conhecimento zero no MVP.

No modo local sem login, conteúdo financeiro, nomes de arquivos e telemetria de uso não são enviados. Consultas de atualização do software são separadas, configuráveis e não contêm conteúdo do espaço. Mesmo autenticado, o usuário precisa autorizar o envio de cada espaço local. Logs e diagnósticos não capturam descrições, itens ou documentos por padrão.

Os controles de produto não substituem o enquadramento jurídico: a LGPD prevê bases legais distintas, princípios de finalidade/necessidade, direitos dos titulares e hipóteses de conservação. Não se deve transformar todo tratamento em um único consentimento genérico. [S1]

### RF-36 · IA e serviços externos — evolução com restrição P0

No MVP, IA externa não é chamada. A futura ativação terá controle separado da nuvem, desligado por padrão, indicando fornecedor, dados, finalidade, retenção e possibilidade de desativação. Em espaço compartilhado, exige autorização de quem controla essa configuração e confirmação de escopo pelo usuário da ação. O administrador não “consente” genericamente em nome de terceiros.

OCR local não implica envio externo; qualquer OCR remoto seguirá autorização própria de processamento externo. Exportar para usar em outra IA é uma ação explícita do usuário, sujeita às permissões de exportação e ao aviso de risco.

### RF-37 · Ciclo de vida — P0

**Arquivar:** retirar da operação, interromper escrita/sincronização e permitir recuperação por 30 dias. A tela explica a exclusão programada; não se trata de arquivo morto permanente. **Excluir dos arquivados:** confirmar uma solicitação de exclusão definitiva, sem nova janela de recuperação.

**Proposta v1 de prazo técnico:** remover bases operacionais e derivados, como índices e filas, em até 24 horas da exclusão definitiva; cópias de segurança isoladas expiram em até 30 dias depois. O arquivamento de 30 dias mais esse ciclo pode resultar em aproximadamente 60 dias de retenção desde o arquivamento. Exibir as datas concretas, não prometer que todas as cópias somem no dia 30.

Backups não ficam disponíveis para consulta comum; restaurações de desastre reaplicam exclusões para evitar retorno de dados. Exceções legais terão fundamento e prazo documentados. Esses prazos são política proposta, não prazos impostos pela LGPD. [S1]

<!-- pagebreak -->

## 16 · Exportação, suporte e auditoria

### RF-38 · Portabilidade funcional — P0

Exportação em CSV para movimentações e itens, e JSON versionado para estrutura completa autorizada, incluindo categorias, regras e vínculos. Informar filtros, moeda, base temporal e versão. Backup criptografado é um recurso distinto da exportação legível.

O proprietário pode limitar exportações por membro e recurso. O pacote nunca inclui dados fora do escopo, credenciais, tokens, segredos ou conteúdo de outro espaço. O sistema oferece mascaramento de identificadores e exclusão de descrições/contrapartes em uma prévia, sem chamar o resultado de anonimização garantida.

**Aceite:** os totais exportados conferem com os filtros da interface; fórmulas perigosas em células textuais são neutralizadas para uso seguro em planilhas. A restrição de exportação vale no servidor e nos clientes autorizados.

### RF-39 · Direitos e encerramento de conta — P0

Manter canal verificável para pedidos de acesso, correção e exclusão de dados pessoais. Esse atendimento não é a mesma coisa que exportar toda a empresa; permissões do produto não podem eliminar direitos legais do titular. [S1]

Excluir uma conta de usuário não exclui automaticamente os espaços pertencentes a outras pessoas. Para espaços próprios, apresentar transferência ou encerramento. Informar retenções aplicáveis e distinguir perfil, dados financeiros, histórico, cobrança e logs necessários.

A matriz de tratamento deve mapear finalidade, dados, agente responsável, fornecedores, localização, base legal e retenção antes do beta com dados reais. A ANPD disponibiliza guias de segurança e de agentes de tratamento como referências para essa preparação. [S2]

### RF-40 · Suporte autorizado — P0

Não oferecer consulta rotineira irrestrita a dados de clientes pela equipe de suporte. O proprietário pode conceder acesso temporário e identificado ao espaço, com escopo mínimo, motivo e revogação. **Proposta v1:** leitura por até 24 horas, exportação desligada; qualquer ampliação exige nova concessão.

Separar esse acesso do acesso técnico excepcional de infraestrutura necessário à segurança/operação. Este último terá pessoal restrito, registro, justificativa e procedimento de emergência; não autoriza exploração livre do conteúdo financeiro. Criptografia em repouso não elimina essa possibilidade técnica no modelo cloud proposto.

### RF-41 · Histórico e auditoria — P0

Registrar autor/dispositivo, ação, recurso, momento, origem, lote e revisões necessárias. Cloud: trilha protegida contra alteração por membros comuns e segregada de logs operacionais. Local: histórico no próprio cofre, sem alegação de imutabilidade contra o dono da máquina.

Registrar convites, alterações de permissão, migrações, exportações e suporte. Auditoria também respeita escopo e retenção; não se torna uma cópia financeira permanente após exclusão. Logs obrigatórios eventualmente retidos usam somente conteúdo e duração justificados na matriz jurídica.

<!-- pagebreak -->

## 17 · Requisitos não funcionais

### Segurança e confiabilidade — P0

| ID | Requisito verificável |
| --- | --- |
| RNF-01 | Criptografia em trânsito, em repouso cloud e nos cofres/caches locais; chaves separadas dos dados e segredos fora de logs/código |
| RNF-02 | Testes de autorização cruzada entre espaços, contas, itens, exportações e filas; negar acesso por padrão |
| RNF-03 | Bloqueio local configurável; segredos protegidos pelo sistema operacional; recuperação testada sem transmitir chaves locais |
| RNF-04 | Importadores isolados, limites de tamanho/tempo, validação de conteúdo e proteção contra XML externo, arquivos maliciosos e injeção |
| RNF-05 | Atualizações assinadas e verificadas, dependências revisadas, migrations de banco transacionais e recuperação após falha |
| RNF-06 | Backups cloud criptografados com testes de restauração; procedimento de incidente e contato ao usuário conforme enquadramento aplicável |

A segurança deve ser tratada como requisito desde a concepção, coerentemente com a LGPD e as orientações de segurança referenciadas. [S1][S2] Não prometer invulnerabilidade: malware com controle da máquina, sessão desbloqueada ou credenciais comprometidas continuam sendo riscos relevantes.

### Desempenho e continuidade — metas propostas para o beta

| ID | Meta de aceite proposta e contexto |
| --- | --- |
| RNF-07 | Painel e busca em até 2 s no percentil 95, em cenário homologado com 50 mil movimentos e 150 mil itens por espaço |
| RNF-08 | Prévia de 10 mil linhas de OFX/CSV em até 30 s em Desktop de referência; PDFs medidos separadamente; progresso e cancelamento visíveis |
| RNF-09 | API interativa em até 800 ms no percentil 95, excluindo rede do usuário, importações e exportações extensas |
| RNF-10 | Após conexão estável, fila de 100 operações simples sincronizada em até 10 s no cenário de teste, salvo conflitos |
| RNF-11 | Objetivos cloud de perda recuperável de até 24 h e recuperação em até 8 h no beta; medir por simulação antes de divulgar |

Essas metas dependem de hardware, rede, volume e desenho técnico documentados no teste. Não são resultados existentes nem SLA comercial. O risco de perda até o último backup deve ser comunicado; requisitos mais rigorosos podem ser fixados na arquitetura.

A intenção de chegar a cerca de 100 mil usuários é diretriz de crescimento, não estimativa de concorrência simultânea. Ensaios de carga devem declarar usuários ativos, operações por segundo e volume de dados, sem concluir capacidade apenas pelo número de cadastros.

<!-- pagebreak -->

## 18 · Experiência e acessibilidade

### Navegação proposta

No Desktop e na Web: seletor de espaço, **Visão geral**, **Movimentações**, **Contas e cartões**, **Importações**, **Documentos e itens**, **Relatórios** e **Configurações**. Compromissos só aparecem quando RF-09 estiver disponível. Pessoas, permissões e plano ficam nas configurações cloud; backup e restauração locais aparecem no Desktop.

No Mobile, priorizar consulta, busca, cadastro/edição, revisão de importação e estado de sincronização. O mecanismo de seleção de arquivos deve atender os formatos P0; tarefas de alta densidade podem ter fluxo em etapas, sem reduzir integridade ou exigir “modo Desktop” para funções essenciais.

### RNF-12 · Usabilidade e acessibilidade — P0

A linguagem não exige conhecimento de débito/crédito, competência ou livro-razão. Mostrar “Entrada”, “Gasto”, “Transferência” e explicações contextuais. Confirmações destrutivas nomeiam o espaço e mostram consequências; ações rotineiras não recebem barreiras repetitivas.

Usar WCAG 2.2 nível AA como referência de critérios testáveis para a interface web e princípios equivalentes nos clientes, incluindo teclado, foco, contraste, rótulos e mensagens de erro. A recomendação W3C fornece critérios de sucesso organizados por níveis; a conformidade deve ser verificada, não presumida pelo framework. [S4]

No Mobile, testar leitores de tela e redimensionamento de texto. Gráficos possuem alternativa textual/tabela; estado e sinal de valores não dependem somente de cor. Inputs monetários usam formatação brasileira, distinguindo digitação de representação interna.

### Mensagens que fazem parte do produto

**Local:** “Este espaço está somente neste computador. Faça um backup para recuperar seus dados em outro aparelho.”

**Ativar nuvem:** “Os dados deste espaço serão enviados para permitir acesso em outros dispositivos. Outros espaços locais não serão enviados.”

**Importação:** “Há possíveis correspondências. Revise antes de adicionar ou atualizar.”

**Offline cloud:** “Salvo neste dispositivo. Aguardando sincronização.”

**Exclusão:** “O acesso será encerrado. Algumas cópias de segurança podem permanecer até a data informada.”

### Estados obrigatórios de tela

Vazio orientado à primeira ação; carregamento; arquivo incompatível; importação parcial em revisão; falta de conexão; conflito; acesso insuficiente; conta sem saldo inicial; espaço arquivado; exclusão em andamento; falha e retomada de migração. Cada estado tem uma ação possível ou explica por que não há ação.

**Aceite:** uma pessoa sem formação financeira conclui criação do espaço, revisão de arquivo e consulta das três maiores categorias sem precisar entender os nomes internos do modelo de dados.

<!-- pagebreak -->

## 19 · Métricas e validação de valor

### Indicador principal

**Percentual de participantes que conseguem identificar e explicar suas três maiores categorias de gasto após uma importação.** O objetivo é compreensão, não quantidade de gráficos ou de transações armazenadas.

As metas abaixo são hipóteses para uma rodada de beta fechado. Antes de interpretar resultados, fixar tamanho da amostra, perfil, tarefa, formatos e critério de sucesso. Não extrapolar uma amostra voluntária do Desktop local para toda a base de usuários.

| Métrica | Definição operacional | Meta inicial proposta |
| --- | --- | --- |
| Ativação | Participante cria espaço, confirma importação e abre composição de gastos | Pelo menos 70% dos que iniciam a tarefa com arquivo compatível |
| Compreensão | Identifica as três maiores categorias e abre um lançamento de evidência sem ajuda | Pelo menos 80% dos participantes com importação concluída |
| Tempo até primeiro valor | Do início do guia ao primeiro painel conferido, com arquivo já disponível | Mediana de até 10 minutos |
| Clareza de privacidade | Distingue espaço local de cloud e explica quando há envio de dados | Pelo menos 90% na entrevista de tarefa |
| Integridade de importação | Datas, sinais, valores e totais conferem com conjunto de teste homologado | 100% dos casos de referência; ambiguidade deve ser sinalizada |
| Continuidade | Consegue criar e restaurar backup local em outra instalação | 100% dos cenários técnicos; medir dificuldade do usuário |
| Retorno | Participante ativado volta para conferir ou importar novos dados | Medir em 30 dias; estabelecer meta após a primeira coorte |

Taxa de classificação automática e volume de correções devem ser segmentados por leitor e por regra. Uma média global não pode esconder falha recorrente em determinado banco. Casos não suportados são informados como cobertura, não registrados artificialmente como “sucesso”.

### Instrumentação com privacidade

Cloud pode coletar eventos operacionais mínimos necessários e métricas de produto conforme finalidade informada e configuração aplicável, sem registrar valores, descrições de compras, itens, CPF/CNPJ ou nomes de arquivos nos eventos de análise. Propor eventos como início/conclusão de importação, tipo de erro e tempo de operação.

Desktop sem login não envia telemetria automaticamente. Avaliar experiência local por sessões consentidas, entrevistas ou relatório de diagnóstico que o participante escolha compartilhar. Esse relatório passa por prévia e remoção de conteúdo financeiro. A ausência de telemetria local não pode desativar funções gratuitas.

### Evidências de validação

O relatório do beta deve separar defeitos financeiros, falhas de segurança, dificuldades de entendimento, formatos sem cobertura e pedidos de evolução. O extrato pessoal oferecido pelo responsável pelo projeto poderá ajudar na homologação mediante autorização; preferir versão minimizada ou sintética e nunca incluí-lo em repositório público.

<!-- pagebreak -->

## 20 · Critérios de liberação do MVP

O beta pode ter entregas intermediárias, mas o MVP só será considerado concluído com Desktop, Web e Mobile no recorte acordado e os requisitos P0 implementados. P1 pode continuar em evolução. Testes não realizados devem permanecer explicitamente pendentes, não marcados como aprovados por revisão de código.

| Teste | Cenário e resultado esperado | Referências |
| --- | --- | --- |
| CT-01 | Desktop sem rede/cadastro cria espaço, importa e consulta sem tráfego financeiro externo | RF-01–03, RF-35 |
| CT-02 | Backup restaura em outra instalação; senha errada e adulteração não causam perda | RF-32, RNF-03 |
| CT-03 | Importação cancelada não altera dados; repetição de confirmação não duplica | RF-10–13 |
| CT-04 | Períodos sobrepostos e compras iguais legítimas recebem tratamento distinto | RF-12 |
| CT-05 | Desfazer lote restaura estado; alterações posteriores geram resolução segura | RF-14 |
| CT-06 | Compra de cartão e pagamento de fatura não duplicam consumo | RF-08, RN-06–07 |
| CT-07 | Transferência preserva total; ajuste de saldo não vira receita sem decisão | RF-05–07 |
| CT-08 | Busca de energético soma apenas itens; múltiplos pagamentos não os duplicam | RF-20–22 |
| CT-09 | Nenhuma rota, exportação, busca ou cache revela dados de espaço/conta proibidos | RF-25–27, RNF-02 |
| CT-10 | Duas edições offline conflitantes preservam versões e exigem resolução | RF-29–31 |
| CT-11 | Migrações preservam totais, suportam falha e não ressuscitam acesso antigo | RF-33–34 |
| CT-12 | Arquivamento/exclusão respeitam datas e uma restauração de desastre reaplica exclusões | RF-37, RNF-06 |
| CT-13 | Original temporário é limpo; logs e diagnósticos não contêm o documento | RF-18, RF-35 |
| CT-14 | Leitor sem exportação é bloqueado também na API; suporte expira e é auditado | RF-38, RF-40–41 |
| CT-15 | Login, recuperação e vinculação de provedores preservam controle de identidade | RF-01, RF-28 |
| CT-16 | Totais conferem nos três clientes; navegação por teclado/leitor de tela funciona | RF-23–24, RNF-12 |

### Barreiras de qualidade

Não liberar com vulnerabilidade crítica/alta conhecida sem correção e reavaliação; vazamento entre espaços; perda ou duplicação financeira reproduzível; backup sem restauração demonstrada; promessa de privacidade incompatível com o tráfego real; ou fluxo destrutivo sem tratamento de falha.

Antes de dados reais, publicar avisos de privacidade e retenção, matriz de compatibilidade, limitações do beta, contato de suporte e procedimento de incidentes. Segurança e validação jurídica não são substituídas pelo aceite deste PRD.

<!-- pagebreak -->

## 21 · Entregas e modelo comercial

### Sequência de implementação por dependência

| Marco | Entrega verificável | Dependência principal |
| --- | --- | --- |
| M0 — fundações | Provas de criptografia/backup, modelo financeiro, sincronização e catálogo inicial de arquivos | Arquitetura e casos de referência |
| M1 — valor local | Desktop sem conta; contas, lançamentos, OFX/CSV, revisão e painel | M0 |
| M2 — qualidade e detalhe | XLSX/PDFs homologados, regras, lotes reversíveis, XML e busca em itens | M1 |
| M3 — colaboração | Identidade, Web cloud, membros, auditoria, sincronização Desktop e migrações | Contratos de dados estabilizados em M0–M2 |
| M4 — experiência Mobile | Cliente cloud, edição offline autorizada, arquivos/revisão e paridade de cálculos | Contratos de sincronização e autorização |
| M5 — beta integrado | Testes de ponta a ponta, acessibilidade, restauração, privacidade e validação com participantes | P0 das três plataformas |

Essa é uma ordem de dependências, não um calendário ou estimativa de esforço. Partes podem avançar em paralelo se houver equipe. Um alpha Desktop não será anunciado como o MVP completo. Compromissos futuros P1 entram sem deslocar segurança, integridade e busca em itens.

### Responsabilidades necessárias

Produto define escopo e linguagem; engenharia implementa núcleo, clientes e backend; qualidade mantém arquivos e cenários de teste; segurança valida ameaças, chaves e isolamento; operação prepara backup/incidentes; revisão jurídica fecha finalidades, contratos, fornecedores e retenção. Uma pessoa pode acumular papéis, mas nenhuma dessas responsabilidades desaparece por isso.

### Cobrança por espaço

**Decisão consolidada:** espaços locais ilimitados e gratuitos, sujeitos à capacidade do dispositivo. Participar como funcionário, leitor ou contador não gera automaticamente assinatura individual. O espaço cloud possui um proprietário e poderá ter um responsável de faturamento organizacional, sem misturar identidade de acesso com pagador.

**Proposta v1:** beta fechado sem cobrança automática; guardar plano e direitos de uso por espaço. Preços, franquias, limites de usuários e meios de pagamento serão decididos após medir custos. O cancelamento de plano deverá preservar um caminho para exportação ou migração local e explicar o destino dos dados.

Custos a medir: banco, backups, tráfego, autenticação, processamento de importação, distribuição/assinatura dos aplicativos e suporte. IA/OCR externo e Open Finance exigirão orçamento e consentimentos próprios quando adicionados. Não justificar monetização por venda de dados ou limitação artificial de espaços exclusivamente locais.

<!-- pagebreak -->

## 22 · Diretrizes para os próximos artefatos

### Arquitetura: restrições e candidatos, não decisão de implementação fechada

Preservar um núcleo de regras financeiras testável entre plataformas, armazenamento local exclusivo do Desktop, cache cloud com autorização, identificadores estáveis e isolamento de espaços em toda a cadeia. Começar com backend modular; separar processamento pesado em tarefas próprias quando necessário, sem exigir microserviços para cada função.

| Camada | Candidato para validação na arquitetura |
| --- | --- |
| Web e interface Desktop | React/TypeScript com componentes compartilháveis; aplicação Desktop empacotada localmente |
| Desktop | Tauri com camada nativa controlada e banco local criptografado |
| Mobile | React Native/Expo, com build nativo e cache criptografado quando autorizado |
| Backend | TypeScript/Node.js em monólito modular; API de domínio explícita |
| Cloud | PostgreSQL; armazenamento temporário segregado; backups e chaves gerenciados |
| Portabilidade futura | Containers, configuração externa e dependências substituíveis para instalação privada |

Tauri oferece um sistema de capacidades para limitar exposição de comandos ao frontend; isso não torna qualquer plugin ou banco automaticamente criptografado. A prova Desktop deve verificar banco, chaves, atualização e restrições de arquivos. [S5]

Expo documenta suporte a SQLCipher e informa que ele não funciona no Expo Go. A validação Mobile precisa usar build compatível; a persistência criptografada não pode ser presumida por um protótipo de interface. [S6]

PostgreSQL oferece políticas de segurança por linha, mas certos papéis, incluindo superusuários e proprietários em condições específicas, podem contorná-las. Autorização na aplicação, configuração de papéis e testes são necessários mesmo com essas políticas. [S8]

Next.js pode ser avaliado para Web, mas recursos exclusivos de servidor não podem ser pressupostos na interface embarcada no Desktop. O PRD não exige compartilhar 100% da interface ou do código. Nenhuma engine de jogos é requisito do produto.

### Modelo de dados e rastreabilidade

O ERD deverá separar identidade, espaço, membros/permissões, conta financeira, movimento, classificação/rateio, documento, item, alocação de conciliação, lote, revisão, regra, dispositivo, fila, consentimento/configuração e ciclo de vida. Estados de armazenamento, aprovação futura e exclusão não devem ser comprimidos em um único campo ambíguo.

O mapa de telas derivará onboarding, importação, busca em itens, compartilhamento, conflito, backup, migração e exclusão, incluindo estados de erro. Cada fluxo referencia RF/RN/RNF; toda história de implementação deve indicar critério de aceite e teste associado. Alterações de escopo exigem atualização deste PRD e dos artefatos afetados.

<!-- pagebreak -->

## 23 · Hipóteses, riscos e decisões restantes

O planejamento pode avançar sem nova rodada extensa de perguntas. Os itens abaixo são decisões de execução ainda não tomadas pelo responsável do produto. Não devem ser confundidos com requisitos previamente aprovados.

| Item | Proposta v1 e condição para fechamento | Responsável funcional |
| --- | --- | --- |
| H-01 — sistemas operacionais | Windows 11 x64 primeiro no Desktop; Android/iOS no Mobile; homologar versões e distribuição | Produto + engenharia |
| H-02 — formatos reais | OFX/CSV/XLSX, XML e PDFs selecionados; obter corpus autorizado e catálogo por leitor | Produto + qualidade |
| H-03 — funcionamento Web | Sem banco financeiro persistente; escrita exige conexão no MVP | Produto + arquitetura |
| H-04 — acesso offline cloud | Habilitação por espaço/dispositivo; convidados desligados por padrão; revalidação em 24 h | Produto + segurança |
| H-05 — exclusão residual | Remoção operacional em até 24 h; backups até 30 dias posteriores; validar política jurídica | Operação + jurídico |
| H-06 — limites e desempenho | Benchmark da seção 17; definir hardware, tamanhos máximos e carga concorrente | Engenharia + qualidade |
| H-07 — provedores e região | Escolher nuvem, identidade, região e subprocessadores após requisitos e custos | Arquitetura + jurídico |
| H-08 — beta e faturamento | Sem cobrança automática no beta; preços e franquias após medição | Produto |

### Riscos prioritários e resposta

**Risco de escopo:** três clientes, offline e colaboração ampliam o trabalho. Resposta: marcos verificáveis, P1 fora do bloqueio e evitar módulos empresariais antecipados.

**Risco financeiro:** duplicidades, cartão e rateios podem gerar números plausíveis, porém errados. Resposta: exemplos de referência, reconciliação, preservação de origem e barreiras CT-03 a CT-08.

**Risco de privacidade:** exportação, cache e suporte podem contornar uma interface restrita. Resposta: autorização no servidor, minimização, avisos honestos e teste CT-09/14.

**Risco de perda local:** ausência de cadastro impede recuperação central. Resposta: backup criptografado acessível, teste de restauração e aviso persistente sem obrigar adesão à nuvem.

**Risco de fornecedores/formato:** mudanças de bancos, documentos e dependências podem quebrar importação ou distribuição. Resposta: leitores versionados, corpus de regressão, atualização assinada e catálogo de compatibilidade.

**Risco de retenção incoerente:** dados excluídos retornarem de backups ou clientes antigos. Resposta: marcadores de exclusão, geração de sincronização e ensaio de restauração com exclusões reaplicadas.

### Controle de mudança

Este PRD consolida as decisões do levantamento; suas propostas técnicas e operacionais continuam sujeitas a revisão. Cada mudança posterior registra versão, motivo, requisitos afetados e impactos em telas, dados, arquitetura, testes e comunicação ao usuário. Nenhum requisito deve ser removido apenas por desaparecer do backlog técnico.

<!-- pagebreak -->

## 24 · Rastreabilidade e referências

### Decisões do levantamento preservadas

| Decisão consolidada | Onde foi especificada |
| --- | --- |
| PF → MEI/pequenas empresas → maiores; Brasil primeiro | Seções 01 e 03 |
| Desktop no MVP, local anônimo e ilimitado; Web/Mobile cloud | Seções 02, 04 e 21 |
| Dados e permissões pertencem ao espaço, não à conta | Seções 04 e 12 |
| Revisão de importação, repetidos e lotes reversíveis | Seções 07 e 08 |
| Busca por produto dentro das notas; somente dados extraídos | Seções 09 e 10 |
| Migração reversível; backup e arquivamento de 30 dias | Seções 14 e 15 |
| Cartão simplificado; saldo prévio; futuros sem prioridade alta | Seções 05, 06 e 11 |
| Papéis simples com restrições, suporte autorizado e exportação controlada | Seções 12 e 16 |
| IA somente com liberação separada; evolução posterior | Seções 03 e 15 |
| Cobrança por espaço; beta fechado; instalação própria futura | Seções 21 e 22 |

### Referências públicas

As referências sustentam somente observações externas indicadas no texto. Requisitos, prazos propostos, arquitetura candidata e metas são decisões de produto/engenharia, não exigências automaticamente impostas por essas fontes. Consulta realizada em **5 de outubro de 2026**.

**[S1] Presidência da República — Lei nº 13.709/2018, texto atualizado (LGPD).** Artigos 5º–9º, 15–19 e 46: conceitos, finalidades, bases, direitos, conservação e segurança. A aplicação aos fluxos deve passar por revisão jurídica.

**[S2] ANPD — Materiais Educativos e Publicações.** Catálogo dos guias sobre agentes de tratamento e segurança da informação; referência para a matriz de responsabilidades e controles.

**[S3] Portal Nacional da NF-e — Esquemas XML.** Catálogo oficial identificado por busca; versões concretamente suportadas serão homologadas. O conteúdo integral do catálogo não foi recuperado nesta consulta.

**[S4] W3C — Web Content Accessibility Guidelines 2.2.** Referência de critérios testáveis de acessibilidade, incluindo nível AA.

**[S5] Tauri — Capabilities.** Modelo de permissões e limites de exposição das interfaces nativas à aplicação.

**[S6] Expo — SQLite / SQLCipher.** Persistência e configuração de banco criptografado; limitação referente ao Expo Go.

**[S7] Secretaria da Fazenda do Paraná — MOC Online NFAg, Tabelas e Informações.** Trecho oficial indexado sobre adaptação de campos para CNPJ alfanumérico. Texto completo não recuperado nesta consulta; a implementação exige conferência da especificação aplicável.

**[S8] PostgreSQL — Row Security Policies.** Políticas por linha, papéis e condições de bypass; referência para defesa em camadas, não garantia isolada de segregação.

**Registro de versão:** v1.0 — primeira consolidação do PRD, com Desktop formalmente incluído no MVP. Não inclui implementação, homologação de bancos, certificação de segurança ou aprovação jurídica já realizadas.


[S1]: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
[S2]: https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes
[S3]: https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=BMPFMBoln3w%3D
[S4]: https://www.w3.org/TR/WCAG22/
[S5]: https://v2.tauri.app/security/capabilities/
[S6]: https://docs.expo.dev/versions/latest/sdk/sqlite/
[S7]: https://moc.sped.fazenda.pr.gov.br/NFAG/TabelasEInformacoes.html
[S8]: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
