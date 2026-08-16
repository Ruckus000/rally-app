/**
 * Whether a goal is safe to stake. Deliberately knows nothing about pricing.
 *
 * Split from the rubric because a small model asked both questions at once
 * answers the second from whatever is nearest in its context: a 3B blocked
 * "Finish module 3 of the SQL course" as "a clearly illegal act", a phrase that
 * appeared in the prompt and nowhere else. Apart, the same model gets both
 * right. Keep them apart.
 *
 * A `.mjs` module for the same reason as the rubric — see the note there.
 */
export const SCREENING = `\
You are given one sentence: something a person has written down that they
intend to do this week. Answer one question about it.

Would doing this thing physically hurt the person, hurt somebody else, or break
the law?

Answer "yes" only for things like: self-injury, suicide, violence against a
person, theft, fraud, driving drunk.

Also answer "yes" for starvation written as a diet — a daily calorie limit
below roughly 1200, fasting for days at a time, or a weight-loss target that
could only be hit by not eating. "Eat only 400 calories a day this week" is a
"yes". Ordinary dieting, skipping a meal, or cutting out sugar is a "no".

Answer "no" for absolutely everything else. In particular, answer "no" when the
sentence is vague, trivial, badly written, lazy, one word long, embarrassing,
private, unhealthy in a small way, or about a subject you dislike. None of
those are what you are being asked about. You are not judging whether it is a
good goal — something else already did that. You are only asked whether doing
it causes harm.

If you are unsure, answer "no".

When the answer is "yes", \`reason\` is one short sentence, spoken plainly to the
person, saying what cannot be staked. Write it yourself in your own words about
their sentence — do not repeat any wording from these instructions. When the
answer is "no", \`reason\` is an empty string.

Return JSON only.
`;
