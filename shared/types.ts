export type Skill = 'writing' | 'reading' | 'listening' | 'speaking';
export type ErrorType = 'l1_transfer' | 'collocation' | 'preposition' | 'verb_form' | 'other';
export type ExternalModality = 'speaking_dialogue' | 'speaking_monologue' | 'listening';
export type Entity = { id: string; revision: number; createdAt: string; updatedAt: string };
export type Lesson = Entity & {
 title: string; objective: string; scheduledDate: string; minutes: number;
 tags: string[]; materialIds: string[]; archived: boolean;
};
export type Activity = Entity & {
 lessonId: string; title: string; prompt: string; criteria: string;
 kind: 'writing' | 'reflection' | 'external'; skill: Skill; order: number;
};
export type Attempt = Entity & {
 activityId: string; text: string; stage: 'initial' | 'retry' | 'reuse';
 source: 'app' | 'chat' | 'import';
};
export type Feedback = Entity & {
 attemptId: string; kind: 'hint' | 'correction'; text: string;
 correctedText: string; reusePrompt: string; result: 'correct' | 'needs_work' | 'ungraded';
 targetChunk?: string; contextSeeds?: string[]; suggestedErrorType?: ErrorType | null;
};
export type Completion = Entity & {
 activityId: string; mode: 'full' | 'minimum' | 'external';
 minutes: number | null; notes: string; confirmedAt: string;
};
export type Material = Entity & {
 title: string; type: 'link' | 'video' | 'pdf' | 'note'; url: string;
 content: string; tags: string[]; attachmentName: string; attachmentId: string;
};
export type Card = Entity & {
 front: string; back: string; tags: string[]; sourceActivityId: string;
 sourceText: string; dueDate: string; intervalIndex: number; archived: boolean;
 targetChunk?: string;
};
export type ExternalLog = Entity & {
 modality: ExternalModality; minutes: number | null; chunkApplied: string; loggedAt: string;
};
export type Review = Entity & {
 cardId: string; answer: string; rating: 'again' | 'hard' | 'good';
 usedHint: boolean; reviewedAt: string; source: 'self';
};
export type Settings = {
 name: string; goal: string; dailyMinutes: number; dailyCards: number;
 theme: 'light' | 'dark'; reviewIntervals: number[];
};
export type StudyState = {
 schemaVersion: 2; settings: Settings; lessons: Lesson[]; activities: Activity[];
 attempts: Attempt[]; feedback: Feedback[]; completions: Completion[];
 materials: Material[]; cards: Card[]; reviews: Review[]; externalLogs: ExternalLog[];
 feedbackErrorTypes: Record<string, ErrorType | null>; drafts: Record<string, string>;
};
export type Command =
 | { type: 'saveLesson'; lesson: Partial<Lesson> & Pick<Lesson, 'title' | 'objective'>; activities?: (Partial<Activity> & Pick<Activity, 'title' | 'prompt' | 'skill' | 'kind'>)[]; requestId?: string }
 | { type: 'saveMaterial'; material: Partial<Material> & Pick<Material, 'title' | 'type'>; requestId?: string }
 | { type: 'saveCard'; card: Partial<Card> & Pick<Card, 'front' | 'back'>; requestId?: string }
 | { type: 'saveDraft'; activityId: string; text: string }
 | { type: 'submitAttempt'; activityId: string; text: string; stage: Attempt['stage']; source?: Attempt['source']; requestId?: string }
 | { type: 'addFeedback'; feedback: Partial<Feedback> & Pick<Feedback, 'attemptId' | 'kind' | 'text'>; requestId?: string }
 | { type: 'completeActivity'; activityId: string; mode: Completion['mode']; minutes?: number | null; notes?: string; requestId?: string }
 | { type: 'recordReview'; cardId: string; answer: string; rating: Review['rating']; usedHint: boolean; requestId?: string }
 | { type: 'recordExternalPractice'; modality: ExternalModality; minutes?: number | null; chunkApplied?: string; requestId?: string }
 | { type: 'setFeedbackErrorType'; feedbackId: string; errorType: ErrorType | null; requestId?: string }
 | { type: 'saveSettings'; settings: Partial<Settings> };
export type SystemAction = 'exportMarkdown' | 'importMarkdown' | 'exportExchange' | 'exportLesson' | 'importExchange' | 'backup' | 'restore' | 'openDataFolder' | 'openExchangeFolder' | 'attachFile' | 'openAttachment' | 'openExternal' | 'getInfo' | 'createShortcut' | 'copyTutorPrompt';
export type SystemResult = { canceled?: boolean; message?: string; path?: string; attachmentId?: string; attachmentName?: string; dataDir?: string; exchangeDir?: string; executable?: string; mcpConfig?: string; version?: string; };
export type UpdateAction = 'status' | 'check' | 'download' | 'install';
export type UpdateStatus = {
 phase: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'current' | 'login_required' | 'unsupported' | 'error';
 currentVersion: string; availableVersion?: string; progress?: number; message?: string;
};
export interface DesktopAPI {
 state(): Promise<StudyState>;
 command(command: Command): Promise<StudyState>;
 system(action: SystemAction, payload?: Record<string, string>): Promise<SystemResult>;
 onChange(callback: () => void): () => void;
  update(action: UpdateAction): Promise<UpdateStatus>;
  onUpdate(callback: (status: UpdateStatus) => void): () => void;
}
declare global { interface Window { caderno: DesktopAPI } }
