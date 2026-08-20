/**
 * Avatars are generated initials on tinted circles — and, for the one person in
 * a hundred who has uploaded a face and had it screened, the face instead.
 *
 * Initials are the designed default and not a failure mode (`HANDOFF.md`: *no
 * image assets… avatars are generated initials on tinted circles*), which is
 * what makes the fallback rule below cheap to state: **bytes render only when
 * the state is `ready` and a signed URL is in hand.** Everything else — no
 * path, `none`, `pending`, `refused`, a URL that has not arrived yet, a URL
 * that failed to load — draws the letters. There is no third rendering, and in
 * particular no broken-image glyph.
 *
 * ─── why `pending` draws initials, to its own owner ───────────────────────
 *
 * This is a security property, not a nicety. `pending` means the bytes are on
 * the server and the screener has not answered, and the rule the whole feature
 * rests on is that an unscreened image never reaches a screen. Rendering it to
 * "just the owner, who took the photo anyway" sounds harmless and is not: the
 * owner's screenshot is then a distribution channel for an image the model was
 * never given the chance to refuse, and the account it came from is the one
 * that wanted it distributed. The server agrees at every layer — `set_avatar`
 * cannot write `ready`, only `mark_avatar_screened` can, and it is service-role
 * only — so this component is the last of several locks, not the only one.
 */
import React from 'react';
import { Image, StyleProp, View, ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useColors, usePersonTints } from '../theme/ThemeProvider';
import { PersonId } from '../data/people';
import { useAvatarUrl } from '../lib/avatarUrl';
import { usePeople } from '../state/store';
import { Bri, Tap } from './primitives';

export function Avatar({
  who,
  size = 36,
  initials,
  tint,
  label,
  style,
}: {
  who?: PersonId;
  size?: number;
  /** For people outside the circle (global feed handles). */
  initials?: string;
  tint?: string;
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const color = useColors();
  const personTints = usePersonTints();
  const people = usePeople();
  const person = who ? people.get(who) : undefined;
  const ini = initials ?? (who ? people.initials(who) : '?');
  // A person hands out a slot, not a colour; the palette that slot indexes is
  // this component's to resolve, because this is where the hook is.
  const bg = tint ?? (who ? personTints[people.tintIndex(who)] : color.chip);
  const name = label ?? (who ? people.name(who) : undefined);

  // `null` unless there is a screened photo and a URL that has not expired.
  const photo = useAvatarUrl(person?.avatarPath, person?.avatarState);
  /**
   * The URL whose image would not load — expired between signing and fetching,
   * an object deleted underneath us, a dead connection. Held as the URL rather
   * than a boolean so that a freshly signed one gets its own chance: comparing
   * it against `photo` resets the flag with no effect and no extra render.
   */
  const [broken, setBroken] = React.useState<string | null>(null);
  const src = photo && photo !== broken ? photo : null;

  return (
    <View
      accessible={!!name}
      // The photo is exactly as decorative as the initials it replaces — same
      // name, whichever is drawn. The `<Image>` itself carries none, and
      // `accessible` on this view collapses it away from a screen reader.
      accessibilityLabel={name}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
          // The photo is square and this is a circle.
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {src ? (
        <Image
          testID="avatar-photo"
          source={{ uri: src }}
          onError={() => setBroken(src)}
          resizeMode="cover"
          style={{ width: size, height: size }}
        />
      ) : (
        <Bri size={Math.round(size * 0.4)} weight={700} color={color.avatarText}>
          {ini}
        </Bri>
      )}
    </View>
  );
}

/** Overlapping faces, each ringed so they read as separate people. */
export function FaceStack({
  people,
  size = 20,
  ringColor,
  ringWidth = 2,
  onPressPerson,
}: {
  people: PersonId[];
  size?: number;
  ringColor?: string;
  ringWidth?: number;
  /** When set, each face becomes a route to that person's profile. */
  onPressPerson?: (who: PersonId) => void;
}) {
  const color = useColors();
  const dir = usePeople();
  // `ringColor` used to default to `color.paper` in the parameter list. A
  // parameter default is evaluated at call time but the palette now comes from
  // a hook, and a hook cannot be called out there, so the default moves in
  // here. `??` and not `||`: a parameter default fires only on `undefined`,
  // and `||` would also treat an empty string as "unset" — a caller passing
  // one would silently get paper instead of nothing. That is a behaviour
  // change, and this migration is not allowed one.
  const ring = ringColor ?? color.paper;
  return (
    <View style={{ flexDirection: 'row' }}>
      {people.map((k, i) => {
        // The ring goes *around* the face, not inside it. RN is always
        // border-box, so a border on the Avatar itself ate 2px off every side
        // — a 20px face rendering as a 16px one, initials and all. The
        // reference draws it content-box, so the wrapper carries the ring
        // colour as its background and the face keeps its full size.
        const face = (
          <View
            style={{
              padding: ringWidth,
              borderRadius: (size + ringWidth * 2) / 2,
              backgroundColor: ring,
              marginLeft: i ? -(size * 0.28 + ringWidth) : 0,
            }}
          >
            <Avatar who={k} size={size} />
          </View>
        );
        return onPressPerson ? (
          <Tap
            key={k}
            onPress={() => onPressPerson(k)}
            accessibilityLabel={`Open ${dir.name(k)}`}
            // The visual face stays small; the target does not. `minSize`
            // reads the style below, so the hit area grows to 44 around a
            // stack that is only 24 tall.
            style={{ width: size + ringWidth * 2, height: size + ringWidth * 2 }}
          >
            {face}
          </Tap>
        ) : (
          <React.Fragment key={k}>{face}</React.Fragment>
        );
      })}
    </View>
  );
}

/**
 * The circle's follow-through ring: r=43 in a 100-unit box, dasharray 270.4,
 * offset scaled by completion, rotated -90° so it starts at twelve o'clock.
 */
export const RING_CIRCUMFERENCE = 2 * Math.PI * 43;

export function ProgressRing({
  size,
  pct,
  stroke = 7,
  ringColor,
  trackColor = 'rgba(25,30,22,.08)',
}: {
  size: number;
  /**
   * `null` when this person's week has never been synced, which is not the
   * same as a week where they closed nothing. Coalescing it to 0 draws an
   * empty ring — visually identical to a real zero — so the one place the
   * circle is read at a glance would state a score nobody has earned.
   */
  pct: number | null;
  stroke?: number;
  ringColor?: string;
  trackColor?: string;
}) {
  const color = useColors();
  // Same `??` rewrite as `FaceStack` above, and for the same reason. Note that
  // `trackColor` keeps its parameter default: it is a literal, not a palette
  // read, so nothing forces it in here.
  const ring = ringColor ?? color.lime;
  // A dashed track and no arc: legibly "nothing to show" rather than "nothing
  // achieved". The text beside it already says "No week synced yet".
  const unknown = pct === null;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ position: 'absolute', top: 0, left: 0, transform: [{ rotate: '-90deg' }] }}
    >
      <Circle
        cx={50}
        cy={50}
        r={43}
        fill="none"
        stroke={trackColor}
        strokeWidth={stroke}
        strokeDasharray={unknown ? '10 9' : undefined}
      />
      {unknown ? null : (
        <Circle
          cx={50}
          cy={50}
          r={43}
          fill="none"
          stroke={ring}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - pct)}
        />
      )}
    </Svg>
  );
}
