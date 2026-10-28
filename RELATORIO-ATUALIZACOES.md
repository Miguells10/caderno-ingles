# Relatório do Caderno de Inglês

**Estado em 28/10/2026:** aplicativo local para Windows, versão 1.1.1 instalada. Este documento resume decisões, funcionalidades, atualização dos dados, verificações e pendências para revisão técnica.

## Objetivo e limites do produto

Miguel pediu um caderno pessoal para acelerar o estudo de inglês: guardar materiais, aulas, roteiros, notas, respostas e correções, observar a evolução e retomar expressões com flashcards. O tutor continua neste chat, conectado por MCP local ou arquivos Markdown. Escuta e fala acontecem fora do aplicativo e podem ser registradas depois. A proposta evita pontuação, ranking, nível CEFR calculado e cobrança por dias sem estudo.

O aplicativo roda localmente no Windows com Electron, React, TypeScript, Vite e SQLite. Não depende de uma conta nem de um servidor para abrir. A interface segue a direção aprovada de papel claro e verde escuro. O código está organizado para uma eventual versão hospedada, mas não há sincronização em nuvem nesta entrega.

## Funcionalidades existentes

- **Hoje:** próximo passo, revisões vencidas, histórico recente e acesso à prática externa avulsa.
- **Aulas:** calendário e lista; criação e edição de aula, atividade e vínculo com material; enunciados em Markdown; rascunho, resposta inicial, nova tentativa, retorno do tutor, reutilização e confirmação de conclusão.
- **Revisar:** cartões, resposta antes de revelar, pista opcional, autoavaliação e revisão espaçada. Os intervalos padrão permanecem em 1, 3 e 7 dias.
- **Biblioteca:** links, vídeos, PDFs e notas. Anexos escolhidos pelo usuário são copiados para a pasta local do aplicativo.
- **Evolução:** revisões, tentativas, práticas confirmadas, tempo conhecido e registros sem duração informada.
- **Ajustes:** preferências, caminho dos dados, backup/restauração, exportação/importação Markdown, configuração MCP e atalho.

As respostas iniciais, correções, conclusões e revisões são registros históricos separados. Uma resposta corrigida não substitui o texto original. Fala e escuta não são inferidas de uma resposta escrita. Atividades concluídas exigem confirmação do aluno.

## Atualização 1.1.0: cinco melhorias

1. **Dados e reutilização:** o estado local passou para o formato 2. Correções podem carregar uma expressão alvo, até duas situações opcionais e uma categoria de erro sugerida. As situações aparecem apenas na etapa de reutilização e alteram a orientação exibida, sem preencher a resposta.
2. **Aquecimento:** antes de abrir a primeira aula do dia, aparece um cartão vencido quando há um. O aluno responde ou indica que não lembrou, revela o verso, registra uma autoavaliação e segue. Uma revisão já feita na tela de cartões satisfaz o aquecimento daquele dia. Sem cartão vencido, a aula abre diretamente.
3. **Prática externa avulsa:** acesso rápido para registrar conversa, monólogo ou escuta. Duração real e expressão usada são opcionais. O registro aparece no histórico e na evolução, sem concluir atividade de aula nem avaliar pronúncia.
4. **Tipos de erro:** o tutor pode sugerir transferência do português, combinação de palavras, preposição, forma verbal ou outro. O aluno aceita ou altera a categoria; ela fica vinculada à correção, preservando resposta e feedback. A Evolução mostra contagens e exemplos.
5. **Comparação de escrita:** o aluno escolhe duas respostas iniciais de atividades distintas para ver lado a lado, com data e origem. Conectivos e expressões alvo dos cartões são destacados. A comparação não gera nota, nível ou pareamento automático.

As ferramentas MCP e a exportação/importação Markdown receberam os novos campos e registros. Arquivos e backups da versão 1 continuam aceitos. A importação preserva IDs e rejeita conflitos; o JSON incorporado ao Markdown contém o histórico completo.

## Atualização 1.1.1: correções após revisão de código

- O formulário só oferece avaliação para correções. Ao trocar o tipo para pista, a avaliação volta a “sem avaliação”.
- O domínio rejeita expressão alvo, situações ou categoria associadas a uma pista, inclusive quando o comando chega pelo MCP. Registros históricos anteriores continuam legíveis.
- A comparação exige respostas de atividades diferentes e limpa uma seleção que fique incompatível quando o primeiro texto muda.

## Estrutura e integridade dos dados

- `core/store.ts` valida estado e comandos com Zod e grava no SQLite em transações. O banco usa WAL, journal de operações e registros históricos imutáveis. `requestId` permite repetir uma operação com o mesmo conteúdo sem duplicá-la.
- `core/metrics.ts` calcula cartões vencidos, aquecimento e indicadores a partir de evidências salvas. Tempo não informado permanece desconhecido.
- `electron/main.ts` é o processo principal; `electron/preload.ts` expõe uma API pequena ao React com isolamento de contexto, integração Node desativada na tela e sandbox ativo.
- `electron/mcp.ts` oferece ferramentas locais por entrada e saída padrão para ler contexto e registrar aulas, cartões, respostas, feedback, revisões, práticas externas e categorias.
- `electron/exchange.ts` exporta/importa Markdown e backup JSON, valida arquivos e detecta conflitos de IDs.
- `shared/types.ts` define o contrato entre domínio, Electron, MCP e interface.

O banco instalado fica em `%APPDATA%\Caderno Ingles\dados\caderno.sqlite`. O instalador não apaga os dados na desinstalação. A pasta `backups/` neste projeto guarda uma cópia anterior à atualização 1.1.0 e foi excluída do Git.

## Evidências de entrega

- Na versão 1.1.1, `npm test` concluiu **21 de 21 testes**. Os cenários cobrem migração do estado 1, restauração, importação/exportação, revisão diária, registro externo e categorias. Esses testes não cobrem a inspeção visual nem uma sessão MCP com o executável instalado.
- A versão 1.1.1 passou por compilação TypeScript, build Vite, geração do processo Electron, instalador NSIS e versão portátil.
- A versão 1.1.1 foi instalada e aberta. Depois da instalação, uma leitura do banco confirmou **7 aulas, 6 respostas e 2 cartões**, os mesmos totais registrados antes da atualização.
- Os arquivos locais de entrega são `release/Caderno-Ingles-Setup-1.1.1.exe` e `release/Caderno-Ingles-Portable-1.1.1.exe`. Esses binários não entram no repositório Git.

## Verificações que ainda cabem

- Conferir visualmente as telas novas em janela estreita e larga. As regras responsivas foram adicionadas, mas o controle da janela não permitiu completar essa inspeção manual.
- Exercitar o fluxo completo pela interface instalada e testar uma sessão MCP conectada ao executável instalado. Compilação e testes de domínio não substituem essas verificações.
- Depois do primeiro envio ao GitHub, conferir o resultado real da checagem automática. A existência do arquivo de workflow não prova uma execução bem-sucedida.

## GitHub e privacidade

O repositório deve ser **privado** porque o código de dados iniciais contém contexto pessoal de estudo e trabalho. `.gitignore` exclui dependências, builds, executáveis, dados locais, backups e arquivos temporários. O workflow `.github/workflows/verify.yml` está preparado para rodar `npm ci`, `npm test` e `npm run build` a cada envio ou pull request. Ele não publica nem instala uma nova versão.

Em 28/10/2026, o Git local foi iniciado na branch `main` e `origin` aponta para `https://github.com/Miguells10/caderno-ingles.git`. **O repositório remoto ainda não existe e nenhum commit foi enviado.** A conexão do GitHub no Codex permitiu confirmar a conta `Miguells10`, mas não oferece criação de repositório. O `gh` instalado está com autenticação inválida e a página de criação pediu login; o GitHub Desktop não aceitou controle remoto da janela nesta sessão. Por isso, a criação privada e o primeiro envio precisam ser concluídos na conta do usuário.

Para fazer o primeiro envio: entrar no GitHub como `Miguells10`, criar um repositório **privado** chamado `caderno-ingles` sem arquivos iniciais, revisar os arquivos locais, criar o primeiro commit e enviar a branch `main` ao `origin`. Depois, abrir a aba **Actions** e confirmar a primeira execução de `Verificar Caderno`.

Para revisar uma atualização futura no GitHub: criar uma branch, enviar os commits, abrir um pull request, conferir o diff e o status do workflow, e só então integrar na branch principal. O instalador local continua exigindo `npm run package:win` e instalação explícita.

## Adendo — atualização 1.3.0 (28/10/2026)

O app ganhou verificação de atualizações ao abrir e opção manual em Ajustes. Quando há uma versão nova, mostra o aviso, baixa sob demanda e aplica após reiniciar. Usa electron-updater com o instalador NSIS e lê a autenticação do GitHub CLI da máquina para consultar o repositório privado; o token não é enviado à interface. O workflow de release publica o instalador e latest.yml quando uma tag v<versão> for enviada.

Verificação local: 22 testes passaram, o build passou e o instalador release/Caderno-Ingles-Setup-1.3.0.exe foi gerado com latest.yml e app-update.yml. Ainda não houve instalação da 1.3.0 nem teste de atualização entre duas versões publicadas. O repositório GitHub remoto e o login do gh continuam pendentes; a branch local ainda não tinha commit no momento desta nota.
