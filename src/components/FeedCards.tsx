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
  onToggle,
  onOpen,
}: {
  task: Task;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const color = useColors();
  const shadows = useShadows();
  const showAud = task.aud !== 'friends';
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
            backgroundColor: task.done ? color.lime : '#FAFBF7',
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
                <Sans size={10.5} weight={700} color={task.aud === 'everyone' ? color.quoteInk : color.muted}>
                  {AUDIENCE_LABEL[task.aud]}
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
  /** FRIENDS or FOLLOW, as on `SocialCard`. */
  badge?: string;
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

        <View style={[row, { gap: 18, marginTop: 12 }]}>
          <Stat value={BIG_CARD_STATS.tasks} label="tasks" accent />
          <Stat value={BIG_CARD_STATS.pts} label="pts" />
          <Stat value={BIG_CARD_STATS.streak} label="streak" />
        </View>

        <View style={{ marginTop: 11, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: color.lime }}>
          <Sans size={13} lineHeight={18} color={onDark.bodySecondary}>
            {moment.quote}
          </Sans>
        </View>

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
 * FRIENDS or FOLLOW, beside the name.
 *
 * The circle's moments and the public feed are one list now, so this is the
 * only thing that says which half a card came from — it used to be answered by
 * which tab you were standing on. Same chip `MineRow` draws for audience, so
 * there is one pill in this app rather than two that nearly match.
 */
function SourceBadge({ label, dark }: { label: string; dark?: boolean }) {
  const color = useColors();
  return (
    <View
      style={{
        backgroundColor: dark ? onDark.fillStrong : color.chip,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
      }}
    >
      {/* 10px at the spec's floor: "Minimum readable size is 10px and only
          for uppercase tracked labels at ≥.45 alpha. Do not shrink further."
          This badge was authored at 9.5 and appears on nearly every card. */}
      <Caps size={10} tracking={1} color={dark ? onDark.secondary : color.muted}>
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
  /** FRIENDS or FOLLOW. Optional so the demo's own cards can go unlabelled. */
  badge?: string;
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
            {shared ? 'Posted to the circle ✓' : 'Post it to the circle'}
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
