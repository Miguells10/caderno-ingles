import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { StudyState } from '../shared/types.js';
import { StudyStore, validateState } from '../core/store.js';
import { getStudyMetrics } from '../core/metrics.js';

const FILE = 'caderno.md';
const LIMIT = 100 * 1024 * 1024;
const COLLECTIONS = ['lessons', 'activities', 'attempts', 'feedback', 'completions', 'materials', 'cards', 'reviews', 'externalLogs'] as const;
type Collection = typeof COLLECTIONS[number];
export type ExchangeFormat = 'md' | 'json';

function scopedState(state: StudyState, lessonId?: string): StudyState {
  const data = validateState(state);
  if (!lessonId) return data;
  const lesson = data.lessons.find(item => item.id === lessonId);
  if (!lesson) throw new Error('A aula selecionada não foi encontrada.');
  const activities = data.activities.filter(item => item.lessonId === lessonId);
  const activityIds = new Set(activities.map(item => item.id));
  const attempts = data.attempts.filter(item => activityIds.has(item.activityId));
  const attemptIds = new Set(attempts.map(item => item.id));
  const feedback = data.feedback.filter(item => attemptIds.has(item.attemptId));
  const feedbackIds = new Set(feedback.map(item => item.id));
  const cards = data.cards.filter(item => activityIds.has(item.sourceActivityId));
  const cardIds = new Set(cards.map(item => item.id));
  return validateState({
    ...data, lessons: [lesson], activities, attempts, feedback,
    completions: data.completions.filter(item => activityIds.has(item.activityId)),
    materials: data.materials.filter(item => lesson.materialIds.includes(item.id)),
    cards, reviews: data.reviews.filter(item => cardIds.has(item.cardId)), externalLogs: [],
    feedbackErrorTypes: Object.fromEntries(Object.entries(data.feedbackErrorTypes).filter(([id]) => feedbackIds.has(id))),
    drafts: Object.fromEntries(Object.entries(data.drafts).filter(([id]) => activityIds.has(id))),
  });
}

function report(state: StudyState) {
  const metrics = getStudyMetrics(state);
  return {
    note: 'Dados registrados no aplicativo. Datas previstas e minutos sugeridos não provam que houve prática. Avaliações do tutor e autoavaliações de cartões são distintas; não há nota CEFR nem avaliação de pronúncia.',
    learner: { name: state.settings.name, goal: state.settings.goal },
    evidence: {
      completedActivities: metrics.completedActivities, externalPracticeLogs: metrics.externalLogs,
      firstCardReviews: metrics.firstReviews.total, rememberedWithoutHint: metrics.firstReviews.unaidedCorrect,
      gradedAttempts: metrics.gradedAttempts, correctAttempts: metrics.correctAttempts,
      pendingFeedback: metrics.pendingFeedback, knownMinutes: metrics.knownMinutes,
      sessionsWithoutTime: metrics.sessionsWithoutTime,
    },
    lessons: [...state.lessons].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)).map(lesson => {
      const activities = state.activities.filter(item => item.lessonId === lesson.id).sort((a, b) => a.order - b.order);
      return {
        id: lesson.id, title: lesson.title, scheduledDate: lesson.scheduledDate, objective: lesson.objective,
        suggestedMinutes: lesson.minutes, tags: lesson.tags, archived: lesson.archived,
        materials: state.materials.filter(item => lesson.materialIds.includes(item.id)).map(item => ({ id: item.id, title: item.title, type: item.type, url: item.url, content: item.content })),
        activities: activities.map(activity => {
          const attempts = state.attempts.filter(item => item.activityId === activity.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          const attemptIds = new Set(attempts.map(item => item.id));
          const completion = state.completions.find(item => item.activityId === activity.id) ?? null;
          return {
            id: activity.id, title: activity.title, prompt: activity.prompt, criteria: activity.criteria,
            skill: activity.skill, kind: activity.kind, order: activity.order,
            completion: completion && { confirmedAt: completion.confirmedAt, mode: completion.mode, actualMinutes: completion.minutes, notes: completion.notes },
            attempts: attempts.map(item => ({ id: item.id, at: item.createdAt, stage: item.stage, source: item.source, text: item.text })),
            feedback: state.feedback.filter(item => attemptIds.has(item.attemptId)).map(item => ({
              id: item.id, at: item.createdAt, attemptId: item.attemptId, kind: item.kind, text: item.text,
              correctedText: item.correctedText, reusePrompt: item.reusePrompt, result: item.result,
              targetChunk: item.targetChunk ?? '', contextSeeds: item.contextSeeds ?? [], ruleExplanation: item.ruleExplanation ?? '',
              suggestedErrorType: item.suggestedErrorType ?? null, acceptedErrorType: state.feedbackErrorTypes[item.id] ?? null,
            })),
            cards: state.cards.filter(item => item.sourceActivityId === activity.id).map(item => ({
              id: item.id, front: item.front, back: item.back, dueDate: item.dueDate,
              reviews: state.reviews.filter(review => review.cardId === item.id).map(review => ({
                reviewedAt: review.reviewedAt, rating: review.rating, usedHint: review.usedHint,
              })),
            })),
          };
        }),
      };
    }),
    externalPractice: state.externalLogs.map(item => ({ at: item.loggedAt, modality: item.modality, actualMinutes: item.minutes, chunkApplied: item.chunkApplied })),
  };
}

function exchangeEnvelope(state: StudyState, lessonId?: string) {
  const scoped = scopedState(state, lessonId);
  return { format: 'caderno-ingles', version: 2, scope: lessonId ? 'lesson' : 'all', exportedAt: new Date().toISOString(), report: report(scoped), state: scoped };
}

function reportMarkdown(data: ReturnType<typeof report>): string {
  const lines = [
    '# Caderno de inglês — contexto para análise',
    `Aluno: ${data.learner.name}`,
    `Objetivo: ${data.learner.goal}`,
    '', data.note, '',
    '## Evidências registradas',
    `- Atividades confirmadas: ${data.evidence.completedActivities}`,
    `- Práticas avulsas: ${data.evidence.externalPracticeLogs}`,
    `- Primeiras revisões de cartões: ${data.evidence.firstCardReviews}`,
    `- Cartões lembrados sem pista: ${data.evidence.rememberedWithoutHint}`,
    `- Respostas avaliadas pelo tutor: ${data.evidence.gradedAttempts}; corretas: ${data.evidence.correctAttempts}`,
    `- Respostas aguardando retorno: ${data.evidence.pendingFeedback}`,
    `- Tempo informado: ${data.evidence.knownMinutes} min; práticas sem duração: ${data.evidence.sessionsWithoutTime}`,
    '', '## Planejamento e histórico das aulas',
  ];
  for (const lesson of data.lessons) {
    lines.push('', `### ${lesson.scheduledDate} · ${lesson.title}`, `Objetivo: ${lesson.objective}`, `Tempo sugerido: ${lesson.suggestedMinutes} min`, `Estado: ${lesson.archived ? 'arquivada' : 'ativa'}`);
    for (const material of lesson.materials) lines.push(`Material: ${material.title}${material.url ? ` — ${material.url}` : ''}`);
    for (const activity of lesson.activities) {
      lines.push('', `#### ${activity.title} (${activity.skill})`, `Tarefa: ${activity.prompt}`);
      if (activity.criteria) lines.push(`Critérios: ${activity.criteria}`);
      lines.push(activity.completion ? `Confirmada em ${activity.completion.confirmedAt}; tempo real: ${activity.completion.actualMinutes ?? 'não informado'} min; ${activity.completion.notes}` : 'Ainda sem conclusão confirmada.');
      for (const attempt of activity.attempts) lines.push(`Resposta ${attempt.stage} em ${attempt.at}: ${attempt.text}`);
      for (const feedback of activity.feedback) lines.push(`Retorno ${feedback.kind} (${feedback.result}) para ${feedback.attemptId}: ${feedback.text}${feedback.ruleExplanation ? ` | Por quê: ${feedback.ruleExplanation}` : ''}${feedback.correctedText ? ` | Versão corrigida: ${feedback.correctedText}` : ''}${feedback.reusePrompt ? ` | Reutilização proposta: ${feedback.reusePrompt}` : ''}${feedback.targetChunk ? ` | Expressão alvo: ${feedback.targetChunk}` : ''}${feedback.contextSeeds.length ? ` | Situações opcionais: ${feedback.contextSeeds.join('; ')}` : ''}${feedback.acceptedErrorType ? ` | Categoria confirmada: ${feedback.acceptedErrorType}` : ''}`);
      for (const card of activity.cards) lines.push(`Cartão: ${card.front} → ${card.back}; revisões: ${card.reviews.length}${card.reviews.length ? ` (${card.reviews.map(review => `${review.reviewedAt}: ${review.rating}${review.usedHint ? ' com pista' : ' sem pista'}`).join('; ')})` : ''}`);
    }
  }
  if (data.externalPractice.length) {
    lines.push('', '## Práticas avulsas');
    for (const practice of data.externalPractice) lines.push(`- ${practice.at}: ${practice.modality}; ${practice.actualMinutes ?? 'tempo não informado'} min${practice.chunkApplied ? `; expressão: ${practice.chunkApplied}` : ''}`);
  }
  return lines.join('\n');
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
}

function markdown(state: StudyState, lessonId?: string): string {
  const data = validateState(state);
  const envelope = exchangeEnvelope(data, lessonId);
  return `---\nformat: caderno-ingles\nversion: 2\n---\n\n${reportMarkdown(envelope.report)}\n\n## Dados para reimportação\n\nPreserve o bloco caderno-data para manter IDs e histórico. Recomendações da IA devem ficar fora desse bloco até serem revisadas.\n\n<!-- caderno-data:start -->\n\n\`\`\`json\n${JSON.stringify(envelope, null, 2)}\n\`\`\`\n\n<!-- caderno-data:end -->\n`;
}

async function atomicWrite(path: string, contents: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, contents, { encoding: 'utf8', flag: 'wx' });
    try {
      await rename(temp, path);
    } catch (error) {
      const previous = `${path}.${randomUUID()}.previous`;
      if (!(await stat(path).catch(() => null))?.isFile()) throw error;
      await rename(path, previous);
      try {
        await rename(temp, path);
        await rm(previous, { force: true }).catch(() => undefined);
      } catch (replaceError) {
        await rename(previous, path).catch(() => undefined);
        throw replaceError;
      }
    }
    return path;
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function exportMarkdown(state: StudyState, dir: string): Promise<string> {
  return atomicWrite(join(dir, FILE), markdown(state));
}

export async function exportExchange(state: StudyState, path: string, format: ExchangeFormat, lessonId?: string): Promise<string> {
  const contents = format === 'json' ? JSON.stringify(exchangeEnvelope(state, lessonId), null, 2) : markdown(state, lessonId);
  return atomicWrite(path, contents);
}

export async function writeBackup(state: StudyState, path: string): Promise<string> {
  return atomicWrite(path, JSON.stringify({ format: 'caderno-ingles-backup', version: 2, exportedAt: new Date().toISOString(), state: validateState(state) }, null, 2));
}

async function readLimited(path: string): Promise<string> {
  const info = await stat(path);
  if (!info.isFile() || info.size > LIMIT) throw new Error('Arquivo inválido ou maior que 100 MB.');
  return readFile(path, 'utf8');
}

function parseEnvelope(data: unknown, format: string): StudyState {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('O arquivo não contém dados válidos.');
  const envelope = data as Record<string, unknown>;
  if (envelope.format !== format || ![1, 2].includes(Number(envelope.version)) || !('state' in envelope)) throw new Error('Formato ou versão incompatível.');
  return validateState(envelope.state);
}

export async function restoreBackup(path: string): Promise<StudyState> {
  return parseEnvelope(JSON.parse(await readLimited(path)) as unknown, 'caderno-ingles-backup');
}

function parseMarkdown(source: string): StudyState {
  const start = source.indexOf('<!-- caderno-data:start -->');
  const end = source.indexOf('<!-- caderno-data:end -->', start + 1);
  if (start < 0 || end < 0) throw new Error('Não encontrei o bloco de dados do Caderno no arquivo.');
  const block = source.slice(start, end);
  const json = block.match(/```json\s*([\s\S]*?)\s*```/i)?.[1];
  if (!json) throw new Error('O bloco de dados do Caderno está incompleto.');
  return parseEnvelope(JSON.parse(json) as unknown, 'caderno-ingles');
}

function merge(current: StudyState, incoming: StudyState): { state: StudyState; added: number; unchanged: number } {
  const state = structuredClone(current);
  let added = 0;
  let unchanged = 0;
  if (COLLECTIONS.every(collection => current[collection].length === 0) && Object.keys(current.drafts).length === 0) {
    if (stable(current.settings) !== stable(incoming.settings)) added++;
    state.settings = structuredClone(incoming.settings);
  }
  for (const collection of COLLECTIONS) {
    const target = state[collection] as StudyState[Collection];
    const source = incoming[collection] as StudyState[Collection];
    const index = new Map(target.map(item => [item.id, item]));
    for (const item of source) {
      const previous = index.get(item.id);
      if (!previous) { (target as Array<typeof item>).push(structuredClone(item)); index.set(item.id, item); added++; }
      else if (stable(previous) === stable(item)) unchanged++;
      else throw new Error(`Conflito no ID ${item.id}; os dados atuais foram preservados.`);
    }
  }
  for (const [id, text] of Object.entries(incoming.drafts)) {
    if (!(id in state.drafts)) { state.drafts[id] = text; added++; }
    else if (state.drafts[id] === text) unchanged++;
    else throw new Error(`Conflito no rascunho ${id}; os dados atuais foram preservados.`);
  }
  for (const [id, type] of Object.entries(incoming.feedbackErrorTypes)) {
    if (!(id in state.feedbackErrorTypes)) { state.feedbackErrorTypes[id] = type; added++; }
    else if (state.feedbackErrorTypes[id] === type) unchanged++;
    else throw new Error(`Conflito na categoria da correção ${id}; os dados atuais foram preservados.`);
  }
  return { state, added, unchanged };
}

export async function importMarkdown(path: string, store: StudyStore): Promise<{ added: number; unchanged: number }> {
  if (path.toLowerCase().split(/[\\/]/).at(-1) !== FILE) throw new Error(`Selecione o arquivo ${FILE} exportado pelo Caderno.`);
  const source = await readLimited(path);
  if (Buffer.byteLength(source, 'utf8') > LIMIT) throw new Error('Markdown maior que 100 MB.');
  const result = merge(store.getState(), parseMarkdown(source));
  if (result.added) store.restore(result.state);
  return { added: result.added, unchanged: result.unchanged };
}

export async function importExchange(path: string, store: StudyStore): Promise<{ added: number; unchanged: number }> {
  const source = await readLimited(path);
  const incoming = path.toLowerCase().endsWith('.json')
    ? parseEnvelope(JSON.parse(source) as unknown, 'caderno-ingles')
    : path.toLowerCase().endsWith('.md') ? parseMarkdown(source) : null;
  if (!incoming) throw new Error('Selecione um intercâmbio .json ou .md exportado pelo Caderno.');
  const result = merge(store.getState(), incoming);
  if (result.added) store.restore(result.state);
  return { added: result.added, unchanged: result.unchanged };
}
