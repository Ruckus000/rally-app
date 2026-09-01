/**
 * The seven Week-feed item types. Each is a distinct component; the feed
 * decides which to render, they never branch into each other.
 */
import React from 'react';
import { View } from 'react-native';
import { onDark, onLight } from '../theme/tokens';
import { useColors, useShadows } from '../theme/ThemeProvider';
import {
  AUDIENCE_LABEL,
  BIG_CARD_BASE_CHEERS,
  BIG_CARD_STATS,
  Moment,
  Task,
  TaskMedia,
} from '../data/fixtures';
import { PersonId } from '../data/people';
import { usePeople } from '../state/store';
import type { CircleRef } from '../state/store';
import { circleLabel } from '../state/selectors';
import { Avatar, FaceStack } from './Avatar';
import { Icon } from './Icon';
import { TaskPhoto } from './TaskPhoto';
import { EngagementRow } from './EngagementRow';
import { Bri, Caps, GlowBloom, GradientHairline, Sans, Tap, fill, row, rowTop } from './primitives';

/**
 * The gap between stacked cards, and the one place it is decided.
 *
 * Raised from the reference's 12 as part of the density pass: the design was
 * drawn dense at 402pt and reads cramped on a real device, so padding, the
 * checkbox and the two title sizes moved up one step of the spec's own
 * rhythm (4/6/8/10/12/14/16/18/22/26) together — scaling the composition
 * rather than any one card.
 */
const CARD_GAP = 14;

/**
 * Text in a flex row does not shrink on its own.
 *
 * React Native's default is `flexShrink: 0` where CSS's is 1, so every title
 * and name that sits beside something else — points, a face stack, a badge —
 * took its full intrinsic width and painted straight past the card instead of
 * wrapping. That is the "cut off information" this app actually had: the web
 * prototype these cards were drawn from wrapped for free.
 */
const shrink = { flexShrink: 1 } as const;

/* ── label ──────────────────────────────────────────────────────────────── */

export function FeedLabel({ children }: { children: string }) {
  return (
    <Caps size={11} tracking={1.4} style={{ paddingHorizontal: 2, paddingTop: 10, paddingBottom: 4 }}>
      {children}
    </Caps>
  );
}

/* ── mine ───────────────────────────────────────────────────────────────── */

/**
 * Memoized, like every card below: each one is a LinearGradient hairline (the
 * dark ones an SVG bloom too), so re-painting all of them because an unrelated
 * slice of state moved is exactly the per-keystroke cost this app had. The
 * handlers take the task id so the caller can pass one stable function to
 * every row instead of a fresh closure per row per render.
 */
export const MineRow = React.memo(function MineRow({
  task,
  circles,
  onToggle,
  onOpen,
}: {
  task: Task;
  /** Threaded rather than read from the store, so `React.memo` still holds. */
  circles: CircleRef[];
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const color = useColors();
  const shadows = useShadows();
  // The chip used to be hidden for `friends`, and the rule looked like "hide
  // friends". It was never that — it was "hide the line that says nothing", and
  // those stopped being the same condition once a goal could name the room it
  // was staked in. So the test is against the generic word rather than the
  // audience: a goal in a circle this device can name has something to say.
  const audLabel = circleLabel(task, circles);
  const showAud = audLabel !== AUDIENCE_LABEL.friends;
  return (
    <GradientHairline radius={21} style={{ marginBottom: CARD_GAP, ...shadows.card }}>
      <View
        style={{
          backgroundColor: color.card,
          borderRadius: 19,
          paddingVertical: 14,
          paddingHorizontal: 16,
        }}
      >
      <View style={{ ...rowTop, gap: 10 }}>
        <Tap
          onPress={() => onToggle(task.id)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: task.done }}
          accessibilityLabel={task.title}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: task.done ? color.lime : color.checkboxFill,
            ...(task.done
              ? null
              : { borderWidth: 2, borderStyle: 'dashed' as const, borderColor: color.dash }),
          }}
        >
          {/* Done carries a check glyph, not just a colour. */}
          {task.done ? <Icon name="check" size={16} color={onLight} strokeWidth={3} /> : null}
        </Tap>

        <Tap onPress={() => onOpen(task.id)} accessibilityLabel={`Open ${task.title}`} style={fill} minSize={0}>
          <View style={[row, { gap: 8 }]}>
            <Sans
              size={15.5}
              weight={600}
              lineHeight={20}
              color={task.done ? color.muted : color.textPrimary}
              style={shrink}
              numberOfLines={2}
            >
              {task.title}
            </Sans>
            {task.pair.length ? <FaceStack people={task.pair} size={20} /> : null}
          </View>
          <View style={[row, { gap: 6, marginTop: 2 }]}>
            <Sans size={11.5} color={color.muted}>
              {task.cat}
            </Sans>
            {showAud ? (
              <View style={{ backgroundColor: color.chip, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Sans
                  size={10.5}
                  weight={700}
                  numberOfLines={1}
                  color={task.aud === 'everyone' ? color.quoteInk : color.muted}
                  style={{ maxWidth: 120 }}
                >
                  {audLabel}
                </Sans>
              </View>
            ) : null}
            {task.cmts.length ? (
              <View style={[row, { gap: 3 }]}>
                <Sans size={11.5} color={color.muted}>
                  ·
                </Sans>
                <Icon name="comment" size={11} color={color.muted} strokeWidth={2} />
                <Sans size={11.5} color={color.muted}>
                  {task.cmts.length}
                </Sans>
              </View>
            ) : null}
          </View>
        </Tap>

        <Bri size={13.5} weight={700} color={task.done ? color.moss : color.textPrimary}>
          +{task.pts}
        </Bri>
      </View>
      {/* Under the row rather than beside it, and *inside* the card: a photo
          is the evidence, and a thumbnail small enough to sit in the row
          would not be worth attaching. Tapping it opens the same sheet the
          title does. */}
      {task.media ? (
        <Tap
          onPress={() => onOpen(task.id)}
          accessibilityLabel={`Photo on ${task.title}`}
          minSize={0}
        >
          <TaskPhoto media={task.media} label={`Photo on ${task.title}`} />
        </Tap>
      ) : null}
      </View>
    </GradientHairline>
  );
});

/* ── big (someone else's perfect week) ──────────────────────────────────── */

export const BigCard = React.memo(function BigCard({
  moment,
  badge,
  cheered,
  cosigned,
  onCheer,
  onComment,
  onCosign,
}: {
  moment: Moment;
  /** The circle's name or FOLLOW, as on `SocialCard`. */
  badge?: string | null;
  cheered: boolean;
  cosigned: boolean;
  onCheer: () => void;
  onComment: () => void;
  onCosign: () => void;
}) {
  const color = useColors();
  // The only card in this file that names a person it wasn't handed a name for:
  // a moment carries an id, and the feed has no display string to pass down.
  const people = usePeople();
  return (
    <GradientHairline radius={25} variant="dark" style={{ marginBottom: CARD_GAP }}>
      <View style={{ backgroundColor: color.ink, borderRadius: 23, padding: 20, overflow: 'hidden' }}>
        <GlowBloom size={190} top={-70} right={-60} opacity={0.22} />

        <View style={[row, { gap: 10 }]}>
          <Avatar who={moment.who} size={36} />
          <View style={fill}>
            <View style={[row, { gap: 7 }]}>
              <Sans
                size={13.5}
                weight={600}
                color={onDark.primary}
                style={shrink}
                numberOfLines={1}
              >
                {people.name(moment.who)}
              </Sans>
              {badge ? <SourceBadge label={badge} dark /> : null}
            </View>
            <Sans size={11} color={onDark.secondary}>
              {moment.time} ago
            </Sans>
          </View>
          <View style={{ backgroundColor: color.lime, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 }}>
            <Bri size={10} weight={800} tracking={1} color={onLight}>
              PERFECT
            </Bri>
          </View>
        </View>

        <Bri size={22} weight={800} tracking={-0.4} lineHeight={26} color={onDark.primary} style={{ marginTop: 13 }}>
          {moment.title}
        </Bri>

        {/* Real numbers when the card came off a posted week, and the fixture's
            constants when it did not. This is the whole reason
            `taskRowToMoment` refused to emit `kind: 'big'`: a card built from a
            task would have stated a week nobody had. A share carries its own. */}
        <View style={[row, { gap: 18, marginTop: 12 }]}>
          <Stat
            value={moment.week ? `${moment.week.done}/${moment.week.total}` : BIG_CARD_STATS.tasks}
            label="tasks"
            accent
          />
          <Stat
            value={moment.week ? String(moment.week.points) : BIG_CARD_STATS.pts}
            label="pts"
          />
          <Stat
            value={moment.week ? `${moment.week.streak}w` : BIG_CARD_STATS.streak}
            label="streak"
          />
        </View>

        {/* A posted week has no quote — nobody was asked for one. The bordered
            block is skipped rather than drawn empty. */}
        {moment.quote ? (
          <View style={{ marginTop: 11, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: color.lime }}>
            <Sans size={13} lineHeight={18} color={onDark.bodySecondary}>
              {moment.quote}
            </Sans>
          </View>
        ) : null}

        {/* No engagement row on a posted week, and it is a correctness
            decision rather than a layout one. Reactions are keyed to `tasks` by
            foreign key, and a week is not a task — so a cheer here could never
            reach the server. `parseActedKey` would drop it silently (its target
            is not a uuid), which is the right failure but still leaves a button
            that does nothing. Better not to offer one. Comments are the same
            row and the same problem. */}
        {moment.week ? null : (
        <EngagementRow
          dark
          marginTop={14}
          cheered={cheered}
          cheerCount={BIG_CARD_BASE_CHEERS + (cheered ? 1 : 0)}
          cheerLabel={String(BIG_CARD_BASE_CHEERS + (cheered ? 1 : 0))}
          commentCount={moment.cmts?.length ?? 0}
          onCheer={onCheer}
          onComment={onComment}
          cta={{
            label: cosigned ? 'You’re in ✓' : 'I’m in on this',
            onPress: onCosign,
            style: cosigned ? 'ghostLime' : 'lime',
          }}
        />
        )}
      </View>
    </GradientHairline>
  );
});

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  const color = useColors();
  return (
    <View>
      <Bri size={16} weight={800} color={accent ? color.lime : onDark.primary}>
        {value}
      </Bri>
      <Sans size={10} color={onDark.secondary}>
        {label}
      </Sans>
    </View>
  );
}

/* ── source badge ───────────────────────────────────────────────────────── */

/**
 * The room a card came out of, beside the name. Or FOLLOW, on the public half.
 *
 * The circle's moments and the public feed are one list, so this is the only
 * thing that says which half a card came from — it used to be answered by which
 * tab you were standing on. Same chip `MineRow` draws for audience, so there is
 * one pill in this app rather than two that nearly match, and that argument now
 * carries more weight rather than less: both of them name a circle.
 *
 * It used to read FRIENDS here. That word stopped naming anything once somebody
 * could be in two rooms — it meant "a person you share a circle with" on a card
 * belonging to one specific room out of several. `feedBadge` decides what it
 * says, including when it says nothing; the rules are worth reading there.
 */
function SourceBadge({ label, dark }: { label: string; dark?: boolean }) {
  const color = useColors();
  return (
    <View
      style={{
        backgroundColor: dark ? onDark.fillStrong : color.chip,
        borderRadius: 999,
        // A circle name is as long as somebody wanted it, where FRIENDS and
        // FOLLOW were fixed. Without a shrink this takes its intrinsic width
        // and squeezes the person's name to nothing — which is the bug `shrink`
        // above was introduced to fix, arriving from the other side.
        flexShrink: 1,
        maxWidth: 112,
        paddingHorizontal: 8,
        paddingVertical: 2,
      }}
    >
      {/* 10px at the spec's floor: "Minimum readable size is 10px and only
          for uppercase tracked labels at ≥.45 alpha. Do not shrink further."
          This badge was authored at 9.5 and appears on nearly every card.
          Shrinking being forbidden is exactly why the name ellipsises instead:
          it is the only lever left once the type size is fixed. */}
      <Caps
        size={10}
        tracking={1}
        numberOfLines={1}
        ellipsizeMode="tail"
        color={dark ? onDark.secondary : color.muted}
      >
        {label}
      </Caps>
    </View>
  );
}

/* ── social (friend moment or global post) ──────────────────────────────── */

export const SocialCard = React.memo(function SocialCard({
  who,
  initials,
  tint,
  name,
  badge,
  time,
  title,
  quote,
  media,
  statLabel,
  isAsk,
  cheered,
  cheerCount,
  commentCount,
  onOpen,
  onCheer,
  onComment,
  cta,
}: {
  who?: PersonId;
  initials?: string;
  tint?: string;
  name: string;
  /**
   * The circle's name, or FOLLOW on the public half. Nullable as well as
   * optional: the demo's own cards go unlabelled, and so does a card whose room
   * this device cannot name — see `feedBadge` for why that is silence rather
   * than a generic word.
   */
  badge?: string | null;
  time: string;
  title: string;
  quote?: string;
  /**
   * Their photo, when there is one and you may see it. Only ever the `url`
   * half — the file behind `localUri` is on their phone, not this one.
   */
  media?: TaskMedia;
  statLabel?: string;
  isAsk?: boolean;
  cheered: boolean;
  cheerCount: number;
  commentCount: number;
  onOpen: () => void;
  onCheer: () => void;
  onComment: () => void;
  cta?: { label: string; onPress: () => void; style: 'lime' | 'inkOnLime' };
}) {
  const color = useColors();
  const shadows = useShadows();
  const quoteRule = tint ?? (who ? undefined : color.chip);

  return (
    <GradientHairline
      radius={23}
      // The ask variant carries a lime border instead, as the reference does —
      // a shadow under it would read as two outlines.
      style={{ marginBottom: CARD_GAP, ...(isAsk ? null : shadows.card) }}
    >
      <Tap
        onPress={onOpen}
        // The badge is in here too. Whose feed a card came from is not
        // decoration, and a screen reader gets it from nowhere else.
        accessibilityLabel={badge ? `${name}, ${badge}: ${title}` : `${name}: ${title}`}
        minSize={0}
        style={{
          backgroundColor: isAsk ? color.askTint : color.card,
          borderWidth: 1.5,
          borderColor: isAsk ? color.lime : 'transparent',
          borderRadius: 21,
          padding: 18,
        }}
      >
        {isAsk ? (
          <Caps size={10} tracking={1.2} color={color.moss} style={{ marginBottom: 7 }}>
            Asked for help
          </Caps>
        ) : null}

        <View style={[row, { gap: 10 }]}>
          <Avatar who={who} initials={initials} tint={tint} label={name} size={34} />
          <View style={fill}>
            <View style={[row, { gap: 7 }]}>
              <Sans size={13.5} weight={600} style={shrink} numberOfLines={1}>
                {name}
              </Sans>
              {badge ? <SourceBadge label={badge} /> : null}
            </View>
            <Sans size={11} color={color.faintInk}>
              {time} ago
            </Sans>
          </View>
          {statLabel ? (
            <Sans size={11.5} weight={700} color={color.muted}>
              {statLabel}
            </Sans>
          ) : null}
        </View>

        <Bri size={18} weight={700} tracking={-0.2} lineHeight={22} style={{ marginTop: 9 }}>
          {title}
        </Bri>

        {quote ? (
          <View
            style={{
              marginTop: 7,
              paddingLeft: 10,
              borderLeftWidth: 2,
              borderLeftColor: quoteRule ?? color.chip,
            }}
          >
            <Sans size={13} lineHeight={18} color={color.quoteInk}>
              {quote}
            </Sans>
          </View>
        ) : null}

        {/* Under what they said and above what you can do about it — the photo
            is the evidence for the line above it, not a thing in its own
            right. Sized from the stored dimensions, so a card does not jump
            when the image lands. */}
        {media ? <TaskPhoto media={media} label={`Photo on ${name}’s goal`} /> : null}

        <EngagementRow
          cheered={cheered}
          cheerCount={cheerCount}
          commentCount={commentCount}
          onCheer={onCheer}
          onComment={onComment}
          cta={cta}
        />
      </Tap>
    </GradientHairline>
  );
});

/* ── quiet ──────────────────────────────────────────────────────────────── */

export const QuietRow = React.memo(function QuietRow({
  text,
  acted,
  onAct,
}: {
  text: string;
  acted: boolean;
  onAct: () => void;
}) {
  const color = useColors();
  return (
    <View style={[row, { gap: 9, paddingVertical: 2, paddingHorizontal: 4, marginBottom: CARD_GAP }]}>
      <Sans size={13} color={color.quietText} style={fill}>
        {text}
      </Sans>
      <Tap
        onPress={onAct}
        style={{ paddingVertical: 11, paddingHorizontal: 8, minHeight: 44, justifyContent: 'center' }}
      >
        <Sans size={12.5} weight={700} color={acted ? color.moss : color.muted}>
          {acted ? 'Said hey ✓' : 'Say hey'}
        </Sans>
      </Tap>
    </View>
  );
});

/* ── mineWin (your own perfect week) ────────────────────────────────────── */

export const MineWinCard = React.memo(function MineWinCard({
  taskCount,
  points,
  streak,
  weekLabel,
  shared,
  onShare,
}: {
  taskCount: number;
  points: number;
  weekLabel: string;
  /** Weeks held once this one closes. */
  streak: number;
  shared: boolean;
  onShare: () => void;
}) {
  const color = useColors();
  return (
    <GradientHairline radius={25} variant="dark" style={{ marginBottom: CARD_GAP }}>
      <View
        style={{
          backgroundColor: color.ink,
          borderRadius: 23,
          paddingVertical: 20,
          paddingHorizontal: 20,
          overflow: 'hidden',
        }}
      >
        <GlowBloom size={190} top={-70} right={-60} opacity={0.25} />

        <View style={[row, { gap: 10 }]}>
          <View style={{ backgroundColor: color.lime, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 }}>
            <Bri size={10} weight={800} tracking={1} color={onLight}>
              PERFECT WEEK
            </Bri>
          </View>
          <Sans size={11.5} color={onDark.bodySecondary} style={shrink} numberOfLines={2}>
            {weekLabel} — every stake closed.
          </Sans>
        </View>

        <Bri size={26} weight={800} tracking={-0.6} color={onDark.primary} style={{ marginTop: 12 }}>
          All {taskCount} of it.
        </Bri>

        <View style={[row, { gap: 18, marginTop: 12 }]}>
          <Stat value={`${taskCount}/${taskCount}`} label="tasks" accent />
          <Stat value={String(points)} label="pts" accent />
          <Stat value={`${streak}w`} label="streak" accent />
        </View>

        <Tap
          onPress={onShare}
          style={{
            marginTop: 14,
            borderRadius: 999,
            paddingVertical: 11,
            paddingHorizontal: 16,
            minHeight: 44,
            alignItems: 'center',
            justifyContent: 'center',
            alignSelf: 'flex-start',
            backgroundColor: shared ? onDark.limeFill : color.lime,
          }}
        >
          <Bri size={13} weight={800} color={shared ? color.lime : onLight}>
            {/* "the circle" named one room, and there can be several. A
                finished week is not scoped to any of them — its goals span
                every circle you are in — so this reaches all of them, and says
                so. Ratified deviation; see design-reference/DEVIATIONS.md. */}
            {shared ? 'Posted to your circles ✓' : 'Post it to your circles'}
          </Bri>
        </Tap>
      </View>
    </GradientHairline>
  );
});

/* ── empty ──────────────────────────────────────────────────────────────── */

export function EmptyFeed({ onPlan }: { onPlan: () => void }) {
  return (
    <EmptyState
      title="Nothing staked yet"
      body="The week doesn’t count itself."
      cta="Stake your week"
      onPress={onPlan}
    />
  );
}

/**
 * The written empty state. Every surface that can run out of content uses
 * this rather than a generic "No items" — empty states say something human.
 */
export function EmptyState({
  title,
  body,
  cta,
  onPress,
}: {
  title: string;
  body: string;
  cta?: string;
  onPress?: () => void;
}) {
  const color = useColors();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 34, paddingHorizontal: 20 }}>
      <Bri size={18} weight={800} tracking={-0.3} style={{ textAlign: 'center' }}>
        {title}
      </Bri>
      <Sans size={13} lineHeight={18} color={color.muted} style={{ marginTop: 6, textAlign: 'center' }}>
        {body}
      </Sans>
      {cta && onPress ? (
        <Tap
          onPress={onPress}
          style={{
            marginTop: 14,
            borderRadius: 999,
            paddingVertical: 12,
            paddingHorizontal: 18,
            minHeight: 44,
            justifyContent: 'center',
            backgroundColor: color.ink,
          }}
        >
          <Bri size={13.5} weight={800} color={color.lime}>
            {cta}
          </Bri>
        </Tap>
      ) : null}
    </View>
  );
}
