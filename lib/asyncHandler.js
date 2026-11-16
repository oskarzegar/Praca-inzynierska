// ============================================================================
// lib/asyncHandler.js  –  Błędy handlerów async w Express 4
//
// Express 4 nie przekazuje odrzuconych obietnic do obsługi błędów: wyjątek
// w handlerze `async` poza blokiem try kończył cały proces Node. Wrapper
// przekazuje taki błąd do next(err), skąd trafia do handlera błędów w server.js.
// ============================================================================

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
