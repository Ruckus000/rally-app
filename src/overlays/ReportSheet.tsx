/**
 * Reporting something, and — separately — blocking whoever posted it.
 *
 * Two acts, two confirmations, on purpose. Reporting a post and never wanting
 * to see that person again are different intentions, and a sheet that bundled
 * them would silently take the larger one on the user's behalf every time. So
 * filing a report is one button, and blocking is a second button behind a
 * second confirm that spells out what a block does and does not do.
 *
 * ── the copy ─────────────────────────────────────────────────────────────
 *
 * Plain, not warm. Everywhere else in this app the voice is a friend talking;
 * here that voice reads as insincere, because the person on this screen is
 * upset and being charmed at is the last thing they want.
 *
 * Two sentences are load-bearing and must survive editing:
 *
 * 1. "no moderation team". There isn't one. `reports` is a write-only table
 *    with an index for a queue nobody drains, and the migration says so in as
 *    many words. Any copy implying a human will look — "we'll review this",
 *    "thanks for helping keep Rally safe" — is a promise this app cannot keep,
 *    and the person it fails is the one who most needed it to be true.
 * 2. The paragraph about the circle on the block confirm. A blocked person
 *    keeps their seat in `circleMembers`, the ranked list and the circle's
 *    totals — a deliberate decision documented on that selector, because those
 *    are circle-wide rollups and filtering them per viewer would make the
 *    leaderboard disagree with itself. Without that paragraph the first thing
 *    a user sees after blocking someone is that person, still on the rail, and
 *    the reasonable conclusion is that the block did not work.
 *
 * Nobody is thanked here.
 *
 * ── zIndex 57 ────────────────────────────────────────────────────────────
 *
 * The ladder is Plan 45, Sheet 50, Ledger 55, **this**, Notifications 58,
 * Settings 59, Rollover 60, Onboard 70. Above the detail sheet, because that
 * is where a report is started from and the sheet stays open underneath —
 * cancelling should put you back on the thing you were looking at. Below
 * Notifications and Settings, which are reached from chrome this sheet is
 * never open over, and well below the two overlays the app is waiting on an
 * answer from.
 */
import React, { useEffect, useState } from 'react';
import { Animated, ScrollView, View } from 'react-native';
import { onLight, radius } from '../theme/tokens';
import { useColors } from '../theme/ThemeProvider';
import { Bri, Sans, Tap, fill, row } from '../components/primitives';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Overlay } from './Overlay';
import { SHEET_DURATION, sheetEasing, useReducedMotion } from '../theme/motion';
import { useStore } from '../state/store';
import { queueBlock, queueReport } from '../sync/engine';
import type { ReportReason } from '../sync/transport';
import type { ReportTarget } from '../state/store';

/**
 * The six the migration's `reports_reason_known` allows, in the order a person
 * scans them: worst first, "something else" last.
 *
 * The value is the constraint's string and the label is this file's English.
 * They are paired here rather than derived from each other because the two are
 * genuinely different things — `self_harm` is a database value and "Self-harm"
 * is a sentence fragment — and a `.replace('_', ' ')` between them would be a
 * transformation pretending to be a translation.
 */
const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'spam', label: 'Spam' },
  { value: 'sexual', label: 'Sexual content' },
  { value: 'violence', label: 'Violence or threats' },
  { value: 'self_harm', label: 'Self-harm' },
  { value: 'other', label: 'Something else' },
];

const SUBJECT_TITLE: Record<ReportTarget['kind'], string> = {
  task: 'Report this',
  note: 'Report this note',
  profile: 'Report this person',
};

/** What is left over after filing: the report screen, or the block confirm. */
type Step = 'reason' | 'filed' | 'confirmBlock';

export function ReportSheet() {
  const color = useColors();
  const { state, dispatch, people } = useStore();
  const target = state.reportTarget;
  const reduced = useReducedMotion();
  const [slide] = useState(() => new Animated.Value(1));
  const [step, setStep] = useState<Step>('reason');
  const [reason, setReason] = useState<ReportReason | null>(null);

  useEffect(() => {
    if (reduced) {
      slide.setValue(0);
      return;
    }
    slide.setValue(1);
    Animated.timing(slide, {
      toValue: 0,
      duration: SHEET_DURATION,
      easing: sheetEasing,
      useNativeDriver: true,
    }).start();
  }, [target?.id, reduced, slide]);

  if (!target) return null;

  // Cancelling is a dispatch and nothing else — no report, no block, no toast.
  const close = () => dispatch({ type: 'CLOSE_REPORT' });

  const name = people.name(target.who);
  const first = people.first(target.who);

  /**
   * Whether a block is even offered.
   *
   * `block_person` refuses a bot and refuses you, and `blocks_not_self` refuses
   * a self-row under it. Both refusals are correct and both would surface here
   * as a raised exception long after the tap, on a screen whose whole job is to
   * be believable. So the control is absent rather than present-and-doomed:
   * there is no honest label for a button that cannot work.
   */
  const blockable = target.who !== state.selfId && !state.people[target.who]?.bot;

  const fileIt = () => {
    if (!reason) return;
    dispatch({ type: 'REPORT_FILED', id: target.id });
    queueReport(target.kind, target.id, reason);
    setStep('filed');
  };

  const blockThem = () => {
    dispatch({ type: 'BLOCK', id: target.who });
    queueBlock(target.who);
    close();
  };

  return (
    <Overlay
      zIndex={57}
      background={color.scrim}
      onRequestClose={close}
      style={{ justifyContent: 'flex-end' }}
    >
      <Animated.View
        style={{
          maxHeight: '86%',
          backgroundColor: color.paper,
          borderTopLeftRadius: radius.sheet,
          borderTopRightRadius: radius.sheet,
          overflow: 'hidden',
          transform: [
            { translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [0, 600] }) },
          ],
        }}
      >
        {/* No tap-outside-to-dismiss layer, unlike the detail sheet. This sheet
            is short and every one of its exits is labelled; a stray tap on the
            scrim throwing away a half-picked reason is a small cruelty on a
            screen somebody is already annoyed to be on. Back and Escape still
            close it, through <Overlay>. */}
        <View style={[row, { paddingTop: 10, paddingHorizontal: 14 }]}>
          <View style={fill}>
            <View
              style={{
                width: 38,
                height: 4,
                borderRadius: 999,
                backgroundColor: color.divider,
                alignSelf: 'center',
                marginLeft: 40,
              }}
            />
          </View>
          <Tap
            onPress={close}
            accessibilityLabel="Close report"
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              backgroundColor: color.chip,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="close" size={15} color={color.textPrimary} />
          </Tap>
        </View>

        <ScrollView
          style={{ flexShrink: 1 }}
          contentContainerStyle={{ paddingTop: 8, paddingHorizontal: 18, paddingBottom: 26 }}
        >
          <View style={[row, { gap: 11, marginBottom: 12 }]}>
            <Avatar who={target.who} size={38} />
            <View style={fill}>
              <Bri size={19} weight={800} tracking={-0.3}>
                {step === 'confirmBlock' ? `Block ${name}?` : SUBJECT_TITLE[target.kind]}
              </Bri>
              <Sans size={12.5} color={color.muted}>
                {step === 'confirmBlock' ? 'Second, separate decision' : name}
              </Sans>
            </View>
          </View>

          {step === 'reason' ? (
            <ReasonStep reason={reason} onPick={setReason} onFile={fileIt} onCancel={close} />
          ) : null}

          {step === 'filed' ? (
            <FiledStep
              kind={target.kind}
              first={first}
              name={name}
              blockable={blockable}
              onBlock={() => setStep('confirmBlock')}
              onDone={close}
            />
          ) : null}

          {step === 'confirmBlock' ? (
            <BlockStep first={first} onConfirm={blockThem} onBack={() => setStep('filed')} />
          ) : null}
        </ScrollView>
      </Animated.View>
    </Overlay>
  );
}

/* ── step one: what is wrong ─────────────────────────────────────────────── */

function ReasonStep({
  reason,
  onPick,
  onFile,
  onCancel,
}: {
  reason: ReportReason | null;
  onPick: (r: ReportReason) => void;
  onFile: () => void;
  onCancel: () => void;
}) {
  const color = useColors();
  return (
    <View>
      <Sans size={13} color={color.muted} lineHeight={18.5} style={{ marginBottom: 12 }}>
        Pick the closest one. Nobody is told that you did this.
      </Sans>

      <View style={{ gap: 7 }}>
        {REASONS.map((r) => {
          const on = reason === r.value;
          return (
            <Tap
              key={r.value}
              onPress={() => onPick(r.value)}
              accessibilityLabel={r.label}
              accessibilityState={{ selected: on }}
              style={{
                ...row,
                gap: 10,
                minHeight: 46,
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: radius.chip,
                backgroundColor: on ? color.lime : color.card,
              }}
            >
              <Sans size={14} weight={600} style={fill}>
                {r.label}
              </Sans>
              {on ? <Icon name="check" size={15} color={onLight} /> : null}
            </Tap>
          );
        })}
      </View>

      <View style={{ gap: 8, marginTop: 16 }}>
        <Tap
          onPress={onFile}
          accessibilityLabel="File this report"
          accessibilityState={{ disabled: !reason }}
          style={{
            ...primaryButton,
            backgroundColor: reason ? color.ink : color.disabledFill,
          }}
        >
          <Sans size={13.5} weight={700} color={reason ? color.lime : color.muted}>
            Report it
          </Sans>
        </Tap>
        <Tap onPress={onCancel} accessibilityLabel="Cancel" style={quietButton}>
          <Sans size={13.5} weight={600} color={color.muted}>
            Cancel
          </Sans>
        </Tap>
      </View>
    </View>
  );
}

/* ── step two: what just happened ────────────────────────────────────────── */

/**
 * Deliberately different for a profile report, because the true sentence is
 * different. Reporting a task or a note hides that task or that note; reporting
 * a *person* hides nothing, since a person is not a piece of content and the
 * thing that stops you seeing them is a block. Saying "it's hidden from you" on
 * all three would be the easy copy and a lie on one of them — and the user
 * would find out by scrolling.
 */
function FiledStep({
  kind,
  first,
  name,
  blockable,
  onBlock,
  onDone,
}: {
  kind: ReportTarget['kind'];
  first: string;
  name: string;
  blockable: boolean;
  onBlock: () => void;
  onDone: () => void;
}) {
  const color = useColors();
  return (
    <View>
      {kind === 'profile' ? (
        <Sans size={14} lineHeight={20} style={{ marginBottom: 10 }}>
          Filed. Nobody is told you filed it.
        </Sans>
      ) : (
        <Sans size={14} lineHeight={20} style={{ marginBottom: 10 }}>
          Filed, and hidden from you. It stays hidden on this phone — the hiding
          is local, so signing in somewhere else will show it again. Nobody is
          told you filed it.
        </Sans>
      )}

      <Sans size={13} color={color.muted} lineHeight={18.5}>
        There is no moderation team behind this. The report is a record; it may
        sit unread, and nothing may come of it. If the person is the problem
        rather than one post, the next part is what changes your week.
      </Sans>

      {kind === 'profile' ? (
        <Sans size={13} color={color.muted} lineHeight={18.5} style={{ marginTop: 10 }}>
          Reporting does not hide {first}. Blocking does.
        </Sans>
      ) : null}

      <View style={{ gap: 8, marginTop: 16 }}>
        {blockable ? (
          <Tap
            onPress={onBlock}
            accessibilityLabel={`Block ${name}`}
            style={{ ...primaryButton, backgroundColor: color.chip }}
          >
            <Sans size={13.5} weight={700}>
              Block {first} too
            </Sans>
          </Tap>
        ) : null}
        <Tap onPress={onDone} accessibilityLabel="Done" style={quietButton}>
          <Sans size={13.5} weight={600} color={color.muted}>
            Done
          </Sans>
        </Tap>
      </View>
    </View>
  );
}

/* ── step three: the block, and what it does not do ──────────────────────── */

function BlockStep({
  first,
  onConfirm,
  onBack,
}: {
  first: string;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const color = useColors();
  return (
    <View>
      <Sans size={14} lineHeight={20}>
        You stop seeing {first} — their week, their notes, their cheers. They
        stop seeing yours. Neither of you is told.
      </Sans>

      {/* The sentence this sheet exists to say. See the file header: without it
          a working block looks broken within about ten seconds. */}
      <Sans size={13} color={color.muted} lineHeight={18.5} style={{ marginTop: 10 }}>
        Your circles are a separate thing. {first} stays in the ones you share
        — still on the ranked list, still counted in the circle’s totals,
        because those are the circle’s numbers and not your view of it. Blocking
        cannot change that; leaving a circle is what changes that, and Settings
        is where you do it.
      </Sans>

      <View style={{ gap: 8, marginTop: 16 }}>
        <Tap
          onPress={onConfirm}
          accessibilityLabel="Confirm block"
          style={{ ...primaryButton, backgroundColor: color.ink }}
        >
          <Sans size={13.5} weight={700} color={color.lime}>
            Block {first}
          </Sans>
        </Tap>
        <Tap onPress={onBack} accessibilityLabel="Not now" style={quietButton}>
          <Sans size={13.5} weight={600} color={color.muted}>
            Not now
          </Sans>
        </Tap>
      </View>
    </View>
  );
}

/* ── shared ──────────────────────────────────────────────────────────────── */

const primaryButton = {
  minHeight: 46,
  borderRadius: radius.chip,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};

const quietButton = {
  ...primaryButton,
  backgroundColor: 'transparent',
};
