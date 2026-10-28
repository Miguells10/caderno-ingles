import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { Command, ErrorType, ExternalModality } from '../shared/types.js';
import { getDueCards, getStudyMetrics, localDate } from '../core/metrics.js';
import { StudyStore } from '../core/store.js';

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function register(server: McpServer, name: string, description: string, inputSchema: Record<string, z.ZodTypeAny>, run: (args: Record<string, unknown>) => unknown) {
  server.registerTool(name, { title: name.replaceAll('_', ' '), description, inputSchema }, async args => {
    try { return result(await run(args as Record<string, unknown>)); }
    catch (error) { return { ...result({ error: error instanceof Error ? error.message : String(error) }), isError: true }; }
  });
}

/** Start the local stdio MCP server. Electron's --mcp mode calls server.connect(transport). */
export async function startMcpServer(store: StudyStore): Promise<{ server: McpServer; transport: StdioServerTransport }> {
  const server = new McpServer({ name: 'caderno-ingles', version: '1.1.1' });
  const transport = new StdioServerTransport();
  const requestId = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : randomUUID();

  register(server, 'read_study_context', 'Leia a meta, o progresso real, as aulas, atividades e cartões devidos de Miguel. Práticas orais externas não são presumidas como feitas.', {}, () => {
    const state = store.getState();
    return {
      settings: state.settings,
      metrics: getStudyMetrics(state),
      dueCards: getDueCards(state).slice(0, 20),
      lessons: state.lessons.filter(item => !item.archived).sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)).slice(-30),
      activities: state.activities.slice(-60),
      attempts: state.attempts.slice(-40),
      feedback: state.feedback.slice(-40),
      completions: state.completions.slice(-40),
      materials: state.materials,
      cards: state.cards.filter(item => !item.archived),
      externalLogs: state.externalLogs.slice(-40),
      feedbackErrorTypes: state.feedbackErrorTypes,
    };
  });

  register(server, 'create_lesson', 'Crie uma aula local com atividades, incluindo tarefas externas de listening ou speaking.', {
    title: z.string().min(1).max(500), objective: z.string().max(200_000).default(''),
    scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(localDate()),
    minutes: z.number().int().min(1).max(480).optional(), tags: z.array(z.string().max(100)).max(100).default([]),
    activities: z.array(z.object({ title: z.string().min(1).max(500), prompt: z.string().min(1).max(200_000), criteria: z.string().max(200_000).default(''), kind: z.enum(['writing', 'reflection', 'external']), skill: z.enum(['writing', 'reading', 'listening', 'speaking']), order: z.number().int().min(0).optional() })).max(50).default([]),
    requestId: z.string().max(200).optional(),
  }, args => {
    const { title, objective, scheduledDate, minutes, tags, activities, requestId: req } = args as { title: string; objective: string; scheduledDate: string; minutes?: number; tags: string[]; activities: Array<{title:string;prompt:string;criteria:string;kind:'writing'|'reflection'|'external';skill:'writing'|'reading'|'listening'|'speaking';order?:number}>; requestId?: string };
    const command: Command = { type: 'saveLesson', lesson: { title, objective, scheduledDate, minutes: minutes ?? store.getState().settings.dailyMinutes, tags, materialIds: [], archived: false }, activities: activities.map((activity, index) => ({ ...activity, order: activity.order ?? index })), requestId: requestId(req) };
    const state = store.execute(command);
    return state.lessons.at(-1);
  });

  register(server, 'create_material', 'Salve um material de estudo: link, vídeo, PDF anexado pelo usuário ou anotação.', {
    title: z.string().min(1).max(500), type: z.enum(['link', 'video', 'pdf', 'note']), url: z.string().max(8192).default(''), content: z.string().max(200_000).default(''), tags: z.array(z.string().max(100)).max(100).default([]), requestId: z.string().max(200).optional(),
  }, args => {
    const { requestId: req, ...material } = args as {title:string;type:'link'|'video'|'pdf'|'note';url:string;content:string;tags:string[];requestId?:string};
    const state = store.execute({ type: 'saveMaterial', material: { ...material, attachmentId: '', attachmentName: '' }, requestId: requestId(req) });
    return state.materials.at(-1);
  });

  register(server, 'create_flashcard', 'Crie um cartão de recuperação ativa, ligado opcionalmente a uma atividade existente.', {
    front: z.string().min(1).max(200_000), back: z.string().min(1).max(200_000), tags: z.array(z.string().max(100)).max(100).default([]), sourceActivityId: z.string().max(128).default(''), sourceText: z.string().max(200_000).default(''), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(localDate()), targetChunk: z.string().max(500).optional(), requestId: z.string().max(200).optional(),
  }, args => {
    const { requestId: req, ...card } = args as {front:string;back:string;tags:string[];sourceActivityId:string;sourceText:string;dueDate:string;targetChunk?:string;requestId?:string};
    const state = store.execute({ type: 'saveCard', card: { ...card, intervalIndex: 0, archived: false }, requestId: requestId(req) });
    return state.cards.at(-1);
  });

  register(server, 'record_attempt', 'Registre a produção inicial, uma tentativa de correção ou reutilização textual.', {
    activityId: z.string().min(1).max(128), text: z.string().min(1).max(200_000), stage: z.enum(['initial', 'retry', 'reuse']), requestId: z.string().max(200).optional(),
  }, args => {
    const { requestId: req, ...attempt } = args as {activityId:string;text:string;stage:'initial'|'retry'|'reuse';requestId?:string};
    return store.execute({ type: 'submitAttempt', ...attempt, source: 'chat', requestId: requestId(req) }).attempts.at(-1);
  });

  register(server, 'add_tutor_feedback', 'Acrescente uma pista ou correção como registro imutável. Use correctedText, reusePrompt e result quando houver correção.', {
    attemptId: z.string().min(1).max(128), kind: z.enum(['hint', 'correction']), text: z.string().min(1).max(200_000), correctedText: z.string().max(200_000).default(''), reusePrompt: z.string().max(200_000).default(''), result: z.enum(['correct', 'needs_work', 'ungraded']).default('ungraded'), targetChunk: z.string().max(500).optional(), contextSeeds: z.array(z.string().min(1).max(500)).max(2).optional(), suggestedErrorType: z.enum(['l1_transfer', 'collocation', 'preposition', 'verb_form', 'other']).nullable().optional(), requestId: z.string().max(200).optional(),
  }, args => {
    const { requestId: req, ...feedback } = args as {attemptId:string;kind:'hint'|'correction';text:string;correctedText:string;reusePrompt:string;result:'correct'|'needs_work'|'ungraded';targetChunk?:string;contextSeeds?:string[];suggestedErrorType?:ErrorType|null;requestId?:string};
    return store.execute({ type: 'addFeedback', feedback, requestId: requestId(req) }).feedback.at(-1);
  });

  register(server, 'confirm_activity', 'Registre conclusão confirmada pelo aluno. Escrita precisa de resposta inicial e reutilização; atividades externas precisam de notas e nunca inferem fala a partir de texto.', {
    activityId: z.string().min(1).max(128), mode: z.enum(['full', 'minimum', 'external']), minutes: z.number().int().min(1).max(1440).nullable().optional(), notes: z.string().max(200_000).default(''), requestId: z.string().max(200).optional(),
  }, args => {
    const { requestId: req, ...completion } = args as {activityId:string;mode:'full'|'minimum'|'external';minutes?:number|null;notes:string;requestId?:string};
    return store.execute({ type: 'completeActivity', ...completion, requestId: requestId(req) }).completions.at(-1);
  });

  register(server, 'record_flashcard_review', 'Registre uma autoavaliação de cartão. usedHint separa lembrança com ajuda e independente.', {
    cardId: z.string().min(1).max(128), answer: z.string().min(1).max(200_000), rating: z.enum(['again', 'hard', 'good']), usedHint: z.boolean(), requestId: z.string().max(200).optional(),
  }, args => {
    const { requestId: req, ...review } = args as {cardId:string;answer:string;rating:'again'|'hard'|'good';usedHint:boolean;requestId?:string};
    return store.execute({ type: 'recordReview', ...review, requestId: requestId(req) }).reviews.at(-1);
  });

  register(server, 'record_external_practice', 'Registre uma prática avulsa de conversa, monólogo ou escuta sem avaliar pronúncia ou concluir aulas.', {
    modality: z.enum(['speaking_dialogue', 'speaking_monologue', 'listening']),
    minutes: z.number().int().min(1).max(1440).nullable().optional(), chunkApplied: z.string().max(500).optional(), requestId: z.string().max(200).optional(),
  }, args => {
    const { requestId: req, ...log } = args as { modality: ExternalModality; minutes?: number | null; chunkApplied?: string; requestId?: string };
    return store.execute({ type: 'recordExternalPractice', ...log, requestId: requestId(req) }).externalLogs.at(-1);
  });

  register(server, 'set_feedback_error_type', 'Confirme ou altere a categoria de uma correção sem modificar o feedback original.', {
    feedbackId: z.string().min(1).max(128), errorType: z.enum(['l1_transfer', 'collocation', 'preposition', 'verb_form', 'other']).nullable(), requestId: z.string().max(200).optional(),
  }, args => {
    const { feedbackId, errorType, requestId: req } = args as { feedbackId: string; errorType: ErrorType | null; requestId?: string };
    return store.execute({ type: 'setFeedbackErrorType', feedbackId, errorType, requestId: requestId(req) }).feedbackErrorTypes[feedbackId];
  });

  return { server, transport };
}
