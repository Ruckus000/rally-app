/**
 * The seven Week-feed item types. Each is a distinct component; the feed
 * decides which to render, they never branch into each other.
 */
import React from 'react';
import { View } from 'react-native';
import { color, onDark, PersonKey } from '../theme/tokens';
import {
  AUDIENCE_LABEL,
  BIG_CARD_BASE_CHEERS,
  BIG_CARD_STATS,
  GlobalPost,
  Moment,
  NAME,
  Task,
} from '../data/fixtures';
import { CURRENT_WEEK } from '../data/week';
import { Avatar, FaceStack } from './Avatar';
import { Icon } from './Icon';
import { EngagementRow } from './EngagementRow';
import { Bri, Caps, GlowBloom, GradientHairline, Sans, Tap, fill, row, rowTop } from './primitives';

/* ── label ──────────────────────────────────────────────────────────────── */

export function FeedLabel({ children }: { children: string }) {
  return (
    <Caps size={11} tracking={1.4} style={{ paddingHorizontal: 2, paddingTop: 10, paddingBottom: 4 }}>
      {children}
    </Caps>
  );
}

/* ── mine ───────────────────────────────────────────────────────────────── */

export function MineRow({
  task,
  onToggle,
  onOpen,
}: {
  task: Task;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const showAud = task.aud !== 'friends';
  return (
    <GradientHairline radius={21} style={{ marginBottom: 12 }}>
      <View
        style={{
          ...rowTop,
          gap: 10,
          backgroundColor: color.card,
          borderRadius: 19,
          paddingVertical: 12,
          paddingHorizontal: 13,
        }}
      >
        <Tap
          onPress={onToggle}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: task.done }}
          accessibilityLabel={task.title}
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: task.done ? color.lime : '#FAFBF7',
            ...(task.done
              ? null
              : { borderWidth: 2, borderStyle: 'dashed' as const, borderColor: color.dash }),
          }}
        >
          {/* Done carries a check glyph, not just a colour. */}
          {task.done ? <Icon name="check" size={16} color={color.ink} strokeWidth={3} /> : null}
        </Tap>

        <Tap onPress={onOpen} accessibilityLabel={`Open ${task.title}`} style={fill} minSize={0}>
          <View style={[row, { gap: 8 }]}>
            <Sans size={14.5} weight={600} color={task.done ? color.muted : color.ink}>
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

        <Bri size={13.5} weight={700} color={task.done ? color.moss : color.ink}>
          +{task.pts}
        </Bri>
      </View>
    </GradientHairline>
  );
}

/* ── big (someone else's perfect week) ──────────────────────────────────── */

export function BigCard({
  moment,
  cheered,
  cosigned,
  onCheer,
  onComment,
  onCosign,
}: {
  moment: Moment;
  cheered: boolean;
  cosigned: boolean;
  onCheer: () => void;
  onComment: () => void;
  onCosign: () => void;
}) {
  return (
    <GradientHairline radius={25} variant="dark" style={{ marginBottom: 12 }}>
      <View style={{ backgroundColor: color.ink, borderRadius: 23, padding: 17, overflow: 'hidden' }}>
        <GlowBloom size={190} top={-70} right={-60} opacity={0.22} />

        <View style={[row, { gap: 10 }]}>
          <Avatar who={moment.who} size={36} />
          <View style={fill}>
            <Sans size={13.5} weight={600} color={color.paper}>
              {NAME[moment.who]}
            </Sans>
            <Sans size={11} color={onDark.secondary}>
              {moment.time} ago
            </Sans>
          </View>
          <View style={{ backgroundColor: color.lime, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 }}>
            <Bri size={10} weight={800} tracking={1} color={color.ink}>
              PERFECT
            </Bri>
          </View>
        </View>

        <Bri size={22} weight={800} tracking={-0.4} lineHeight={26} color={color.paper} style={{ marginTop: 13 }}>
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
}

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <View>
      <Bri size={16} weight={800} color={accent ? color.lime : color.paper}>
        {value}
      </Bri>
      <Sans size={10} color={onDark.secondary}>
        {label}
      </Sans>
    </View>
  );
}

/* ── social (friend moment or global post) ──────────────────────────────── */

export function SocialCard({
  who,
  initials,
  tint,
  name,
  time,
  title,
  quote,
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
  who?: PersonKey;
  initials?: string;
  tint?: string;
  name: string;
  time: string;
  title: string;
  quote?: string;
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
  const quoteRule = tint ?? (who ? undefined : color.chip);

  return (
    <GradientHairline radius={23} style={{ marginBottom: 12 }}>
      <Tap
        onPress={onOpen}
        accessibilityLabel={`${name}: ${title}`}
        minSize={0}
        style={{
          backgroundColor: isAsk ? color.askTint : color.card,
          borderWidth: 1.5,
          borderColor: isAsk ? color.lime : 'transparent',
          borderRadius: 21,
          padding: 15,
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
            <Sans size={13.5} weight={600}>
              {name}
            </Sans>
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

        <Bri size={17} weight={700} tracking={-0.2} lineHeight={20} style={{ marginTop: 9 }}>
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
}

/* ── quiet ──────────────────────────────────────────────────────────────── */

export function QuietRow({
  text,
  acted,
  onAct,
}: {
  text: string;
  acted: boolean;
  onAct: () => void;
}) {
  return (
    <View style={[row, { gap: 9, paddingVertical: 2, paddingHorizontal: 4, marginBottom: 12 }]}>
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
}

/* ── mineWin (your own perfect week) ────────────────────────────────────── */

export function MineWinCard({
  taskCount,
  points,
  shared,
  onShare,
}: {
  taskCount: number;
  points: number;
  shared: boolean;
  onShare: () => void;
}) {
  return (
    <GradientHairline radius={25} variant="dark" style={{ marginBottom: 12 }}>
      <View
        style={{
          backgroundColor: color.ink,
          borderRadius: 23,
          paddingVertical: 18,
          paddingHorizontal: 17,
          overflow: 'hidden',
        }}
      >
        <GlowBloom size={190} top={-70} right={-60} opacity={0.25} />

        <View style={[row, { gap: 10 }]}>
          <View style={{ backgroundColor: color.lime, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 }}>
            <Bri size={10} weight={800} tracking={1} color={color.ink}>
              PERFECT WEEK
            </Bri>
          </View>
          <Sans size={11.5} color={onDark.bodySecondary}>
            {CURRENT_WEEK.label} — every stake closed.
          </Sans>
        </View>

        <Bri size={26} weight={800} tracking={-0.6} color={color.paper} style={{ marginTop: 12 }}>
          All {taskCount} of it.
        </Bri>

        <View style={[row, { gap: 18, marginTop: 12 }]}>
          <Stat value={`${taskCount}/${taskCount}`} label="tasks" accent />
          <Stat value={String(points)} label="pts" accent />
          <Stat value="4w" label="streak" accent />
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
            backgroundColor: shared ? 'rgba(195,245,60,.16)' : color.lime,
          }}
        >
          <Bri size={13} weight={800} color={shared ? color.lime : color.ink}>
            {shared ? 'Posted to the circle ✓' : 'Post it to the circle'}
          </Bri>
        </Tap>
      </View>
    </GradientHairline>
  );
}

/* ── empty ──────────────────────────────────────────────────────────────── */

export function EmptyFeed({ onPlan }: { onPlan: () => void }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 34, paddingHorizontal: 20 }}>
      <Bri size={18} weight={800} tracking={-0.3}>
        Nothing staked yet
      </Bri>
      <Sans size={13} lineHeight={18} color={color.muted} style={{ marginTop: 6, textAlign: 'center' }}>
        The week doesn’t count itself.
      </Sans>
      <Tap
        onPress={onPlan}
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
          Stake your week
        </Bri>
      </Tap>
    </View>
  );
}

export type { GlobalPost };
