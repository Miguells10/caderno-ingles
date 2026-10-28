import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { Activity, Card, Command, Completion, Entity, ExternalLog, Feedback, Lesson, Material, Settings, StudyState } from '../shared/types.js';
import { addLocalDays, localDate } from './metrics.js';

const id = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.:-]+$/, 'Identificador inválido.')
  .refine(value => !['__proto__', 'prototype', 'constructor'].includes(value), 'Identificador reservado.');
const timestamp = z.string().datetime({ offset: true });
const text = z.string().max(200_000);
const requiredText = text.refine(value => value.trim().length > 0, 'Escreva o conteúdo antes de salvar.');
const title = z.string().trim().min(1, 'Informe um título.').max(500);
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}, 'Data de calendário inválida.');
const tags = z.array(z.string().trim().min(1).max(100)).max(100);
const base = { id, revision: z.number().int().min(1), createdAt: timestamp, updatedAt: timestamp };
const skill = z.enum(['writing', 'reading', 'listening', 'speaking']);
const errorType = z.enum(['l1_transfer', 'collocation', 'preposition', 'verb_form', 'other']);
const externalModality = z.enum(['speaking_dialogue', 'speaking_monologue', 'listening']);
const entitySchema = <T extends z.ZodRawShape>(shape: T) => z.object({ ...base, ...shape }).strict()
  .refine(value => Date.parse(String(value.updatedAt ?? '')) >= Date.parse(String(value.createdAt ?? '')), 'A atualização não pode preceder a criação.');
const lessonSchema = entitySchema({
  title, objective: text, scheduledDate: calendarDate, minutes: z.number().int().min(1).max(480),
  tags, materialIds: z.array(id).max(500), archived: z.boolean(),
});
const activitySchema = entitySchema({
  lessonId: id, title, prompt: requiredText, criteria: text,
  kind: z.enum(['writing', 'reflection', 'external']), skill, order: z.number().int().min(0).max(10_000),
});
const attemptSchema = entitySchema({
  activityId: id, text: requiredText, stage: z.enum(['initial', 'retry', 'reuse']), source: z.enum(['app', 'chat', 'import']),
});
const feedbackSchema = entitySchema({
  attemptId: id, kind: z.enum(['hint', 'correction']), text: requiredText,
  correctedText: text, reusePrompt: text, result: z.enum(['correct', 'needs_work', 'ungraded']),
  targetChunk: z.string().max(500).optional(), contextSeeds: z.array(z.string().trim().min(1).max(500)).max(2).optional(),
  suggestedErrorType: errorType.nullable().optional(),
});
const completionSchema = entitySchema({
  activityId: id, mode: z.enum(['full', 'minimum', 'external']), minutes: z.number().int().min(1).max(1_440).nullable(),
  notes: text, confirmedAt: timestamp,
});
const url = z.string().max(8_192).refine(value => {
  if (!value) return true;
  try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
}, 'Use um endereço http ou https válido.');
const attachmentId = z.string().max(128).refine(value => !value || /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value), 'Identificador de anexo inválido.');
const materialSchema = entitySchema({
  title, type: z.enum(['link', 'video', 'pdf', 'note']), url, content: text, tags,
  attachmentName: z.string().max(500), attachmentId,
});
const cardSchema = entitySchema({
  front: requiredText, back: requiredText, tags, sourceActivityId: z.union([id, z.literal('')]),
  sourceText: text, dueDate: calendarDate, intervalIndex: z.number().int().min(0).max(100), archived: z.boolean(),
  targetChunk: z.string().max(500).optional(),
});
const externalLogSchema = entitySchema({
  modality: externalModality, minutes: z.number().int().min(1).max(1_440).nullable(),
  chunkApplied: z.string().max(500), loggedAt: timestamp,
});
const reviewSchema = entitySchema({
  cardId: id, answer: requiredText, rating: z.enum(['again', 'hard', 'good']),
  usedHint: z.boolean(), reviewedAt: timestamp, source: z.literal('self'),
});
const settingsSchema = z.object({
  name: z.string().trim().min(1).max(200), goal: text,
  dailyMinutes: z.number().int().min(1).max(480), dailyCards: z.number().int().min(1).max(200),
  theme: z.enum(['light', 'dark']),
  reviewIntervals: z.array(z.number().int().min(1).max(3_650)).min(1).max(12)
    .refine(value => value.every((days, index) => index === 0 || days > value[index - 1]), 'Os intervalos devem crescer, por exemplo 1, 3, 7.'),
}).strict();
const stateSchema = z.object({
  schemaVersion: z.literal(2), settings: settingsSchema,
  lessons: z.array(lessonSchema).max(20_000), activities: z.array(activitySchema).max(100_000),
  attempts: z.array(attemptSchema).max(500_000), feedback: z.array(feedbackSchema).max(500_000),
  completions: z.array(completionSchema).max(100_000), materials: z.array(materialSchema).max(50_000),
  cards: z.array(cardSchema).max(100_000), reviews: z.array(reviewSchema).max(1_000_000),
  externalLogs: z.array(externalLogSchema).max(100_000), feedbackErrorTypes: z.record(id, errorType.nullable()),
  drafts: z.record(id, text),
}).strict();

const collections = ['lessons', 'activities', 'attempts', 'feedback', 'completions', 'materials', 'cards', 'reviews', 'externalLogs'] as const;
const immutableCollections = ['attempts', 'feedback', 'completions', 'reviews', 'externalLogs'] as const;

export function createEmptyState(): StudyState {
  return {
    schemaVersion: 2,
    settings: { name: 'Miguel', goal: 'Usar inglês com confiança no trabalho e no cotidiano.', dailyMinutes: 10, dailyCards: 5, theme: 'light', reviewIntervals: [1, 3, 7] },
    lessons: [], activities: [], attempts: [], feedback: [], completions: [], materials: [], cards: [], reviews: [], externalLogs: [], feedbackErrorTypes: {}, drafts: {},
  };
}

function completionGate(state: StudyState, completion: Pick<Completion, 'activityId' | 'mode' | 'notes'>): void {
  const activity = state.activities.find(item => item.id === completion.activityId);
  if (!activity) throw new Error('A atividade não existe.');
  if (completion.mode === 'external') {
    if (activity.kind !== 'external') throw new Error('A conclusão externa é exclusiva de uma prática externa.');
    if (!completion.notes.trim()) throw new Error('Descreva o que realizou na prática externa.');
    return;
  }
  if (activity.kind === 'external') throw new Error('Registre esta prática como externa, com suas anotações.');
  const attempts = state.attempts.filter(attempt => attempt.activityId === activity.id);
  if (!attempts.some(attempt => attempt.stage === 'initial') || !attempts.some(attempt => attempt.stage === 'reuse')) {
    throw new Error('Para concluir, envie sua resposta inicial e uma tentativa de reutilização.');
  }
  if (completion.mode === 'full' && !state.feedback.some(feedback => attempts.some(attempt => attempt.id === feedback.attemptId))) {
    throw new Error('A conclusão completa também precisa de feedback do tutor. Você pode concluir a prática mínima.');
  }
}

/** Validates shapes and relationships for both disk reads and imported backups. */
export function validateState(data: unknown): StudyState {
  const migrated = data && typeof data === 'object' && !Array.isArray(data) && 'schemaVersion' in data && data.schemaVersion === 1
    ? { ...data, schemaVersion: 2, externalLogs: [], feedbackErrorTypes: {} }
    : data;
  const parsed = stateSchema.safeParse(migrated);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Dados inválidos em ${issue.path.join('.') || 'estado'}: ${issue.message}`);
  }
  const state: StudyState = parsed.data;
  const allIds = new Set<string>();
  for (const name of collections) for (const item of state[name]) {
    if (allIds.has(item.id)) throw new Error(`Identificador duplicado: ${item.id}.`);
    allIds.add(item.id);
  }
  const lessonIds = new Set(state.lessons.map(item => item.id));
  const activityIds = new Set(state.activities.map(item => item.id));
  const materialIds = new Set(state.materials.map(item => item.id));
  const attemptIds = new Set(state.attempts.map(item => item.id));
  const cardIds = new Set(state.cards.map(item => item.id));
  for (const lesson of state.lessons) {
    if (new Set(lesson.materialIds).size !== lesson.materialIds.length) throw new Error('Material repetido na mesma aula.');
    for (const materialId of lesson.materialIds) if (!materialIds.has(materialId)) throw new Error('A aula referencia um material inexistente.');
  }
  for (const activity of state.activities) if (!lessonIds.has(activity.lessonId)) throw new Error('A atividade referencia uma aula inexistente.');
  const initialActivities = new Set(state.attempts.filter(attempt => attempt.stage === 'initial').map(attempt => attempt.activityId));
  for (const attempt of state.attempts) {
    if (!activityIds.has(attempt.activityId)) throw new Error('A resposta referencia uma atividade inexistente.');
    if (state.activities.find(activity => activity.id === attempt.activityId)?.kind === 'external') throw new Error('Uma prática externa usa anotações, não respostas avaliadas.');
    if (attempt.stage !== 'initial' && !initialActivities.has(attempt.activityId)) throw new Error('Uma nova tentativa precisa da resposta inicial.');
  }
  for (const feedback of state.feedback) {
    if (!attemptIds.has(feedback.attemptId)) throw new Error('O feedback referencia uma resposta inexistente.');
    if (feedback.kind === 'hint' && feedback.result !== 'ungraded') throw new Error('Uma pista ainda não é uma avaliação.');
    if (feedback.kind === 'hint' && feedback.suggestedErrorType) throw new Error('Uma pista não classifica erros.');
  }
  for (const feedbackId of Object.keys(state.feedbackErrorTypes)) {
    if (!state.feedback.some(item => item.id === feedbackId && item.kind === 'correction')) throw new Error('A categoria referencia uma correção inexistente.');
  }
  for (const card of state.cards) if (card.sourceActivityId && !activityIds.has(card.sourceActivityId)) throw new Error('O cartão referencia uma atividade inexistente.');
  for (const review of state.reviews) if (!cardIds.has(review.cardId)) throw new Error('A revisão referencia um cartão inexistente.');
  for (const draftId of Object.keys(state.drafts)) if (!activityIds.has(draftId)) throw new Error('O rascunho referencia uma atividade inexistente.');
  const completedIds = new Set<string>();
  for (const completion of state.completions) {
    if (completedIds.has(completion.activityId)) throw new Error('Uma atividade possui mais de uma confirmação.');
    completedIds.add(completion.activityId);
    completionGate(state, completion);
  }
  for (const name of immutableCollections) for (const item of state[name]) {
    if (item.revision !== 1 || item.updatedAt !== item.createdAt) throw new Error('Respostas, feedbacks, conclusões e revisões são registros imutáveis.');
  }
  return state;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).filter(key => object[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function metadata(current: Entity | undefined, input: Partial<Entity>, now: string): Entity {
  if (current) {
    if (input.revision !== current.revision) throw new Error('Este item foi atualizado em outra janela. Recarregue antes de salvar.');
    return { id: current.id, revision: current.revision + 1, createdAt: current.createdAt, updatedAt: now };
  }
  if (input.revision !== undefined && input.revision !== 1) throw new Error('Um novo item deve começar na revisão 1.');
  return { id: input.id ?? randomUUID(), revision: 1, createdAt: now, updatedAt: now };
}

function put<T extends Entity>(items: T[], item: T): void {
  const index = items.findIndex(current => current.id === item.id);
  if (index < 0) items.push(item);
  else items[index] = item;
}

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Comando inválido.');
}

function assertKeys(value: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Campo desconhecido no comando: ${key}.`);
}

const allowedEntityKeys: Record<'saveLesson' | 'saveMaterial' | 'saveCard' | 'addFeedback', string[]> = {
  saveLesson: [...Object.keys(base), 'title', 'objective', 'scheduledDate', 'minutes', 'tags', 'materialIds', 'archived'],
  saveMaterial: [...Object.keys(base), 'title', 'type', 'url', 'content', 'tags', 'attachmentName', 'attachmentId'],
  saveCard: [...Object.keys(base), 'front', 'back', 'tags', 'sourceActivityId', 'sourceText', 'dueDate', 'intervalIndex', 'archived', 'targetChunk'],
  addFeedback: [...Object.keys(base), 'attemptId', 'kind', 'text', 'correctedText', 'reusePrompt', 'result', 'targetChunk', 'contextSeeds', 'suggestedErrorType'],
};

function applyCommand(state: StudyState, command: Command, now: string): void {
  assertRecord(command);
  const requestIdKeys = ['type', 'requestId'];
  switch (command.type) {
    case 'saveLesson': {
      assertKeys(command, [...requestIdKeys, 'lesson', 'activities']);
      assertRecord(command.lesson);
      assertKeys(command.lesson, allowedEntityKeys.saveLesson);
      const previous = state.lessons.find(item => item.id === command.lesson.id);
      const lesson: Lesson = {
        scheduledDate: localDate(now), minutes: state.settings.dailyMinutes,
        tags: [], materialIds: [], archived: false, ...previous, ...command.lesson, ...metadata(previous, command.lesson, now),
      };
      put(state.lessons, lesson);
      if (command.activities !== undefined && !Array.isArray(command.activities)) throw new Error('A lista de atividades é inválida.');
      const incomingIds = new Set<string>();
      for (const [index, input] of (command.activities ?? []).entries()) {
        assertRecord(input);
        assertKeys(input, [...Object.keys(base), 'lessonId', 'title', 'prompt', 'criteria', 'kind', 'skill', 'order']);
        if (input.id && incomingIds.has(input.id)) throw new Error('Atividade repetida no mesmo comando.');
        if (input.id) incomingIds.add(input.id);
        const oldActivity = state.activities.find(item => item.id === input.id);
        if (input.lessonId && input.lessonId !== lesson.id) throw new Error('A atividade pertence a outra aula.');
        if (oldActivity && oldActivity.lessonId !== lesson.id) throw new Error('Não é possível transferir uma atividade de aula.');
        const activity: Activity = {
          criteria: '', order: index, ...oldActivity, ...input,
          ...metadata(oldActivity, input, now), lessonId: lesson.id,
        };
        put(state.activities, activity);
      }
      break;
    }
    case 'saveMaterial': {
      assertKeys(command, [...requestIdKeys, 'material']);
      assertRecord(command.material);
      assertKeys(command.material, allowedEntityKeys.saveMaterial);
      const previous = state.materials.find(item => item.id === command.material.id);
      const material: Material = {
        url: '', content: '', tags: [], attachmentName: '', attachmentId: '',
        ...previous, ...command.material, ...metadata(previous, command.material, now),
      };
      put(state.materials, material);
      break;
    }
    case 'saveCard': {
      assertKeys(command, [...requestIdKeys, 'card']);
      assertRecord(command.card);
      assertKeys(command.card, allowedEntityKeys.saveCard);
      const previous = state.cards.find(item => item.id === command.card.id);
      const card: Card = {
        tags: [], sourceActivityId: '', sourceText: '', dueDate: localDate(now), intervalIndex: 0, archived: false,
        ...previous, ...command.card, ...metadata(previous, command.card, now),
      };
      put(state.cards, card);
      break;
    }
    case 'saveDraft': {
      assertKeys(command, ['type', 'activityId', 'text']);
      if (!state.activities.some(item => item.id === command.activityId)) throw new Error('A atividade não existe.');
      if (!text.safeParse(command.text).success) throw new Error('Rascunho inválido.');
      state.drafts[command.activityId] = command.text;
      break;
    }
    case 'submitAttempt': {
      assertKeys(command, [...requestIdKeys, 'activityId', 'text', 'stage', 'source']);
      const activity = state.activities.find(item => item.id === command.activityId);
      if (!activity) throw new Error('A atividade não existe.');
      if (activity.kind === 'external') throw new Error('Registre a prática externa pelas anotações de conclusão.');
      if (command.stage !== 'initial' && !state.attempts.some(item => item.activityId === command.activityId && item.stage === 'initial')) {
        throw new Error('Envie primeiro sua resposta inicial.');
      }
      state.attempts.push({ ...metadata(undefined, {}, now), activityId: command.activityId, text: command.text, stage: command.stage, source: command.source ?? 'app' });
      delete state.drafts[command.activityId];
      break;
    }
    case 'addFeedback': {
      assertKeys(command, [...requestIdKeys, 'feedback']);
      assertRecord(command.feedback);
      assertKeys(command.feedback, allowedEntityKeys.addFeedback);
      if (state.feedback.some(item => item.id === command.feedback.id)) throw new Error('Um feedback registrado não pode ser sobrescrito. Adicione outro feedback.');
      if (command.feedback.kind === 'hint' && (
        Boolean(command.feedback.targetChunk?.trim()) ||
        Boolean(command.feedback.contextSeeds?.length) ||
        Boolean(command.feedback.suggestedErrorType)
      )) throw new Error('Expressões alvo, situações e categorias só podem acompanhar uma correção.');
      const feedback: Feedback = {
        correctedText: '', reusePrompt: '', result: 'ungraded', ...command.feedback, ...metadata(undefined, command.feedback, now),
      };
      state.feedback.push(feedback);
      break;
    }
    case 'completeActivity': {
      assertKeys(command, [...requestIdKeys, 'activityId', 'mode', 'minutes', 'notes']);
      if (state.completions.some(item => item.activityId === command.activityId)) throw new Error('Esta atividade já foi confirmada como concluída.');
      const completion: Completion = {
        ...metadata(undefined, {}, now), activityId: command.activityId, mode: command.mode,
        minutes: command.minutes ?? null, notes: command.notes ?? '', confirmedAt: now,
      };
      completionGate(state, completion);
      state.completions.push(completion);
      break;
    }
    case 'recordReview': {
      assertKeys(command, [...requestIdKeys, 'cardId', 'answer', 'rating', 'usedHint']);
      const card = state.cards.find(item => item.id === command.cardId);
      if (!card || card.archived) throw new Error('Este cartão não está disponível para revisão.');
      state.reviews.push({
        ...metadata(undefined, {}, now), cardId: card.id, answer: command.answer, rating: command.rating,
        usedHint: command.usedHint, reviewedAt: now, source: 'self',
      });
      const intervals = state.settings.reviewIntervals;
      const index = Math.min(card.intervalIndex, intervals.length - 1);
      // Hint use cannot advance the interval as if retrieval had been independent.
      const nextIndex = command.rating === 'again' || command.usedHint ? 0 : index;
      const days = command.rating === 'again' || command.usedHint ? intervals[0] : intervals[nextIndex];
      card.dueDate = addLocalDays(localDate(now), days);
      card.intervalIndex = command.rating === 'good' && !command.usedHint ? Math.min(nextIndex + 1, intervals.length - 1) : nextIndex;
      card.revision += 1;
      card.updatedAt = now;
      break;
    }
    case 'recordExternalPractice': {
      assertKeys(command, [...requestIdKeys, 'modality', 'minutes', 'chunkApplied']);
      const log: ExternalLog = {
        ...metadata(undefined, {}, now), modality: command.modality,
        minutes: command.minutes ?? null, chunkApplied: command.chunkApplied?.trim() ?? '', loggedAt: now,
      };
      state.externalLogs.push(log);
      break;
    }
    case 'setFeedbackErrorType': {
      assertKeys(command, [...requestIdKeys, 'feedbackId', 'errorType']);
      if (!state.feedback.some(item => item.id === command.feedbackId && item.kind === 'correction')) throw new Error('Selecione uma correção existente.');
      state.feedbackErrorTypes[command.feedbackId] = command.errorType;
      break;
    }
    case 'saveSettings': {
      assertKeys(command, ['type', 'settings']);
      assertRecord(command.settings);
      assertKeys(command.settings, Object.keys(settingsSchema.shape));
      state.settings = { ...state.settings, ...command.settings } as Settings;
      break;
    }
    default: throw new Error('Comando não reconhecido.');
  }
}

/** One writer transaction across Electron and the independent MCP process. */
export class StudyStore {
  private readonly db: DatabaseSync;
  private closed = false;

  constructor(dataDir: string, seed?: StudyState) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, 'caderno.sqlite'));
    this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS journal (sequence INTEGER PRIMARY KEY AUTOINCREMENT, operation TEXT NOT NULL, payload TEXT NOT NULL, recorded_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS immutable_records (id TEXT PRIMARY KEY, collection TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS journal_no_update BEFORE UPDATE ON journal BEGIN SELECT RAISE(ABORT, 'immutable journal'); END;
      CREATE TRIGGER IF NOT EXISTS journal_no_delete BEFORE DELETE ON journal BEGIN SELECT RAISE(ABORT, 'immutable journal'); END;
      CREATE TRIGGER IF NOT EXISTS records_no_update BEFORE UPDATE ON immutable_records BEGIN SELECT RAISE(ABORT, 'immutable record'); END;
      CREATE TRIGGER IF NOT EXISTS records_no_delete BEFORE DELETE ON immutable_records BEGIN SELECT RAISE(ABORT, 'immutable record'); END;
      PRAGMA user_version = 2;
    `);
    try {
      this.transaction(() => {
        if (!this.db.prepare('SELECT id FROM state WHERE id = 1').get()) {
          const initial = validateState(seed ?? createEmptyState());
          this.checkImmutable(initial);
          this.db.prepare('INSERT INTO state (id, revision, payload) VALUES (1, 1, ?)').run(JSON.stringify(initial));
          this.db.prepare('INSERT INTO journal (operation, payload, recorded_at) VALUES (?, ?, ?)').run('initialize', JSON.stringify(initial), new Date().toISOString());
        } else {
          const row = this.db.prepare('SELECT payload FROM state WHERE id = 1').get() as { payload: string };
          const state = this.read();
          if ((JSON.parse(row.payload) as { schemaVersion?: number }).schemaVersion === 1) {
            this.checkImmutable(state);
            this.write(state, 'migrate-v2', { from: 1, to: 2 }, new Date().toISOString());
          }
        }
      });
    } catch (error) {
      this.db.close();
      this.closed = true;
      throw error;
    }
  }

  getState(): StudyState {
    this.assertOpen();
    return this.read();
  }

  execute(command: Command): StudyState {
    this.assertOpen();
    return this.transaction(() => {
      assertRecord(command);
      const state = this.read();
      const requestId = 'requestId' in command ? command.requestId : undefined;
      if (requestId !== undefined && !z.string().min(1).max(200).safeParse(requestId).success) throw new Error('Identificador da operação inválido.');
      const { requestId: ignored, ...content } = command as Command & { requestId?: string };
      void ignored;
      const hash = fingerprint(content);
      if (requestId) {
        const previous = this.db.prepare('SELECT fingerprint FROM requests WHERE request_id = ?').get(requestId) as { fingerprint: string } | undefined;
        if (previous) {
          if (previous.fingerprint !== hash) throw new Error('Este identificador de operação já foi usado com outro conteúdo.');
          return state;
        }
      }
      const now = new Date().toISOString();
      applyCommand(state, command, now);
      const validated = validateState(state);
      this.checkImmutable(validated);
      this.write(validated, command.type, command, now);
      if (requestId) this.db.prepare('INSERT INTO requests (request_id, fingerprint) VALUES (?, ?)').run(requestId, hash);
      return validated;
    });
  }

  restore(data: unknown): StudyState {
    this.assertOpen();
    const validated = validateState(data);
    return this.transaction(() => {
      this.checkImmutable(validated);
      this.write(validated, 'restore', validated, new Date().toISOString());
      return validated;
    });
  }

  close(): void {
    if (!this.closed) { this.db.close(); this.closed = true; }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('O banco de dados já foi fechado.');
  }

  private read(): StudyState {
    const row = this.db.prepare('SELECT payload FROM state WHERE id = 1').get() as { payload: string } | undefined;
    if (!row) throw new Error('O estado de estudo não foi inicializado.');
    try { return validateState(JSON.parse(row.payload)); }
    catch (error) { throw new Error(`Não foi possível ler seus dados. Preserve o banco e restaure um backup válido. ${error instanceof Error ? error.message : ''}`); }
  }

  private checkImmutable(state: StudyState): void {
    const find = this.db.prepare('SELECT collection, payload FROM immutable_records WHERE id = ?');
    const insert = this.db.prepare('INSERT INTO immutable_records (id, collection, payload) VALUES (?, ?, ?)');
    for (const collection of immutableCollections) for (const item of state[collection]) {
      const payload = canonical(item);
      const previous = find.get(item.id) as { collection: string; payload: string } | undefined;
      if (previous && (previous.collection !== collection || previous.payload !== payload)) throw new Error('O arquivo tenta sobrescrever um registro de histórico imutável.');
      if (!previous) insert.run(item.id, collection, payload);
    }
  }

  private write(state: StudyState, operation: string, payload: unknown, now: string): void {
    this.db.prepare('UPDATE state SET revision = revision + 1, payload = ? WHERE id = 1').run(JSON.stringify(state));
    this.db.prepare('INSERT INTO journal (operation, payload, recorded_at) VALUES (?, ?, ?)').run(operation, JSON.stringify(payload), now);
  }

  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
