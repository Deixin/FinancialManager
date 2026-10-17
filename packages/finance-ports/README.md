# finance-ports

Ports puros de leitura e DTOs para Accounts/Transactions, com dinheiro i64 em strings e sem cliente SQL. readAccountActivity coordena os ports explicitamente. Veja o [guia US-024](../../docs/development/data-access.md). A implementação de autorização, persistência e transporte pertence ao host; este pacote não oferece escrita financeira.
