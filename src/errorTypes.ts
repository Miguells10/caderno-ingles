import type { ErrorType } from '../shared/types';

export const errorTypeLabels: Record<ErrorType, string> = {
  l1_transfer: 'Tradução literal do português',
  collocation: 'Combinação de palavras',
  preposition: 'Preposição',
  verb_form: 'Forma verbal',
  other: 'Outro padrão',
};
