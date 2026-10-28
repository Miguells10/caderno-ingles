import { useState } from 'react';
import type { Card, Review } from '../../shared/types';
import { useStudy } from '../store';
import { Button, Field, Markdown, Modal } from '../ui';

export function Warmup({ card, onFinished, onCancel }: { card: Card; onFinished: () => void; onCancel: () => void }) {
  const { command, busy } = useStudy();
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [forgot, setForgot] = useState(false);

  async function finish(rating: Review['rating']) {
    const saved = await command({ type: 'recordReview', cardId: card.id, answer: answer.trim() || '[Não lembrei]', rating, usedHint: false });
    if (saved) onFinished();
  }

  return <Modal title="Uma expressão antes da aula" onClose={onCancel}>
    <p className="muted">Tente lembrar. Se não vier, revele a resposta e siga sem penalidade.</p>
    <div className="warmup-front"><Markdown>{card.front}</Markdown></div>
    {!revealed ? <>
      <Field label="O que você lembra?"><textarea lang="en" rows={3} value={answer} onChange={event => setAnswer(event.target.value)} autoFocus /></Field>
      <div className="button-row warmup-actions">
        <Button variant="ghost" onClick={() => { setForgot(true); setRevealed(true); }}>Não lembrei</Button>
        <Button disabled={!answer.trim()} onClick={() => setRevealed(true)}>Conferir resposta</Button>
      </div>
    </> : <>
      <div className="warmup-back"><span className="eyebrow">RESPOSTA DO CARTÃO</span><Markdown>{card.back}</Markdown></div>
      {forgot ? <Button disabled={busy} onClick={() => void finish('again')}>Registrar e abrir aula</Button> : <>
        <p className="muted">Compare com o que escreveu e escolha como foi. O app não corrige sua frase automaticamente.</p>
        <div className="button-row warmup-actions">
          <Button variant="ghost" disabled={busy} onClick={() => void finish('again')}>Não lembrei</Button>
          <Button variant="secondary" disabled={busy} onClick={() => void finish('hard')}>Com dificuldade</Button>
          <Button disabled={busy} onClick={() => void finish('good')}>Lembrei</Button>
        </div>
      </>}
    </>}
  </Modal>;
}
