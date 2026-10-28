import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { addLocalDays, getDueCards, getStudyMetrics, getWarmupCard, localDate } from '../core/metrics.js';
import { exportExchange, exportMarkdown, importExchange, importMarkdown, restoreBackup } from '../electron/exchange.js';
import { createEmptyState, StudyStore, validateState } from '../core/store.js';
import type { Command, StudyState } from '../shared/types.js';

function fixture(t: { after: (fn: () => void) => void }, seed?: StudyState) {
  const directory = mkdtempSync(join(process.cwd(), '.caderno-store-test-'));
  const store = new StudyStore(directory, seed);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { store, directory };
}

function lesson(store: StudyStore, kind: 'writing' | 'reflection' | 'external' = 'writing') {
  return store.execute({
    type: 'saveLesson', lesson: { id: 'lesson-1', title: 'My internship', objective: 'Describe a task at work.' },
    activities: [{ id: 'activity-1', title: 'A work update', prompt: 'What did you work on?', kind, skill: kind === 'external' ? 'speaking' : 'writing' }],
  });
}

function initial(store: StudyStore) {
  return store.execute({ type: 'submitAttempt', activityId: 'activity-1', text: 'I am responsible for create courses.', stage: 'initial' });
}

function reuse(store: StudyStore) {
  return store.execute({ type: 'submitAttempt', activityId: 'activity-1', text: 'I am responsible for updating the documentation.', stage: 'reuse' });
}

test('new database is honestly empty, durable and does not mutate returned state', t => {
  const { store, directory } = fixture(t);
  const empty = store.getState();
  assert.equal(empty.reviews.length, 0);
  assert.equal(empty.attempts.length, 0);
  assert.equal(getStudyMetrics(empty).unaidedAccuracy, null);
  empty.settings.name = 'Changed outside the store';
  assert.equal(store.getState().settings.name, 'Miguel');
  lesson(store);
  store.execute({ type: 'saveDraft', activityId: 'activity-1', text: 'An unfinished sentence…' });
  store.close();
  const reopened = new StudyStore(directory);
  try {
    assert.equal(reopened.getState().lessons[0].title, 'My internship');
    assert.equal(reopened.getState().drafts['activity-1'], 'An unfinished sentence…');
  } finally { reopened.close(); }
});

test('real writing flow preserves original, hint, retry, reuse and confirmation', t => {
  const { store } = fixture(t);
  lesson(store);
  store.execute({ type: 'saveDraft', activityId: 'activity-1', text: 'Draft' });
  let state = initial(store);
  const original = state.attempts[0];
  assert.equal(state.drafts['activity-1'], undefined);
  state = store.execute({ type: 'addFeedback', feedback: { attemptId: original.id, kind: 'hint', text: 'Use the -ing form after for.' } });
  assert.equal(state.feedback[0].result, 'ungraded');
  store.execute({ type: 'submitAttempt', activityId: 'activity-1', text: 'I am responsible for creating courses.', stage: 'retry' });
  state = reuse(store);
  state = store.execute({ type: 'addFeedback', feedback: { attemptId: state.attempts[2].id, kind: 'correction', text: 'You reused the structure correctly.', result: 'correct' } });
  state = store.execute({ type: 'completeActivity', activityId: 'activity-1', mode: 'full', notes: 'Confirmed in the app.' });
  assert.equal(state.completions.length, 1);
  assert.equal(state.completions[0].minutes, null);
  assert.deepEqual(state.attempts[0], original);
  assert.equal(state.attempts.length, 3);
  const metrics = getStudyMetrics(state);
  assert.equal(metrics.completedActivities, 1);
  assert.equal(metrics.sessionsWithoutTime, 1);
  assert.equal(metrics.gradedAttempts, 1);
  assert.equal(metrics.pendingFeedback, 2);
  assert.equal(metrics.ungradedAttempts, 2);
  assert.equal(metrics.attemptAccuracy, 1);
});

test('completion gates distinguish minimum, full and external evidence', t => {
  const { store } = fixture(t);
  lesson(store);
  const complete = (mode: 'full' | 'minimum' | 'external') => store.execute({ type: 'completeActivity', activityId: 'activity-1', mode });
  assert.throws(() => complete('minimum'), /resposta inicial/);
  assert.throws(() => store.execute({ type: 'submitAttempt', activityId: 'activity-1', text: 'New context.', stage: 'reuse' }), /primeiro/);
  initial(store);
  assert.throws(() => complete('minimum'), /reutilização/);
  reuse(store);
  assert.throws(() => complete('full'), /feedback/);
  assert.throws(() => complete('external'), /exclusiva/);
  const completed = complete('minimum');
  assert.equal(completed.completions[0].mode, 'minimum');
  assert.equal(completed.feedback.length, 0);
  assert.throws(() => complete('minimum'), /já foi confirmada/);
});

test('external completion needs notes and produces no speaking evaluation', t => {
  const { store } = fixture(t);
  lesson(store, 'external');
  assert.throws(() => initial(store), /prática externa/);
  assert.throws(() => store.execute({ type: 'completeActivity', activityId: 'activity-1', mode: 'full' }), /externa/);
  assert.throws(() => store.execute({ type: 'completeActivity', activityId: 'activity-1', mode: 'external' }), /Descreva/);
  const state = store.execute({ type: 'completeActivity', activityId: 'activity-1', mode: 'external', notes: 'Recorded a 40-second introduction on my phone.', minutes: 5 });
  assert.equal(state.feedback.length, 0);
  assert.equal(getStudyMetrics(state).attemptAccuracy, null);
  assert.equal(getStudyMetrics(state).externalCompletions, 1);
});

test('request IDs make retries idempotent and reject a different payload', t => {
  const { store } = fixture(t);
  lesson(store);
  const command: Command = { type: 'submitAttempt', activityId: 'activity-1', text: 'I work at SEFAZ.', stage: 'initial', requestId: 'request-1' };
  const first = store.execute(command);
  const second = store.execute(command);
  assert.deepEqual(second.attempts, first.attempts);
  assert.throws(() => store.execute({ ...command, text: 'A different response.' }), /outro conteúdo/);
  assert.equal(store.getState().attempts.length, 1);
});

test('MCP and app connections reread current state and reject stale edits', t => {
  const { store, directory } = fixture(t);
  const second = new StudyStore(directory);
  try {
    const state = lesson(store);
    const before = state.lessons[0];
    second.execute({ type: 'saveLesson', lesson: { ...before, title: 'Edited by tutor' } });
    assert.throws(() => store.execute({ type: 'saveLesson', lesson: { ...before, title: 'Stale form' } }), /outra janela/);
    store.execute({ type: 'saveMaterial', material: { title: 'Useful notes', type: 'note', content: 'responsible for + -ing' } });
    const latest = second.getState();
    assert.equal(latest.lessons[0].title, 'Edited by tutor');
    assert.equal(latest.materials.length, 1);
  } finally { second.close(); }
});

test('transaction rolls back the whole command when a child fails validation', t => {
  const { store } = fixture(t);
  assert.throws(() => store.execute({
    type: 'saveLesson', lesson: { title: 'Must not be saved', objective: '' },
    activities: [{ title: 'Invalid activity', prompt: '', skill: 'writing', kind: 'writing' }],
  }), /Dados inválidos/);
  assert.equal(store.getState().lessons.length, 0);
  assert.equal(store.getState().activities.length, 0);
});

test('lesson edits preserve omitted activities and reject cross-lesson reassignment', t => {
  const { store } = fixture(t);
  let state = lesson(store);
  initial(store);
  state = store.execute({ type: 'saveLesson', lesson: { ...state.lessons[0], title: 'Updated lesson' }, activities: [] });
  assert.equal(state.activities.length, 1);
  assert.equal(state.attempts.length, 1);
  assert.throws(() => store.execute({
    type: 'saveLesson', lesson: { id: 'lesson-2', title: 'Other lesson', objective: '' },
    activities: [{ ...state.activities[0], lessonId: 'lesson-2' }],
  }), /transferir/);
  assert.equal(store.getState().lessons.length, 1);
});

test('review evidence is immutable and intervals follow local calendar days', t => {
  const { store } = fixture(t);
  let state = store.execute({ type: 'saveCard', card: { id: 'card-1', front: 'I am responsible for ___ courses.', back: 'creating' } });
  const today = localDate();
  assert.equal(getDueCards(state, today).length, 1);
  const review = (rating: 'again' | 'hard' | 'good', usedHint = false) => store.execute({ type: 'recordReview', cardId: 'card-1', answer: 'creating', rating, usedHint });
  state = review('good');
  assert.equal(state.cards[0].dueDate, addLocalDays(today, 1));
  assert.equal(state.cards[0].intervalIndex, 1);
  state = review('good');
  assert.equal(state.cards[0].dueDate, addLocalDays(today, 3));
  assert.equal(state.cards[0].intervalIndex, 2);
  state = review('good', true);
  assert.equal(state.cards[0].dueDate, addLocalDays(today, 1));
  assert.equal(state.cards[0].intervalIndex, 0);
  const metrics = getStudyMetrics(state);
  assert.equal(metrics.reviewEvents, 3);
  assert.equal(metrics.total, 1);
  assert.equal(metrics.unaidedAccuracy, 1);
  assert.equal(metrics.aidedAccuracy, null);
  assert.throws(() => store.execute({ type: 'recordReview', cardId: 'card-1', answer: '  ', rating: 'good', usedHint: false }), /Dados inválidos/);
  assert.equal(store.getState().reviews.length, 3);
});

test('metrics use first review per day and keep aid and ungraded writing separate', t => {
  const { store } = fixture(t);
  lesson(store);
  const attempted = initial(store);
  store.execute({ type: 'addFeedback', feedback: { attemptId: attempted.attempts[0].id, kind: 'hint', text: 'Try the -ing form.' } });
  store.execute({ type: 'saveCard', card: { id: 'card-1', front: 'Create', back: 'creating' } });
  let state = store.execute({ type: 'recordReview', cardId: 'card-1', answer: 'creating', rating: 'good', usedHint: true });
  state = store.execute({ type: 'recordReview', cardId: 'card-1', answer: 'creating', rating: 'good', usedHint: false });
  const metrics = getStudyMetrics(state);
  assert.equal(metrics.unaided, 0);
  assert.equal(metrics.aided, 1);
  assert.equal(metrics.unaidedAccuracy, null);
  assert.equal(metrics.aidedAccuracy, 1);
  assert.equal(metrics.attemptAccuracy, null);
  assert.equal(metrics.pendingFeedback, 1);
  assert.equal(metrics.ungradedAttempts, 1);
});

test('review intervals are configurable and invalid settings do not corrupt state', t => {
  const { store } = fixture(t);
  store.execute({ type: 'saveSettings', settings: { reviewIntervals: [2, 5, 14] } });
  store.execute({ type: 'saveCard', card: { id: 'card-1', front: 'Front', back: 'Back' } });
  const state = store.execute({ type: 'recordReview', cardId: 'card-1', answer: 'Back', rating: 'hard', usedHint: false });
  assert.equal(state.cards[0].dueDate, addLocalDays(localDate(), 2));
  assert.throws(() => store.execute({ type: 'saveSettings', settings: { reviewIntervals: [7, 1] } }), /intervalos/);
  assert.deepEqual(store.getState().settings.reviewIntervals, [2, 5, 14]);
});

test('restore validates schema, relations, completions and immutable history before writing', t => {
  const { store } = fixture(t);
  lesson(store);
  const saved = initial(store);
  const originalText = saved.attempts[0].text;
  const invalidVersion = { ...saved, schemaVersion: 3 };
  assert.throws(() => store.restore(invalidVersion), /schemaVersion/);
  const missingReference = structuredClone(saved);
  missingReference.attempts[0].activityId = 'missing';
  assert.throws(() => store.restore(missingReference), /inexistente/);
  const overwrite = structuredClone(saved);
  overwrite.attempts[0].text = 'Overwritten original';
  assert.throws(() => store.restore(overwrite), /imutável/);
  assert.equal(store.getState().attempts[0].text, originalText);
  assert.deepEqual(store.restore(saved), saved);
  const raw: unknown = { ...saved, arbitraryCode: 'ignored?' };
  assert.throws(() => store.restore(raw), /Dados inválidos/);
});

test('backup can be restored into an empty database with original history', t => {
  const source = fixture(t).store;
  lesson(source);
  initial(source);
  reuse(source);
  const backup = source.execute({ type: 'completeActivity', activityId: 'activity-1', mode: 'minimum' });
  const destination = fixture(t).store;
  assert.deepEqual(destination.restore(backup), backup);
  assert.deepEqual(destination.getState().attempts, source.getState().attempts);
});

test('invalid seed, reference, date and unsafe link are rejected', t => {
  const { store } = fixture(t);
  assert.throws(() => store.execute({ type: 'saveLesson', lesson: { title: 'Bad date', objective: '', scheduledDate: '2026-02-30' } }), /calendário/);
  assert.throws(() => store.execute({ type: 'saveLesson', lesson: { title: 'Bad reference', objective: '', materialIds: ['missing'] } }), /inexistente/);
  assert.throws(() => store.execute({ type: 'saveMaterial', material: { title: 'Bad URL', type: 'link', url: 'javascript:alert(1)' } }), /http/);
  const invalid = createEmptyState();
  invalid.settings.dailyMinutes = -1;
  assert.throws(() => validateState(invalid), /dailyMinutes/);
  const directory = mkdtempSync(join(tmpdir(), 'caderno-invalid-seed-'));
  try { assert.throws(() => new StudyStore(directory, invalid), /dailyMinutes/); }
  finally { rmSync(directory, { recursive: true, force: true }); }
});

test('audit and historical event tables reject direct update and delete', t => {
  const { store, directory } = fixture(t);
  lesson(store);
  initial(store);
  const db = new DatabaseSync(join(directory, 'caderno.sqlite'));
  try {
    assert.throws(() => db.exec('DELETE FROM journal'), /immutable journal/);
    assert.throws(() => db.exec("UPDATE immutable_records SET payload = '{}'"), /immutable record/);
  } finally { db.close(); }
});

test('closed store rejects operations clearly', t => {
  const { store } = fixture(t);
  store.close();
  assert.throws(() => store.getState(), /fechado/);
  assert.throws(() => store.restore(createEmptyState()), /fechado/);
});

test('version 1 database migrates once without changing immutable answers', t => {
  const { store, directory } = fixture(t);
  lesson(store);
  initial(store);
  const original = store.getState();
  store.close();
  const { externalLogs: ignoredLogs, feedbackErrorTypes: ignoredTypes, ...oldState } = original;
  void ignoredLogs; void ignoredTypes;
  const db = new DatabaseSync(join(directory, 'caderno.sqlite'));
  try {
    db.prepare('UPDATE state SET payload = ? WHERE id = 1').run(JSON.stringify({ ...oldState, schemaVersion: 1 }));
    db.exec('PRAGMA user_version = 1');
  } finally { db.close(); }
  const upgraded = new StudyStore(directory);
  try {
    const state = upgraded.getState();
    assert.equal(state.schemaVersion, 2);
    assert.deepEqual(state.attempts, original.attempts);
    assert.deepEqual(state.externalLogs, []);
    assert.deepEqual(state.feedbackErrorTypes, {});
    assert.equal(upgraded.getState().schemaVersion, 2);
  } finally { upgraded.close(); }
});

test('version 1 backup and Markdown import keep historical IDs', async t => {
  const source = fixture(t).store;
  lesson(source);
  initial(source);
  const { externalLogs: ignoredLogs, feedbackErrorTypes: ignoredTypes, ...current } = source.getState();
  void ignoredLogs; void ignoredTypes;
  const legacy = { ...current, schemaVersion: 1 };
  const { store: destination, directory } = fixture(t);
  const backup = join(directory, 'legacy-backup.json');
  writeFileSync(backup, JSON.stringify({ format: 'caderno-ingles-backup', version: 1, state: legacy }));
  assert.equal((await restoreBackup(backup)).schemaVersion, 2);
  const markdown = join(directory, 'caderno.md');
  writeFileSync(markdown, `# Caderno antigo\n<!-- caderno-data:start -->\n\`\`\`json\n${JSON.stringify({ format: 'caderno-ingles', version: 1, state: legacy })}\n\`\`\`\n<!-- caderno-data:end -->`);
  const imported = await importMarkdown(markdown, destination);
  assert.ok(imported.added >= 3);
  assert.equal(destination.getState().attempts[0].id, source.getState().attempts[0].id);
  const exported = await exportMarkdown(destination.getState(), join(directory, 'new-export'));
  assert.equal((await importMarkdown(exported, destination)).added, 0);
});

test('JSON and Markdown exchange preserve plans and observed lesson evidence', async t => {
  const { store: source, directory } = fixture(t);
  source.execute({ type: 'saveSettings', settings: { goal: 'Discuss my work in English.' } });
  lesson(source);
  const first = initial(source).attempts[0];
  source.execute({ type: 'addFeedback', feedback: { attemptId: first.id, kind: 'correction', text: 'Use creating.', result: 'needs_work', targetChunk: 'responsible for creating' } });
  reuse(source);
  source.execute({ type: 'completeActivity', activityId: 'activity-1', mode: 'minimum', minutes: 7 });
  const extra = source.execute({ type: 'saveLesson', lesson: { id: 'lesson-2', title: 'Another day', objective: 'Future practice' } });
  assert.equal(extra.lessons.length, 2);

  const json = join(directory, 'all.json');
  const md = join(directory, 'lesson.md');
  await exportExchange(source.getState(), json, 'json');
  await exportExchange(source.getState(), md, 'md', 'lesson-1');
  const full = JSON.parse(readFileSync(json, 'utf8'));
  assert.equal(full.report.lessons.length, 2);
  assert.equal(full.report.lessons[0].activities[0].attempts[0].text, first.text);
  assert.equal(full.report.lessons[0].activities[0].completion.actualMinutes, 7);
  assert.equal(full.report.evidence.gradedAttempts, 1);
  const lessonText = readFileSync(md, 'utf8');
  assert.match(lessonText, /responsible for creating/);
  assert.doesNotMatch(lessonText, /Another day/);

  const destination = fixture(t).store;
  assert.ok((await importExchange(md, destination)).added > 0);
  assert.equal(destination.getState().lessons.length, 1);
  assert.equal(destination.getState().settings.goal, 'Discuss my work in English.');
  assert.equal((await importExchange(md, destination)).added, 0);
  assert.ok((await importExchange(json, destination)).added > 0);
  assert.equal(destination.getState().lessons.length, 2);
  assert.equal(destination.getState().attempts[0].text, first.text);
  const edited = { ...full, state: { ...full.state, attempts: full.state.attempts.map((attempt: { id: string; text: string }) => attempt.id === first.id ? { ...attempt, text: 'AI replaced the answer' } : attempt) } };
  const altered = join(directory, 'altered.json');
  writeFileSync(altered, JSON.stringify(edited));
  await assert.rejects(importExchange(altered, destination), /Conflito no ID/);
  assert.equal(destination.getState().attempts[0].text, first.text);
});

test('entry recall uses one due card once per local day, including forgotten answers', t => {
  const { store } = fixture(t);
  store.execute({ type: 'saveCard', card: { id: 'card-warmup', front: 'A question', back: 'An answer' } });
  assert.equal(getWarmupCard(store.getState())?.id, 'card-warmup');
  const state = store.execute({ type: 'recordReview', cardId: 'card-warmup', answer: '[Não lembrei]', rating: 'again', usedHint: false });
  assert.equal(getWarmupCard(state), null);
  assert.equal(state.cards[0].dueDate, addLocalDays(localDate(), 1));
  assert.equal(getWarmupCard(state, addLocalDays(localDate(), 1))?.id, 'card-warmup');
});

test('external quick log is append-only, idempotent and separate from lesson completion', t => {
  const { store } = fixture(t);
  lesson(store, 'external');
  const command: Command = { type: 'recordExternalPractice', modality: 'speaking_dialogue', minutes: 5, chunkApplied: 'I found an issue', requestId: 'outside-1' };
  const first = store.execute(command);
  const repeated = store.execute(command);
  assert.equal(repeated.externalLogs.length, 1);
  assert.deepEqual(repeated.externalLogs, first.externalLogs);
  assert.equal(repeated.completions.length, 0);
  assert.equal(getStudyMetrics(repeated).speakingLogs, 1);
  assert.equal(getStudyMetrics(repeated).attemptAccuracy, null);
});

test('feedback seeds and suggested error can be accepted without editing original feedback', t => {
  const { store } = fixture(t);
  lesson(store);
  const attempt = initial(store).attempts[0];
  const state = store.execute({ type: 'addFeedback', feedback: {
    attemptId: attempt.id, kind: 'correction', text: 'Use creating.', targetChunk: 'responsible for creating',
    contextSeeds: ['Describe a form bug', 'Explain a slow query'], suggestedErrorType: 'verb_form',
  } });
  const original = state.feedback[0];
  const tagged = store.execute({ type: 'setFeedbackErrorType', feedbackId: original.id, errorType: 'verb_form' });
  assert.deepEqual(tagged.feedback[0], original);
  assert.equal(tagged.feedbackErrorTypes[original.id], 'verb_form');
  assert.throws(() => store.execute({ type: 'addFeedback', feedback: { attemptId: attempt.id, kind: 'correction', text: 'Too many seeds', contextSeeds: ['a', 'b', 'c'] } }), /contextSeeds/);
});
