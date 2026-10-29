import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StudyStore } from '../core/store.js';
import { starterState } from './seed.js';
import type { Command, SystemAction, UpdateAction } from '../shared/types.js';
import { exportExchange, exportMarkdown, importExchange, importMarkdown, restoreBackup, writeBackup } from './exchange.js';
import { startMcpServer } from './mcp.js';
import { createUpdater } from './updater.js';

app.setName('Caderno Ingles');
const storeDir = join(app.getPath('userData'), 'dados');
mkdirSync(storeDir, { recursive: true });
const store = new StudyStore(storeDir, starterState());

if (process.argv.includes('--mcp')) {
  app.whenReady().then(async () => {
    const { server, transport } = await startMcpServer(store);
    await server.connect(transport);
  }).catch(error => { console.error(error); app.exit(1); });
} else {
  const locked = app.requestSingleInstanceLock();
  if (!locked) app.quit();
  else {
    app.on('second-instance', () => BrowserWindow.getAllWindows()[0]?.focus());
    app.whenReady().then(() => {
      const updater = createUpdater(status => {
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send('caderno:update-changed', status);
      });
      ipcMain.handle('caderno:update', (_event, action: UpdateAction) => updater.act(action));
      ipcMain.handle('caderno:state', () => store.getState());
      ipcMain.handle('caderno:command', (_event, command: Command) => {
        const result = store.execute(command);
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send('caderno:changed');
        return result;
      });
      ipcMain.handle('caderno:system', async (_event, action: SystemAction, payload?: Record<string, string>) => {
        switch (action) {
          case 'exportMarkdown': {
            const selected = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: 'Escolha a pasta de intercâmbio com o tutor' });
            if (selected.canceled || !selected.filePaths[0]) return { canceled: true };
            return { path: await exportMarkdown(store.getState(), selected.filePaths[0]), message: 'Arquivo Markdown atualizado.' };
          }
          case 'importMarkdown': {
            const selected = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md'] }], title: 'Importar uma aula ou correção' });
            if (selected.canceled || !selected.filePaths[0]) return { canceled: true };
            const result = await importMarkdown(selected.filePaths[0], store);
            return { message: `Importação concluída: ${result.added} itens novos, ${result.unchanged} sem alteração.` };
          }
          case 'exportExchange':
          case 'exportLesson': {
            const format = payload?.format;
            if (format !== 'md' && format !== 'json') throw new Error('Escolha Markdown ou JSON.');
            const lessonId = action === 'exportLesson' ? payload?.lessonId : undefined;
            if (action === 'exportLesson' && !lessonId) throw new Error('Selecione uma aula.');
            const defaultName = lessonId ? `Caderno-Ingles-aula-${lessonId}.${format}` : `Caderno-Ingles-contexto.${format}`;
            const selected = await dialog.showSaveDialog({
              defaultPath: join(app.getPath('documents'), defaultName),
              filters: [{ name: format === 'json' ? 'JSON para intercâmbio' : 'Markdown para intercâmbio', extensions: [format] }],
              title: lessonId ? 'Exportar contexto desta aula' : 'Exportar planejamento e histórico',
            });
            if (selected.canceled || !selected.filePath) return { canceled: true };
            return { path: await exportExchange(store.getState(), selected.filePath, format, lessonId), message: 'Contexto exportado para análise e reimportação.' };
          }
          case 'importExchange': {
            const selected = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Intercâmbio do Caderno', extensions: ['md', 'json'] }], title: 'Importar contexto do Caderno' });
            if (selected.canceled || !selected.filePaths[0]) return { canceled: true };
            const result = await importExchange(selected.filePaths[0], store);
            return { message: `Importação concluída: ${result.added} itens novos, ${result.unchanged} já existentes.` };
          }
          case 'backup': {
            const selected = await dialog.showSaveDialog({ defaultPath: join(app.getPath('documents'), 'Caderno-Ingles-backup.json'), filters: [{ name: 'Backup completo', extensions: ['json'] }] });
            if (selected.canceled || !selected.filePath) return { canceled: true };
            return { path: await writeBackup(store.getState(), selected.filePath), message: 'Backup completo salvo.' };
          }
          case 'restore': {
            const selected = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Backup JSON', extensions: ['json'] }] });
            if (selected.canceled || !selected.filePaths[0]) return { canceled: true };
            const confirmation = await dialog.showMessageBox({ type: 'warning', buttons: ['Cancelar', 'Restaurar backup'], defaultId: 0, cancelId: 0, message: 'Restaurar este backup substituirá os dados atuais por uma cópia completa.' });
            if (confirmation.response !== 1) return { canceled: true };
            store.restore(await restoreBackup(selected.filePaths[0]));
            return { message: 'Dados restaurados do backup.' };
          }
          case 'attachFile': {
            const selected = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Materiais', extensions: ['pdf', 'txt', 'md', 'png', 'jpg', 'jpeg', 'webp'] }] });
            if (selected.canceled || !selected.filePaths[0]) return { canceled: true };
            const attachmentId = randomUUID();
            const attachmentName = basename(selected.filePaths[0]);
            const attachmentDir = join(app.getPath('userData'), 'anexos');
            mkdirSync(attachmentDir, { recursive: true });
            copyFileSync(selected.filePaths[0], join(attachmentDir, attachmentId));
            return { attachmentId, attachmentName, message: 'Anexo copiado para os dados locais.' };
          }
          case 'openAttachment': {
            const attachmentId = payload?.attachmentId ?? '';
            if (!/^[a-f0-9-]{36}$/i.test(attachmentId)) throw new Error('Identificador do anexo inválido.');
            const file = join(app.getPath('userData'), 'anexos', attachmentId);
            if (!existsSync(file)) throw new Error('Esse arquivo anexo não foi encontrado.');
            const problem = await shell.openPath(file);
            if (problem) throw new Error(problem);
            return {};
          }
          case 'openExternal': {
            const url = new URL(payload?.url ?? '');
            if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Endereço externo inválido.');
            await shell.openExternal(url.toString()); return {};
          }
          case 'openDataFolder': await shell.openPath(storeDir); return {};
          case 'openExchangeFolder': {
            const dir = join(app.getPath('documents'), 'Caderno Ingles');
            mkdirSync(dir, { recursive: true }); await shell.openPath(dir); return { exchangeDir: dir };
          }
          case 'createShortcut': {
            if (process.platform !== 'win32') throw new Error('Atalho disponível no Windows.');
            const link = join(app.getPath('desktop'), 'Caderno - Ingles.lnk');
            const ok = shell.writeShortcutLink(link, 'create', { target: process.execPath, description: 'Caderno pessoal de estudos de inglês', icon: process.execPath });
            if (!ok) throw new Error('O Windows não conseguiu criar o atalho.');
            return { path: link, message: 'Atalho criado na área de trabalho.' };
          }
          case 'copyTutorPrompt': {
            const state = store.getState();
            const requestedActivity = state.activities.find(item => item.id === payload?.activityId);
            const requestedLessonId = requestedActivity?.lessonId ?? payload?.lessonId;
            const lesson = state.lessons.find(item => item.id === requestedLessonId && !item.archived)
              ?? [...state.lessons].filter(item => !item.archived).sort((a, b) => {
                const started = (lessonId: string) => state.activities.some(activity => activity.lessonId === lessonId && (state.attempts.some(attempt => attempt.activityId === activity.id) || Boolean(state.drafts[activity.id])));
                return Number(started(b.id)) - Number(started(a.id)) || a.scheduledDate.localeCompare(b.scheduledDate);
              })[0];
            const activities = lesson ? state.activities.filter(item => item.lessonId === lesson.id).sort((a, b) => a.order - b.order) : [];
            const focus = requestedActivity ?? activities.find(activity => !state.completions.some(item => item.activityId === activity.id)) ?? activities[0];
            const lines = [
              '# Contexto atualizado do Caderno de Inglês',
              `Aluno: ${state.settings.name}. Objetivo: ${state.settings.goal}`,
              lesson ? `\n## Aula: ${lesson.title}\nData prevista: ${lesson.scheduledDate}\nObjetivo: ${lesson.objective}\nDuração sugerida: ${lesson.minutes} min\nAssuntos: ${lesson.tags.join(', ') || 'não informados'}` : '\nAinda não há aulas cadastradas no caderno.',
            ];
            if (lesson) {
              lines.push('\n## Etapas, respostas e retornos já registrados');
              for (const activity of activities) {
                const attempts = state.attempts.filter(item => item.activityId === activity.id);
                const completion = state.completions.find(item => item.activityId === activity.id);
                lines.push(`\n### ${activity.title}${activity.id === focus?.id ? ' (etapa atual)' : ''}\nFoco: ${activity.skill}; tipo: ${activity.kind}\nInstrução: ${activity.prompt}`);
                if (activity.criteria) lines.push(`Critérios: ${activity.criteria}`);
                if (state.drafts[activity.id]) lines.push(`Rascunho ainda não enviado: ${state.drafts[activity.id]}`);
                for (const attempt of attempts) {
                  lines.push(`\nResposta (${attempt.stage}; ${attempt.source}):\n${attempt.text}`);
                  for (const feedback of state.feedback.filter(item => item.attemptId === attempt.id)) {
                    lines.push(`Retorno do tutor (${feedback.kind}${feedback.result !== 'ungraded' ? `; ${feedback.result}` : ''}):\n${feedback.text}`);
                    if (feedback.ruleExplanation) lines.push(`Por que essa forma funciona: ${feedback.ruleExplanation}`);
                    if (feedback.correctedText) lines.push(`Versão corrigida: ${feedback.correctedText}`);
                    if (feedback.reusePrompt) lines.push(`Pedido de reutilização: ${feedback.reusePrompt}`);
                    if (feedback.targetChunk) lines.push(`Expressão alvo: ${feedback.targetChunk}`);
                    if (feedback.contextSeeds?.length) lines.push(`Situações opcionais de reutilização: ${feedback.contextSeeds.join(' | ')}`);
                    const errorType = state.feedbackErrorTypes[feedback.id];
                    if (errorType) lines.push(`Categoria de erro confirmada: ${errorType}`);
                    else if (feedback.suggestedErrorType) lines.push(`Categoria de erro sugerida, ainda não confirmada: ${feedback.suggestedErrorType}`);
                  }
                }
                if (completion) lines.push(`Prática concluída em ${completion.confirmedAt}. Registro: ${completion.notes || completion.mode}.`);
              }
              const materials = state.materials.filter(item => lesson.materialIds.includes(item.id));
              if (materials.length) {
                lines.push('\n## Materiais vinculados');
                for (const material of materials) lines.push(`- ${material.title}${material.url ? ` — ${material.url}` : ''}${material.content ? `\n  ${material.content}` : ''}`);
              }
            }
            if (state.externalLogs.length) {
              lines.push('\n## Práticas avulsas fora do app');
              for (const log of state.externalLogs.slice(-10)) lines.push(`- ${log.loggedAt}: ${log.modality}; ${log.minutes ?? 'tempo não informado'} min${log.chunkApplied ? `; expressão: ${log.chunkApplied}` : ''}`);
            }
            lines.push('\n## Como continuar\nContinue da etapa atual indicada. Conduza uma etapa por vez em um cenário com objetivo e destinatário claros. Peça minha produção antes da solução; corrija no máximo três pontos. Dê uma pista concreta para autocorreção e, se eu não entender, se o erro for estrutural ou se eu pedir, explique a regra diretamente e registre uma explicação curta em ruleExplanation. Mostre uma forma natural e peça reutilização em outro contexto. Aguarde minha tentativa e confirmação antes de considerar a prática concluída. Listening e speaking acontecem fora do app; não infira que foram feitos por uma resposta escrita.');
            clipboard.writeText(lines.join('\n'));
            return { message: 'Contexto para o tutor copiado.' };
          }
          case 'getInfo': {
            const exchangeDir = join(app.getPath('documents'), 'Caderno Ingles');
            const mcpConfig = JSON.stringify({ mcpServers: { 'caderno-ingles': { command: process.execPath, args: ['--mcp'] } } }, null, 2);
            return { dataDir: storeDir, exchangeDir, executable: process.execPath, version: app.getVersion(), mcpConfig };
          }
          default: throw new Error('Ação indisponível.');
        }
      });
      const window = new BrowserWindow({ width: 1420, height: 900, minWidth: 360, minHeight: 560, show: false, title: 'Caderno · Inglês', backgroundColor: '#f7f5ee', webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
      window.once('ready-to-show', () => window.show());
      window.webContents.once('did-finish-load', () => updater.start());
      window.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url); return { action: 'deny' }; });
      if (process.env.VITE_DEV_SERVER_URL) void window.loadURL(process.env.VITE_DEV_SERVER_URL);
      else void window.loadFile(join(__dirname, '../dist/index.html'));
      app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) { const next = new BrowserWindow({ webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } }); void next.loadFile(join(__dirname, '../dist/index.html')); } });
    }).catch(error => { console.error(error); app.exit(1); });
    app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  }
}
