/**
 * Settings is a destination like every other overlay here: reducer state, not a
 * route. These assert it behaves like its siblings — it opens, it closes, and a
 * route to somewhere else takes it off screen rather than leaving it stacked.
 */
import { reducer } from '../store';
import { baseState } from '../../test/baseState';

describe('opening and closing settings', () => {
  it('opens', () => {
    expect(reducer(baseState, { type: 'OPEN_SETTINGS' }).settingsOpen).toBe(true);
  });

  it('closes', () => {
    const open = { ...baseState, settingsOpen: true };
    expect(reducer(open, { type: 'CLOSE_SETTINGS' }).settingsOpen).toBe(false);
  });

  it('is cleared by a route to somewhere else, like every other overlay', () => {
    const open = { ...baseState, settingsOpen: true };
    const next = reducer(open, { type: 'GO_PLACE', patch: { tab: 'circle' } });
    expect(next.settingsOpen).toBe(false);
  });
});
