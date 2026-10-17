# finance-ports

US-040 acrescenta createAccountWriteService com autorização de workspace/conta/criação e readCalculatedAccountBalance com snapshot obrigatório, leitura de todas as páginas e cálculo Domain. São portas internas; não são endpoints ou autorização baseada em entrada do usuário.

Ports puros e DTOs para Accounts/Transactions, com dinheiro i64 em strings e sem cliente SQL público. A entrada principal fornece as leituras US-024 e readAccountActivity. Veja o [guia](../../docs/development/data-access.md).

O subpath revisions fornece o coordenador US-026: base explícita, autorização/ator do host, snapshots antes/depois, lote atômico e reversão por nova versão. O adapter confiável implementa RevisionStore; comandos retornam apenas IDs/versões. São aceitas até 10000 alterações por unidade, sem divisão em commits. [Guia US-026](../../docs/development/financial-revisions.md). Persistência, transportes, policy engine e efeitos de sync pertencem às respectivas integrações.
