/**
 * The Stake screen is only as honest as this table: what you picked on the
 * intent step has to be what you're offered, and your own words always survive
 * the trim.
 */
import { SUGG, handleOf, initialsOf, pool, type Suggestion } from '../data';

const custom = (id: string, title: string): Suggestion => ({
  id,
  title,
  freq: 'this week',
  pts: 25,
});

describe('pool', () => {
  it('offers the suggestions for the intents you chose, in order', () => {
    expect(pool(['learn'], []).map((r) => r.id)).toEqual(['l1', 'l2']);
    expect(pool(['money', 'learn'], []).map((r) => r.id)).toEqual(['y1', 'y2', 'l1', 'l2']);
  });

  it('falls back to move, focus and health when nothing is chosen', () => {
    const ids = pool([], []).map((r) => r.id);
    expect(ids).toEqual(['m1', 'm2', 'm3', 'f1', 'f2', 'h1', 'h2']);
  });

  it('shows at most seven suggestions', () => {
    const everything = pool(['move', 'focus', 'learn', 'health', 'create', 'money'], []);
    const total = Object.values(SUGG).reduce((n, rows) => n + rows.length, 0);
    expect(total).toBe(13);
    expect(everything).toHaveLength(7);
    expect(everything.map((r) => r.id)).toEqual(['m1', 'm2', 'm3', 'f1', 'f2', 'l1', 'l2']);
  });

  it('puts your own commitments first and never trims them', () => {
    const mine = [custom('x1', 'Call Nana'), custom('x2', 'Fix the bike')];
    const rows = pool(['move', 'focus', 'learn', 'health'], mine);
    expect(rows).toHaveLength(9);
    expect(rows.slice(0, 2)).toEqual(mine);
  });

  it('returns only your own when there is nothing else to offer', () => {
    const mine = [custom('x1', 'Call Nana')];
    expect(pool([], []).length).toBe(7);
    expect(pool(['learn'], mine)[0]).toEqual(mine[0]);
  });
});

describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsOf('Alex Rivera')).toBe('AR');
    expect(initialsOf('maya')).toBe('M');
    expect(initialsOf('ana lucia dos santos')).toBe('AL');
  });

  it('ignores stray whitespace', () => {
    expect(initialsOf('  alex   rivera  ')).toBe('AR');
  });

  it('holds an interpunct while the field is empty', () => {
    expect(initialsOf('')).toBe('·');
    expect(initialsOf('   ')).toBe('·');
  });
});

describe('handleOf', () => {
  it('strips everything that is not a letter or a digit', () => {
    expect(handleOf('Alex Rivera')).toBe('@alexrivera');
    expect(handleOf("O'Brien-Smith 3")).toBe('@obriensmith3');
  });

  it('keeps the line from collapsing when the field is empty', () => {
    expect(handleOf('')).toBe(' ');
    expect(handleOf('   ')).toBe(' ');
  });
});
