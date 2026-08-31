/**
 * Starting over, without the queue coming with you.
 *
 * `RESET` promises "this clears everything you've done and starts over", and
 * that has to include the work this device has not managed to send yet — the
 * argument `store.tsx`'s account-change effect makes at length. Until now
 * nothing said so out loud. The clearing happened because `seedFor` pinned
 * `selfId` back to the demo sentinel, which moved the identity the
 * `lastSelfId` effect watches, which called `clearOutbox`. An accident, and a
 * racing one — `void clearOutbox()` is not awaited by the dispatch that caused
 * it.
 *
 * `selfId` now survives a reseed (it has to: left as the sentinel, the next
 * pull files your own row as a stranger and you appear twice in your own
 * circle). So on the live→live path — which the "Live" control right next to
 * this one produces — *neither* effect fires: `state.account` does not change
 * either. The queue would simply outlive the wipe and drain, successfully,
 * under an auth session that never changed. Tasks the user just erased come
 * back minutes later.
 *
 * Hence this. It sits beside `signOut.ts` and `deleteAccount.ts` because it is
 * the same genre — the async half of a destructive account action, returning
 * rather than dispatching so the caller can await it first and so the sequence
 * is testable without a store. It is *not* a Settings screen; `RESET` is
 * dispatched from `DevControls` in `MeScreen`, which is `__DEV__`-only.
 *
 * Unlike `attemptSignOut` this cannot refuse and does not check `pending()`.
 * Sign-out asks "would this lose something?" because signing back in is
 * supposed to restore you. Reset *is* the losing, asked for in as many words,
 * with a destructive-styled confirm already tapped.
 *
 * The alternative considered and not taken: a counter in state bumped only by
 * the wipe actions, with the store's effect watching it. That would put the
 * guarantee somewhere a future caller cannot forget it, which is a real
 * advantage over a helper at one call site. It was judged too much machinery
 * for a control that only exists in development builds — but if `RESET` ever
 * grows a caller outside `DevControls`, that is the change to make rather than
 * a second `await` somebody has to remember.
 */
import { clearMedia } from '../../sync/media';
import { clearOutbox } from '../../sync/outbox';

/**
 * Both queues, because both outlive a wipe the same way. `clearMedia`'s own
 * header says it is "called when the account is reset or the identity changes"
 * — which was true of the identity half and, until this function existed, not
 * true of the reset half at all.
 */
export async function clearQueuesForReset(): Promise<void> {
  await clearOutbox();
  await clearMedia();
}
