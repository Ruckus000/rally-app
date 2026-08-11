/**
 * The onboarding content table: what you can say you're here to move, and the
 * first week we offer you for saying it. Verbatim from the design — the copy
 * and the point values are the spec, not a starting point.
 */

export type IntentId = 'move' | 'focus' | 'learn' | 'health' | 'create' | 'money';

export type Intent = {
  id: IntentId;
  icon: string;
  label: string;
};

export type Suggestion = {
  id: string;
  title: string;
  /** How often, in the design's own shorthand: '×2 this week', 'every day'. */
  freq: string;
  pts: number;
};

export const INTENTS: Intent[] = [
  { id: 'move', icon: '🏃', label: 'Move more' },
  { id: 'focus', icon: '🎯', label: 'Deep work' },
  { id: 'learn', icon: '📚', label: 'Learn something' },
  { id: 'health', icon: '🌙', label: 'Sleep & health' },
  { id: 'create', icon: '✍️', label: 'Make things' },
  { id: 'money', icon: '💸', label: 'Money habits' },
];

export const SUGG: Record<IntentId, Suggestion[]> = {
  move: [
    { id: 'm1', title: 'Run 5k', freq: '×2 this week', pts: 40 },
    { id: 'm2', title: 'Gym session', freq: '×3 this week', pts: 45 },
    { id: 'm3', title: 'Morning walk', freq: 'every day', pts: 35 },
  ],
  focus: [
    { id: 'f1', title: '90-min deep work block', freq: '×4 this week', pts: 60 },
    { id: 'f2', title: 'No phone before noon', freq: 'every day', pts: 40 },
  ],
  learn: [
    { id: 'l1', title: '30 min of Spanish', freq: '×5 this week', pts: 50 },
    { id: 'l2', title: 'Finish one chapter', freq: '×3 this week', pts: 30 },
  ],
  health: [
    { id: 'h1', title: 'In bed by 11', freq: '×5 nights', pts: 40 },
    { id: 'h2', title: 'Cook dinner at home', freq: '×4 this week', pts: 35 },
  ],
  create: [
    { id: 'c1', title: 'Write 500 words', freq: '×4 this week', pts: 50 },
    { id: 'c2', title: 'Ship one small thing', freq: '×1 this week', pts: 60 },
  ],
  money: [
    { id: 'y1', title: 'No-spend day', freq: '×3 this week', pts: 30 },
    { id: 'y2', title: 'Review the budget', freq: '×1 this week', pts: 20 },
  ],
};

/** What we suggest to someone who skipped the intent step. */
export const DEFAULT_INTENTS: IntentId[] = ['move', 'focus', 'health'];

/** The most suggestions we'll ever show. Anything you wrote yourself is extra. */
const SUGG_LIMIT = 7;

/**
 * The Stake screen's list. Your own commitments come first and are never
 * trimmed — the cap only applies to what we thought of for you.
 */
export function pool(intents: IntentId[], customs: Suggestion[]): Suggestion[] {
  const ids = intents.length ? intents : DEFAULT_INTENTS;
  let out: Suggestion[] = [];
  ids.forEach((i) => {
    out = out.concat(SUGG[i] ?? []);
  });
  return customs.concat(out.slice(0, SUGG_LIMIT));
}

/** Up to two initials. The interpunct keeps the avatar from collapsing empty. */
export function initialsOf(name: string): string {
  const n = name.trim();
  if (!n) return '·';
  return n
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

/**
 * The handle preview under the avatar. Empty yields a space rather than '' so
 * the line holds its height and the avatar doesn't jump on the first keystroke.
 */
export function handleOf(name: string): string {
  const n = name.trim();
  if (!n) return ' ';
  return '@' + n.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
