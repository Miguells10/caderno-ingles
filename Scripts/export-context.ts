import { StudyStore } from '../core/store.js';
import { exportMarkdown } from '../electron/exchange.js';

const dataDir = process.env.CADERNO_DATA_DIR;
const exchangeDir = process.env.CADERNO_EXCHANGE_DIR;
if (!dataDir || !exchangeDir) throw new Error('Defina CADERNO_DATA_DIR e CADERNO_EXCHANGE_DIR.');

const store = new StudyStore(dataDir);
try {
  const path = await exportMarkdown(store.getState(), exchangeDir);
  process.stdout.write(`${path}\n`);
} finally {
  store.close();
}
