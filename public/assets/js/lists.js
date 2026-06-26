'use strict';

import { supabase } from './supabase.js';

// Wstrzykuje przyciski list (do obejrzenia / obejrzane) do sekcji szczegółów filmu
// i obsługuje toggle dodawania/usuwania w Supabase
export function initListButtons(movieId, movieTitle, posterPath) {
  const detailList = document.querySelector('.detail-list');
  if (!detailList) return;

  const watchlistItem = document.createElement('div');
  watchlistItem.classList.add('list-item', 'list-btn-item');

  const watchedItem = document.createElement('div');
  watchedItem.classList.add('list-item', 'list-btn-item');

  detailList.appendChild(watchlistItem);
  detailList.appendChild(watchedItem);

  // Renderuje jeden przycisk listy: sprawdza stan w DB i podpina handler kliknięcia
  // Niezalogowanemu użytkownikowi wyświetla przycisk zablokowany (disabled)
  async function renderBtn(container, table, labelIn, labelOut, rowLabel) {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;

    if (!userId) {
      container.innerHTML = `
        <p class="list-name">${rowLabel}</p>
        <button class="btn list-toggle-btn list-toggle-btn--add" disabled>${labelOut}</button>`;
      return;
    }

    const { data } = await supabase
      .from(table)
      .select('id')
      .eq('user_id', userId)
      .eq('movie_id', Number(movieId))
      .maybeSingle();

    const isIn = !!data;
    container.innerHTML = `
      <p class="list-name">${rowLabel}</p>
      <button class="btn list-toggle-btn ${isIn ? 'list-toggle-btn--remove' : 'list-toggle-btn--add'}">
        ${isIn ? labelIn : labelOut}
      </button>`;

    // Po kliknięciu: usuń lub dodaj wiersz, a następnie odśwież przycisk.
    // Blokada przycisku na czas operacji zapobiega podwójnemu insertowi przy szybkim klikaniu.
    const toggleBtn = container.querySelector('button');
    toggleBtn.addEventListener('click', async () => {
      toggleBtn.disabled = true;
      if (isIn) {
        await supabase.from(table).delete().eq('user_id', userId).eq('movie_id', Number(movieId));
      } else {
        await supabase.from(table).insert({
          user_id:     userId,
          movie_id:    Number(movieId),
          movie_title: movieTitle,
          poster_path: posterPath || null,
        });
      }
      renderBtn(container, table, labelIn, labelOut, rowLabel);
    });
  }

  function render() {
    renderBtn(watchlistItem, 'watchlist', '✓ W liście',    '+ Do listy',              'Lista do obejrzenia');
    renderBtn(watchedItem,   'watched',   '✓ Obejrzane', '+ Oznacz jako obejrzane', 'Obejrzane');
  }

  render();
  // Odświeża oba przyciski przy każdej zmianie stanu autentykacji (login/logout)
  supabase.auth.onAuthStateChange(() => render());
}
