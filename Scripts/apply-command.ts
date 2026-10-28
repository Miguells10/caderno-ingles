import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from '../shared/types.js';
import { StudyStore } from '../core/store.js';
import { exportMarkdown } from '../electron/exchange.js';

const dataDir = process.env.CADERNO_DATA_DIR;
const exchangeDir = process.env.CADERNO_EXCHANGE_DIR;
const inputPath = process.argv[2];
if (!dataDir || !exchangeDir || !inputPath) throw new Error('Informe o banco, a pasta de intercâmbio e o comando JSON.');
if (!existsSync(join(dataDir, 'caderno.sqlite'))) throw new Error('Banco do Caderno não encontrado. Nenhum dado foi alterado.');
const command = JSON.parse(await readFile(inputPath, 'utf8')) as Command;
if (!('requestId' in command) || !command.requestId) throw new Error('O comando precisa de requestId para evitar duplicação.');

const store = new StudyStore(dataDir);
try {
  const state = store.execute(command);
  const path = await exportMarkdown(state, exchangeDir);
  process.stdout.write(JSON.stringify({ ok: true, command: command.type, attempts: state.attempts.length, feedback: state.feedback.length, completions: state.completions.length, markdown: path }) + '\n');
} finally {
  store.close();
}
