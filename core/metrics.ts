import type { Card, Review, StudyState } from '../shared/types.js';

/** Calendar day on this computer, without UTC shifting a late-night session. */
export function localDate(value: Date | string = new Date()): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new Error('Data inválida.');
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function addLocalDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const value = new Date(year, month - 1, date, 12);
  value.setDate(value.getDate() + days);
  return localDate(value);
}

export function getDueCards(state: StudyState, today = localDate()): Card[] {
  return state.cards.filter(card => !card.archived && card.dueDate <= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.createdAt.localeCompare(b.createdAt));
}

/** One completed review satisfies the entry recall for the local calendar day. */
export function getWarmupCard(state: StudyState, day = localDate()): Card | null {
  if (state.reviews.some(review => localDate(review.reviewedAt) === day)) return null;
  return getDueCards(state, day)[0] ?? null;
}

export type ReviewMetrics = {
  total: number;
  unaided: number;
  unaidedCorrect: number;
  aided: number;
  aidedCorrect: number;
  unaidedAccuracy: number | null;
  aidedAccuracy: number | null;
};

export type StudyMetrics = ReviewMetrics & {
  /** Same-card retries on the same calendar day do not increase retention. */
  firstReviews: ReviewMetrics;
  reviewEvents: number;
  dueCards: number;
  completedActivities: number;
  fullCompletions: number;
  minimumCompletions: number;
  externalCompletions: number;
  externalLogs: number;
  speakingLogs: number;
  listeningLogs: number;
  pendingFeedback: number;
  gradedAttempts: number;
  correctAttempts: number;
  attemptAccuracy: number | null;
  ungradedAttempts: number;
  knownMinutes: number;
  sessionsWithoutTime: number;
  daily: (ReviewMetrics & { date: string; completions: number; externalLogs: number })[];
};

function countReviews(reviews: Review[]): ReviewMetrics {
  const unaided = reviews.filter(review => !review.usedHint);
  const aided = reviews.filter(review => review.usedHint);
  // "hard" means recalled with difficulty; "again" means not recalled.
  const unaidedCorrect = unaided.filter(review => review.rating !== 'again').length;
  const aidedCorrect = aided.filter(review => review.rating !== 'again').length;
  return {
    total: reviews.length, unaided: unaided.length, unaidedCorrect,
    aided: aided.length, aidedCorrect,
    unaidedAccuracy: unaided.length ? unaidedCorrect / unaided.length : null,
    aidedAccuracy: aided.length ? aidedCorrect / aided.length : null,
  };
}

export function getStudyMetrics(state: StudyState, today = localDate()): StudyMetrics {
  const first = new Map<string, Review>();
  for (const review of [...state.reviews].sort((a, b) => Date.parse(a.reviewedAt) - Date.parse(b.reviewedAt))) {
    const key = `${localDate(review.reviewedAt)}:${review.cardId}`;
    if (!first.has(key)) first.set(key, review);
  }
  const firstReviews = [...first.values()];
  const latestCorrections = new Map<string, StudyState['feedback'][number]>();
  for (const feedback of [...state.feedback].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
    if (feedback.kind === 'correction') latestCorrections.set(feedback.attemptId, feedback);
  }
  const graded = [...latestCorrections.values()].filter(feedback => feedback.result !== 'ungraded');
  const correct = graded.filter(feedback => feedback.result === 'correct').length;
  const days = new Set([
    ...firstReviews.map(review => localDate(review.reviewedAt)),
    ...state.completions.map(completion => localDate(completion.confirmedAt)),
    ...state.externalLogs.map(log => localDate(log.loggedAt)),
  ]);
  const counts = countReviews(firstReviews);
  return {
    ...counts, firstReviews: counts,
    reviewEvents: state.reviews.length,
    dueCards: getDueCards(state, today).length,
    completedActivities: new Set(state.completions.map(completion => completion.activityId)).size,
    fullCompletions: state.completions.filter(completion => completion.mode === 'full').length,
    minimumCompletions: state.completions.filter(completion => completion.mode === 'minimum').length,
    externalCompletions: state.completions.filter(completion => completion.mode === 'external').length,
    externalLogs: state.externalLogs.length,
    speakingLogs: state.externalLogs.filter(log => log.modality !== 'listening').length,
    listeningLogs: state.externalLogs.filter(log => log.modality === 'listening').length,
    pendingFeedback: state.attempts.filter(attempt => !latestCorrections.has(attempt.id)).length,
    gradedAttempts: graded.length, correctAttempts: correct,
    attemptAccuracy: graded.length ? correct / graded.length : null,
    ungradedAttempts: state.attempts.length - graded.length,
    knownMinutes: state.completions.reduce((sum, completion) => sum + (completion.minutes ?? 0), 0) + state.externalLogs.reduce((sum, log) => sum + (log.minutes ?? 0), 0),
    sessionsWithoutTime: state.completions.filter(completion => completion.minutes === null).length + state.externalLogs.filter(log => log.minutes === null).length,
    daily: [...days].sort().map(date => ({
      date,
      ...countReviews(firstReviews.filter(review => localDate(review.reviewedAt) === date)),
      completions: state.completions.filter(completion => localDate(completion.confirmedAt) === date).length,
      externalLogs: state.externalLogs.filter(log => localDate(log.loggedAt) === date).length,
    })),
  };
}
