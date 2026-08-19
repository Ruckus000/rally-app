/**
 * Whether a picture is safe to put on other people's screens.
 *
 * The sibling of `screening.mjs`, asked about a different thing. That one reads
 * a sentence somebody wrote about their week; this one looks at an avatar. The
 * questions do not overlap, so neither does the wording — a prompt about
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
 * A `.mjs` module for the same reason as the rubric — see the note there.
 */
export const IMAGE_SCREENING = `\
You are shown one image: a picture somebody has chosen as their profile photo.
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

None of those are what you are being asked about. You are not judging whether
this is a good profile photo, whether it is well taken, or whether you would
choose it. You are only asked whether it contains one of the three things named
above.

If you are unsure, answer "no".

When the answer is "yes", \`reason\` is one short sentence saying plainly which of
the three it is. Write it in your own words — do not repeat any wording from
these instructions. When the answer is "no", \`reason\` is an empty string.

Return JSON only.
`;
