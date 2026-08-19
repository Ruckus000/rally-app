/**
 * Step 3 — the first stake. Pick a handful of commitments, watch the points
 * add up, put them on the line.
 *
 * This deliberately replaces PlanOverlay's `onboardStep === 'plan'` mode, and
 * it is a real scope reduction: no day picker, no category chips, no audience
 * control, no pairing. Onboarding asks only "what" — when, who sees it and who
 * you're doing it with are decisions you make once you're inside the week, on
 * a screen that has room to explain them. PlanOverlay keeps all of it for
 * everyday planning; only the first-run path comes here instead.
 */
import React, { useRef, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { color, heroGlow, onDark } from '../../theme/tokens';
import { TITLE_MAX } from '../../data/fixtures';
import { Icon } from '../../components/Icon';
import { Bri, Caps, GlowBloom, Sans, Tap, row } from '../../components/primitives';
import { CommitmentRow, PillButton } from './kit';
import { IntentId, Suggestion, pool } from './data';

/** What a commitment you wrote yourself is worth, from the design. */
const CUSTOM_FREQ = 'this week';
const CUSTOM_PTS = 25;

export function StakeScreen({
  intents,
  picks,
  custom,
  onTogglePick,
  onAddCustom,
  onNext,
}: {
  intents: IntentId[];
  picks: string[];
  custom: Suggestion[];
  onTogglePick: (id: string) => void;
  /**
   * The screen mints the whole Suggestion so the design's freq/points live
   * beside the input that produces them. The caller appends it to `custom`
   * *and* to `picks` — anything you bothered to type is already chosen.
   */
  onAddCustom: (suggestion: Suggestion) => void;
  onNext: () => void;
}) {
  const [draft, setDraft] = useState('');
  // Date.now() alone collides if you add two in the same millisecond, which a
  // paste-and-tap can do.
  const seq = useRef(0);

  const rows = pool(intents, custom);
  const picked = rows.filter((r) => picks.includes(r.id));
  const staked = picked.reduce((sum, r) => sum + r.pts, 0);

  const add = () => {
    const title = draft.trim();
    if (!title) return;
    seq.current += 1;
    onAddCustom({
      id: `x${Date.now().toString(36)}${seq.current}`,
      title,
      freq: CUSTOM_FREQ,
      pts: CUSTOM_PTS,
    });
    setDraft('');
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.planBg }}>
      <GlowBloom size={320} top={-130} right={-100} opacity={0.2} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 14, paddingHorizontal: 22, paddingBottom: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        <Caps size={10} tracking={1.9} color={onDark.secondary}>
          Step 3 of 5 · Your first stake
        </Caps>
        <Bri
          size={29}
          weight={800}
          tracking={-0.9}
          lineHeight={31.5}
          color={color.paper}
          style={{ marginTop: 8 }}
        >
          What will you close this week?
        </Bri>

        {/* points hero */}
        <View
          accessible
          accessibilityLabel={`${staked} points staked so far`}
          style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 11, marginTop: 20 }}
        >
          <Bri size={64} weight={800} tracking={-3} lineHeight={68} color={color.lime} style={heroGlow}>
            {staked}
          </Bri>
          <View style={{ paddingBottom: 6 }}>
            <Bri size={15} weight={800} lineHeight={15} color={onDark.bodySecondary}>
              pts
            </Bri>
            <Caps size={10} tracking={1.6} color={onDark.secondary} style={{ marginTop: 3 }}>
              Staked so far
            </Caps>
          </View>
        </View>

        <Caps size={10} tracking={2.2} color={color.lime} style={{ marginTop: 20 }}>
          I will…
        </Caps>

        <View style={[row, { gap: 8, marginTop: 11 }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={add}
            // Enter adds a commitment and leaves you on the field for the next
            // one, so the keyboard must not dismiss itself.
            blurOnSubmit={false}
            returnKeyType="done"
            // The cap every other composer carries — a first-run user could
            // otherwise mint a title that breaks every row downstream.
            maxLength={TITLE_MAX}
            placeholder="Add your own…"
            placeholderTextColor={onDark.tertiary}
            selectionColor={color.lime}
            cursorColor={color.lime}
            accessibilityLabel="Add your own commitment"
            style={{
              flex: 1,
              minWidth: 0,
              height: 46,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: 'rgba(241,242,236,.14)',
              backgroundColor: onDark.fill,
              paddingHorizontal: 15,
              fontFamily: 'InstrumentSans_400Regular',
              fontSize: 13.5,
              color: color.paper,
            }}
          />
          <Tap
            onPress={add}
            accessibilityLabel="Add commitment"
            style={{
              width: 46,
              height: 46,
              borderRadius: 14,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: 'rgba(195,245,60,.4)',
              backgroundColor: 'rgba(195,245,60,.1)',
            }}
          >
            <Icon name="plus" size={16} color={color.lime} strokeWidth={2.4} />
          </Tap>
        </View>

        <View style={{ gap: 8, marginTop: 8 }}>
          {rows.map((r) => (
            <CommitmentRow
              key={r.id}
              title={r.title}
              freq={r.freq}
              pts={r.pts}
              selected={picks.includes(r.id)}
              onPress={() => onTogglePick(r.id)}
            />
          ))}
        </View>

        {/* `.45` is the handoff's hard floor for text on dark; this line was
            authored at .4 and is advice, not decoration. */}
        <Sans size={11.5} lineHeight={17} color={onDark.tertiary} style={{ marginTop: 14 }}>
          Start small — two or three is a real week. You can add more anytime.
        </Sans>
      </ScrollView>

      <View style={{ paddingTop: 10, paddingHorizontal: 22, paddingBottom: 30 }}>
        <PillButton
          dark
          label={picked.length ? `Stake ${staked} pts` : 'Pick at least one'}
          disabled={!picked.length}
          onPress={onNext}
        />
      </View>
    </View>
  );
}
