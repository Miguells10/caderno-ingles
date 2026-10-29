# Caderno · Inglês

Aplicativo pessoal de estudos para Windows, feito com Electron, React, TypeScript e SQLite. Guarda aulas, materiais, tentativas escritas, correções, reutilizações e flashcards no computador. Áudio e conversação acontecem fora do app.

## Usar no Windows

Instale o arquivo `Caderno-Ingles-Setup-<versão>.exe` uma vez. A localização dos dados aparece em Ajustes. A partir da versão 1.3.1, o app verifica atualizações privadas; versões antigas e a edição portátil precisam de instalação manual.

A versão 1.2.0 acrescentou exportação do planejamento inteiro ou de uma aula em JSON e Markdown, com evidências registradas e reimportação sem duplicatas. O histórico v1 continua aceito.

## Desenvolvimento

Requer Node.js 22 ou mais recente e npm.

```powershell
npm install
npm run dev
npm run build
npm run package:win
```

`npm run package:win` gera o instalador NSIS e a versão portátil em `release/`. É preciso baixar as dependências na primeira vez.

## Tutor e cópias

Em **Ajustes**, exporte o planejamento e histórico completos em Markdown ou JSON. Na tela de uma aula, exporte só o contexto dela nos mesmos formatos. O relatório inclui data prevista, tarefas, respostas originais, retornos, reutilizações, confirmações, cartões e revisões; separa tempo sugerido de tempo realmente registrado. Você pode entregar o arquivo a outra IA para analisar a trajetória e recomendar os próximos exercícios. O arquivo também guarda os dados estruturados para reimportação.

**Importar JSON ou Markdown** acrescenta os registros que ainda não existem. Repetir a importação não duplica dados; se um ID já existir com conteúdo diferente, a importação para e preserva os dados atuais. O campo `report` do JSON e a parte legível do Markdown são para análise: recomendações escritas ali não viram aulas automaticamente. Uma nova aula pode ser cadastrada no app ou pelo MCP após sua revisão. O backup JSON usa outro formato e é restaurado pela opção **Restaurar de backup**, que substitui os registros após confirmação.

O MCP usa stdio e compartilha o mesmo SQLite local; não abre uma porta de rede. Use a configuração mostrada pelo app no cliente MCP. O tutor deve ler o contexto atual antes de editar e confirmar com Miguel antes de concluir uma prática. As ferramentas MCP aceitam expressões alvo, até duas situações para reutilização, uma explicação curta da regra na correção, práticas externas e categorias de erro.

As tarefas escritas podem partir de um cenário técnico com destinatário e objetivo, sem exigir que o aluno invente fatos sobre o próprio dia. O tutor começa pela produção, oferece uma pista concreta e explica diretamente a regra quando a pista não resolve ou quando o aluno pede. A explicação aparece antes da reutilização e, junto das expressões alvo, fica consultável em Evolução. Essa lista registra o que foi trabalhado; não presume que o conteúdo já foi dominado. As aulas concluídas e as respostas originais permanecem no histórico.

Backup completo e restauração ficam em Ajustes. A restauração pede confirmação e substitui os registros atuais.

## GitHub

O projeto está em `C:\Users\Miguel Lucas\Documents\Estudos\caderno-ingles`. O endereço `origin` aponta para o repositório privado `Miguells10/caderno-ingles`. O login do GitHub CLI pertence ao computador, não à pasta. A ação `Verificar Caderno` executa testes e build em cada envio e pull request. Dados locais, backups e instaladores estão excluídos do Git.

## Atualizações do aplicativo

A versão instalada procura uma atualização ao abrir e oferece **Baixar** e **Reiniciar e atualizar**. Também há **Verificar atualizações** em Ajustes. O aplicativo lê a autenticação privada do GitHub CLI neste computador; nenhum token entra no código ou no instalador. Sem login, o app mostra essa necessidade em Ajustes. A pasta portátil não se atualiza automaticamente.

Para publicar uma nova versão, primeiro atualize `version` em `package.json` e `package-lock.json`, confirme testes e crie/envie uma tag `v<versão>` no repositório privado. O workflow `Publicar atualização do Caderno` gera o instalador NSIS e o arquivo `latest.yml` no mesmo GitHub Release. A instalação inicial ainda é manual.

O [relatório de atualizações](RELATORIO-ATUALIZACOES.md) reúne o contexto técnico, as verificações e as pendências para revisão.

## Dados iniciais

Na primeira execução, o app traz a prática escrita confirmada de 16/10/2026 e dois flashcards anotados nos registros locais. A fala não foi marcada como concluída. As tarefas de 26 a 31/10 aparecem como pendentes. Tempos desconhecidos continuam desconhecidos.
