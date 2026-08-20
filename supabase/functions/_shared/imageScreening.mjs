/**
 * Whether a picture is safe to put on other people's screens.
 *
 * The sibling of `screening.mjs`, asked about a different thing. That one reads
 * a sentence somebody wrote about their week; this one looks at a photograph.
 * The questions do not overlap, so neither does the wording — a prompt about
 * self-harm and illegality would give a model no idea what to do with a photo.
 *
 * The failure written against is the same one, though, and it is worth naming
 * twice: a model asked to flag "inappropriate" images will happily flag a badly
 * lit selfie, somebody's dog, a cartoon, or a face it finds unattractive. Every
 * one of those is a person told their picture is not allowed, for nothing. So
 * the question is narrowed to the three things that get an app pulled from a
 * store, the yes-list is closed, and everything else is spelled out as a "no"
 * rather than left to the model's taste.
 *
 * ─── two subjects, one question ───────────────────────────────────────────
 *
 * There are two places a picture reaches somebody else's screen — a profile
 * photo and a photo hung off a finished goal — and the three things being
 * looked for are identical in both. What differs is only what the image *is*,
 * which the model needs in order to know what "normal" looks like: a goal
 * photo is usually a trail, a watch face, or a plate of food, and a prompt
 * that told the model to expect a portrait would make every one of those a
 * surprise worth flagging.
 *
 * So the rules live once, in `body`, and the subject is the only thing either
 * caller gets to vary. A new surface adds a constant here; it does not get to
 * bring its own opinion about what is harmful.
 *
 * A `.mjs` module for the same reason as the rubric — see the note there.
 */

/**
 * @param {string} intro - what the image is, as one noun phrase.
 * @param {string} noun  - what to call it in the "not judging" paragraph.
 * @param {string} [alsoNo] - extra "answer no" examples for this subject, or
 *   nothing. A parameter rather than a post-hoc string replacement: a caller
 *   patching the finished prompt would go quietly back to the generic wording
 *   the first time a line above is reworded.
 */
const body = (intro, noun, alsoNo = '') => `\
You are shown one image: ${intro}.
Answer one question about it.

Does this image contain sexual content, graphic violence, or a hate symbol?

Answer "yes" only for things like: nudity or sexual acts, genitals, pornography,
a real injury or corpse shown in gore, a person being violently harmed, or an
emblem of a hate movement such as a swastika or a Klan hood.

Answer "no" for absolutely everything else. In particular, answer "no" when the
image is blurry, dark, badly framed, unflattering, low quality, a screenshot, a
drawing, a cartoon, an anime character, a logo, a meme, a photo of a pet, a
landscape, an object, a car, a piece of food, a group of people, a child, a
stranger, a celebrity, or a person you cannot identify. Answer "no" to a photo
with no face in it at all. Answer "no" to swimwear, a shirtless person, a gym
photo, a tattoo, a costume, a weapon held safely, alcohol, or a rude gesture.
Answer "no" to religious, national, political, and sporting symbols — a flag or
a cross is not a hate symbol.
${alsoNo}
None of those are what you are being asked about. You are not judging whether
this is a good ${noun}, whether it is well taken, or whether you would choose
it. You are only asked whether it contains one of the three things named above.

If you are unsure, answer "no".

When the answer is "yes", \`reason\` is one short sentence saying plainly which of
the three it is. Write it in your own words — do not repeat any wording from
these instructions. When the answer is "no", \`reason\` is an empty string.

Return JSON only.
`;

/** A face on a name in a bell. Seen by every signed-in account. */
export const IMAGE_SCREENING = body(
  'a picture somebody has chosen as their profile photo',
  'profile photo',
);

/**
 * A photo hung off a goal somebody finished. Seen by whoever could already see
 * that goal — which is narrower than an avatar's audience, and is why the two
 * are separate constants rather than one prompt with the audience left vague.
 *
 * The extra "no" examples are the things this app's users actually photograph.
 * Without them the model is left inferring that a screenshot of a run tracker
 * is an odd thing to submit, and "odd" is one short step from "flag it".
 */
export const GOAL_IMAGE_SCREENING = body(
  'a picture somebody has attached to a goal they finished, such as a run, a workout, a meal, or a habit they kept',
  'photo of a finished goal',
  `Answer "no" to a screenshot of a fitness app, a map, a route, a watch face, a
set of splits, a scale, a medal, a race bib, a receipt, a book, a plate of food,
a drink, an empty room, or a photo of nothing in particular.
`,
);
