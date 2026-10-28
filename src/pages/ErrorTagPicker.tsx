import type { ErrorType, Feedback } from '../../shared/types';
import { errorTypeLabels } from '../errorTypes';
import { useStudy } from '../store';

export function ErrorTagPicker({ feedback }: { feedback: Feedback }) {
  const { state, command, busy } = useStudy();
  if (feedback.kind !== 'correction') return null;
  const accepted = state.feedbackErrorTypes[feedback.id];
  return <div className="error-tag-picker">
    <span className="eyebrow">PADRÃO DO ERRO</span>
    {accepted === undefined && feedback.suggestedErrorType && <button type="button" className="error-tag-suggestion" disabled={busy} onClick={() => void command({ type: 'setFeedbackErrorType', feedbackId: feedback.id, errorType: feedback.suggestedErrorType ?? null }, 'Categoria registrada.')}>Aceitar sugestão: {errorTypeLabels[feedback.suggestedErrorType]}</button>}
    <select aria-label="Categoria desta correção" disabled={busy} value={accepted ?? ''} onChange={event => void command({ type: 'setFeedbackErrorType', feedbackId: feedback.id, errorType: event.target.value ? event.target.value as ErrorType : null }, 'Categoria atualizada.')}>
      <option value="">Sem categoria</option>
      {Object.entries(errorTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  </div>;
}
