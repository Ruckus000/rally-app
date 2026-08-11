/**
 * The engine's only attachment to React, kept to two effects and no state.
 *
 * Nothing here calls `setState`. `StoreProvider`'s context is
 * `useMemo(..., [state, config])`, so any state this hook held would re-render
 * every screen in the app every time the queue ticked — for a queue the UI does
 * not render and is not waiting on.
 */
import React, { useEffect, useRef } from 'react';
import type { Action, State } from '../state/store';
import { createEngine, type Engine } from './engine';
import { flushOutbox, hydrateOutbox } from './outbox';

/**
 * The mounted engine, for the store's AppState listener. Module-level for the
 * same reason the outbox and the scheduler are: there is one provider, and a
 * ref threaded back through the provider would have to be a stable object in
 * that `useMemo` above to be worth anything.
 */
let active: Engine | null = null;

/** Foreground. Coming back is the moment stale work is most worth sending. */
export function kickSync(): void {
  active?.kick();
}

export function useSyncEngine(
  state: State,
  dispatch: React.Dispatch<Action>,
  enabled: boolean,
): void {
  const engine = useRef<Engine | null>(null);

  useEffect(() => {
    // `enabled` is `syncOn`, and `syncOn` is false in every demo mode. Nothing
    // below this line may run for `fresh` or `seeded`.
    if (!enabled) return;

    const created = createEngine(dispatch);
    engine.current = created;
    active = created;

    let live = true;
    // Unsent work from a previous launch has to be back in the queue before the
    // first drain, or a stake made offline yesterday would sit behind whatever
    // is enqueued today. A tap during hydration is safe: `hydrateOutbox`
    // re-numbers the in-memory entries above the restored ones rather than
    // colliding with them.
    void hydrateOutbox().then(() => {
      if (live) created.start();
    });

    return () => {
      live = false;
      created.stop();
      if (active === created) active = null;
      engine.current = null;
      // Unmount is as final as a force-quit for anything still in memory.
      void flushOutbox();
    };
  }, [enabled, dispatch]);

  // The same cadence as the persistence effect, and for the same reason: this
  // is the only moment the engine can see that a durable slice moved.
  useEffect(() => {
    engine.current?.observe(state);
  }, [state]);
}
