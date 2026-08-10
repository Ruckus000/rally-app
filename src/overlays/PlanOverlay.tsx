/**
 * Plan — a full-screen action, not a destination. Stake points on the week.
 */
import React from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { color, gradientAngle, onDark, planGutter, shadows } from '../theme/tokens';
import {
  AUDIENCE_LABEL,
  AUDIENCE_WORD,
  AUDIENCES,
  CATEGORIES,
  CATEGORY_HINT,
  CATEGORY_POINTS,
  FIRST,
  FRIENDS,
  ME,
  SUGGESTIONS,
} from '../data/fixtures';
import { CURRENT_WEEK, DAY_NAMES, DayIndex } from '../data/week';
import { useStore } from '../state/store';
import { stakedPoints } from '../state/selectors';
import { Avatar, FaceStack } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Bri, Caps, GlowBloom, GradientHairline, Sans, Tap, fill, row } from '../components/primitives';
import { Overlay } from './Overlay';

export function PlanOverlay({ topInset, bottomInset }: { topInset: number; bottomInset: number }) {
  const { state, dispatch, effectiveAudience } = useStore();
  const onboarding = state.onboardStep === 'plan';

  const staked = stakedPoints(state);
  const best = ME.bestWeekPoints;
  const over = staked >= best;
  const draftDay = (state.draftDay ?? state.day) as DayIndex;
  const hasDraft = !!state.draft.trim();
  const draftPoints = CATEGORY_POINTS[state.draftCat] ?? 30;

  const close = () =>
    onboarding ? dispatch({ type: 'SKIP_ONBOARD' }) : dispatch({ type: 'CLOSE_PLAN' });

  return (
    <Overlay zIndex={45} background={color.planBg} onRequestClose={close}>
      <GlowBloom size={320} top={-130} right={-100} opacity={0.2} />

      <View
        style={{
          ...row,
          gap: 12,
          paddingTop: Math.max(topInset, 20) + 12,
          paddingHorizontal: planGutter,
        }}
      >
        <Tap
          onPress={close}
          accessibilityLabel="Close plan"
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            borderWidth: 1,
            borderColor: 'rgba(241,242,236,.16)',
            backgroundColor: 'rgba(241,242,236,.06)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="chevronLeft" size={15} color={color.paper} />
        </Tap>
        <View style={fill}>
          <Caps size={10} tracking={1.9} color={onDark.secondary}>
            {onboarding
              ? 'One thing to start'
              : `Week ${CURRENT_WEEK.number} · ${CURRENT_WEEK.daysLeft} days left`}
          </Caps>
          <Bri size={20} weight={800} tracking={-0.5} color={color.paper} style={{ marginTop: 2 }}>
            {onboarding ? 'Add your first task' : 'Plan your week'}
          </Bri>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 18, paddingHorizontal: planGutter, paddingBottom: 10 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* hero */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 11 }}>
          <Bri
            size={76}
            weight={800}
            tracking={-3.5}
            lineHeight={61}
            color={color.lime}
            style={{ textShadowColor: 'rgba(195,245,60,.32)', textShadowRadius: 44 }}
          >
            {staked}
          </Bri>
          <View style={{ paddingBottom: 7 }}>
            <Bri size={16} weight={800} lineHeight={16} color={onDark.bodySecondary}>
              pts
            </Bri>
            <Caps size={10} tracking={1.7} color={onDark.secondary} style={{ marginTop: 3 }}>
              Staked this week
            </Caps>
          </View>
        </View>

        <View
          style={{
            marginTop: 16,
            height: 9,
            borderRadius: 999,
            backgroundColor: 'rgba(241,242,236,.09)',
            overflow: 'hidden',
          }}
        >
          <LinearGradient
            colors={['#6E9418', color.lime]}
            {...gradientAngle(90)}
            style={{
              height: '100%',
              width: `${Math.min(100, (staked / best) * 100)}%`,
              borderRadius: 999,
            }}
          />
        </View>

        <View style={[row, { justifyContent: 'space-between', gap: 12, marginTop: 9 }]}>
          <Sans size={12.5} lineHeight={17} color={onDark.secondary} style={fill}>
            {over
              ? 'The biggest week you’ve ever put on the line.'
              : `${best - staked} pts short of Week 31 — your best week ever.`}
          </Sans>
          <Tap
            onPress={() => dispatch({ type: 'GO_PLACE', patch: { tab: 'me' } })}
            accessibilityLabel="See your best week"
            style={{
              borderRadius: 999,
              paddingHorizontal: 11,
              paddingVertical: 6,
              minHeight: 32,
              justifyContent: 'center',
              backgroundColor: over ? color.lime : 'rgba(241,242,236,.07)',
            }}
          >
            <Bri size={10} weight={800} tracking={1} color={over ? color.ink : onDark.secondary}>
              {over ? 'NEW BEST' : `BEST ${best}`}
            </Bri>
          </Tap>
        </View>

        {/* composer */}
        <GradientHairline radius={27} variant="composer" style={{ marginTop: 24 }}>
          <View
            style={{
              backgroundColor: color.planCard,
              borderRadius: 26,
              paddingTop: 17,
              paddingHorizontal: 16,
              paddingBottom: 16,
            }}
          >
            <Caps size={10} tracking={2.2} color={color.lime}>
              I will…
            </Caps>
            <TextInput
              value={state.draft}
              onChangeText={(value) => dispatch({ type: 'SET_DRAFT', value })}
              onSubmitEditing={() => dispatch({ type: 'ADD_TASK', aud: effectiveAudience })}
              placeholder={CATEGORY_HINT[state.draftCat] ?? 'name it in your own words'}
              placeholderTextColor={onDark.tertiary}
              selectionColor={color.lime}
              cursorColor={color.lime}
              returnKeyType="done"
              accessibilityLabel="What will you do?"
              multiline
              style={{
                marginTop: 9,
                fontFamily: 'BricolageGrotesque_800ExtraBold',
                fontSize: 23,
                letterSpacing: -0.6,
                lineHeight: 28,
                color: color.paper,
                paddingVertical: 2,
              }}
            />
            <View style={{ height: 1, backgroundColor: onDark.hairline, marginTop: 12, marginBottom: 14 }} />

            {/* day picker — each cell shows the day initial and what's already staked */}
            <View style={{ flexDirection: 'row', gap: 5 }}>
              {DAY_NAMES.map((name, i) => {
                const count = state.myTasks.filter((t) => t.day === i).length;
                const on = draftDay === i;
                return (
                  <Tap
                    key={name}
                    onPress={() => dispatch({ type: 'SET_DRAFT_DAY', day: i as DayIndex })}
                    accessibilityLabel={`${name}, ${count} staked`}
                    accessibilityState={{ selected: on }}
                    style={{
                      flex: 1,
                      borderRadius: 12,
                      paddingTop: 8,
                      paddingBottom: 7,
                      minHeight: 44,
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 3,
                      borderWidth: 1,
                      borderColor: on ? 'rgba(195,245,60,.75)' : 'rgba(241,242,236,.09)',
                      backgroundColor: on ? 'rgba(195,245,60,.16)' : 'rgba(241,242,236,.035)',
                    }}
                  >
                    <Bri size={11.5} weight={800} lineHeight={12} color={on ? color.lime : 'rgba(241,242,236,.58)'}>
                      {name.slice(0, 1)}
                    </Bri>
                    <Bri size={9} weight={700} lineHeight={10} color={on ? color.lime : 'rgba(241,242,236,.45)'}>
                      {count ? String(count) : '·'}
                    </Bri>
                  </Tap>
                );
              })}
            </View>

            {/* category determines points */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 12 }}>
              {CATEGORIES.map((c) => {
                const on = state.draftCat === c;
                return (
                  <Tap
                    key={c}
                    onPress={() => dispatch({ type: 'SET_DRAFT_CAT', cat: c })}
                    accessibilityLabel={`${c}, ${CATEGORY_POINTS[c]} points`}
                    accessibilityState={{ selected: on }}
                    style={{
                      borderRadius: 999,
                      paddingHorizontal: 13,
                      paddingVertical: 8,
                      minHeight: 36,
                      justifyContent: 'center',
                      borderWidth: 1,
                      borderColor: on ? 'transparent' : 'rgba(241,242,236,.12)',
                      backgroundColor: on ? color.lime : 'rgba(241,242,236,.05)',
                    }}
                  >
                    <Sans size={12.5} weight={700} color={on ? color.ink : 'rgba(241,242,236,.70)'}>
                      {c}
                    </Sans>
                  </Tap>
                );
              })}
            </View>

            {/* SEEN BY — a segmented control. It's a privacy setting, so every
                option stays visible rather than cycling through one chip. */}
            <SectionRule label="Seen by">
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {onboarding && !state.seenTooltip ? <AudienceTooltip /> : null}
                {AUDIENCES.map((a) => {
                  const on = effectiveAudience === a;
                  return (
                    <Tap
                      key={a}
                      onPress={() => dispatch({ type: 'SET_DRAFT_AUD', aud: a })}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`Seen by ${AUDIENCE_WORD[a]}`}
                      style={{
                        borderRadius: 999,
                        paddingHorizontal: 11,
                        paddingVertical: 8,
                        minHeight: 36,
                        justifyContent: 'center',
                        borderWidth: 1,
                        borderColor: on ? 'transparent' : 'rgba(241,242,236,.14)',
                        backgroundColor: on ? color.lime : 'rgba(241,242,236,.05)',
                      }}
                    >
                      <Sans size={11.5} weight={700} color={on ? color.ink : 'rgba(241,242,236,.75)'}>
                        {AUDIENCE_WORD[a]}
                      </Sans>
                    </Tap>
                  );
                })}
              </View>
            </SectionRule>

            <SectionRule label="In it with me" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 9 }}>
              {FRIENDS.map((k) => {
                const on = state.draftPair.includes(k);
                return (
                  <Tap
                    key={k}
                    onPress={() => dispatch({ type: 'TOGGLE_PAIR', key: k })}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`In it with ${FIRST[k]}`}
                    style={{
                      ...row,
                      gap: 7,
                      borderRadius: 999,
                      paddingLeft: 5,
                      paddingRight: 12,
                      paddingVertical: 5,
                      minHeight: 36,
                      borderWidth: 1,
                      borderColor: on ? 'rgba(195,245,60,.7)' : 'rgba(241,242,236,.10)',
                      backgroundColor: on ? 'rgba(195,245,60,.14)' : 'rgba(241,242,236,.04)',
                    }}
                  >
                    <Avatar who={k} size={20} />
                    <Sans size={12.5} weight={700} color={on ? color.lime : 'rgba(241,242,236,.72)'}>
                      {FIRST[k]}
                    </Sans>
                  </Tap>
                );
              })}
            </View>
            <Sans size={11.5} lineHeight={16} color={onDark.secondary} style={{ marginTop: 9 }}>
              {state.draftPair.length
                ? `${state.draftPair.map((k) => FIRST[k]).join(' and ')} will see this land — and notice if it doesn’t.`
                : 'Nobody’s watching this one yet.'}
            </Sans>

            <Tap
              onPress={() => dispatch({ type: 'ADD_TASK', aud: effectiveAudience })}
              disabled={!hasDraft}
              accessibilityState={{ disabled: !hasDraft }}
              style={{
                height: 50,
                borderRadius: 16,
                marginTop: 16,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: hasDraft ? color.lime : 'rgba(241,242,236,.07)',
                ...(hasDraft ? shadows.addCta : null),
              }}
            >
              <Bri size={15.5} weight={800} color={hasDraft ? color.ink : 'rgba(241,242,236,.35)'}>
                {hasDraft
                  ? `Stake it on ${DAY_NAMES[draftDay]} · +${draftPoints} pts`
                  : 'Write it down first'}
              </Bri>
            </Tap>
          </View>
        </GradientHairline>

        {/* pick it back up */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 10,
            marginTop: 26,
            marginHorizontal: 2,
          }}
        >
          <Caps size={10} tracking={1.9} color={onDark.secondary}>
            Pick it back up
          </Caps>
          <Sans size={11} weight={600} color={onDark.tertiary}>
            one tap stakes it
          </Sans>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -planGutter }}
          contentContainerStyle={{ gap: 10, paddingTop: 11, paddingBottom: 3, paddingHorizontal: planGutter }}
        >
          {SUGGESTIONS.map((s) => {
            const used = !!state.usedSugg[s.id];
            return (
              <View
                key={s.id}
                style={{
                  width: 186,
                  borderRadius: 20,
                  paddingTop: 13,
                  paddingHorizontal: 13,
                  paddingBottom: 12,
                  backgroundColor: used ? 'rgba(195,245,60,.08)' : 'rgba(241,242,236,.05)',
                  borderWidth: 1,
                  borderColor: used ? 'rgba(195,245,60,.35)' : 'rgba(241,242,236,.08)',
                }}
              >
                <View style={[row, { gap: 6 }]}>
                  {s.pair?.length ? <FaceStack people={s.pair} size={20} ringColor={color.planCard} /> : null}
                  <Caps size={9} tracking={1.3} color={used ? color.lime : onDark.secondary} numberOfLines={1} style={fill}>
                    {s.tag}
                  </Caps>
                </View>
                <Bri size={15.5} weight={800} tracking={-0.3} lineHeight={18} color={color.paper} style={{ marginTop: 10 }}>
                  {s.title}
                </Bri>
                <Sans size={11.5} lineHeight={16} color={onDark.secondary} style={[fill, { marginTop: 6 }]}>
                  {s.sub}
                </Sans>
                <Tap
                  onPress={() => dispatch({ type: 'ADD_SUGGESTION', suggestion: s })}
                  disabled={used}
                  accessibilityLabel={used ? `${s.title} staked` : `Stake ${s.title} for ${s.pts} points`}
                  style={{
                    marginTop: 12,
                    borderRadius: 999,
                    minHeight: 36,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: used ? 'rgba(195,245,60,.16)' : color.lime,
                  }}
                >
                  <Bri size={12.5} weight={800} color={used ? color.lime : color.ink}>
                    {used ? 'Staked ✓' : `Stake +${s.pts}`}
                  </Bri>
                </Tap>
              </View>
            );
          })}
        </ScrollView>

        {/* staked list */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 10,
            marginTop: 26,
            marginHorizontal: 2,
            marginBottom: 10,
          }}
        >
          <Caps size={10} tracking={1.9} color={onDark.secondary}>
            Staked · {state.myTasks.length}
          </Caps>
          <Sans size={11} weight={600} color={onDark.tertiary}>
            tap a chip to change who sees it
          </Sans>
        </View>

        <View style={{ gap: 7 }}>
          {[...state.myTasks]
            .sort((a, b) => a.day - b.day)
            .map((t) => (
              <View
                key={t.id}
                style={{
                  ...row,
                  gap: 10,
                  backgroundColor: 'rgba(241,242,236,.05)',
                  borderWidth: 1,
                  borderColor: 'rgba(241,242,236,.07)',
                  borderRadius: 18,
                  paddingVertical: 11,
                  paddingHorizontal: 13,
                }}
              >
                <Bri size={10} weight={800} tracking={0.6} color={onDark.secondary} style={{ width: 30 }}>
                  {DAY_NAMES[t.day].slice(0, 3).toUpperCase()}
                </Bri>
                <Tap
                  onPress={() => dispatch({ type: 'OPEN_SHEET', sheet: { type: 'task', id: t.id } })}
                  minSize={0}
                  style={fill}
                >
                  <Sans size={14} weight={600} lineHeight={17.5} color={color.paper}>
                    {t.title}
                  </Sans>
                </Tap>
                {t.pair.length ? <FaceStack people={t.pair} size={20} ringColor={color.planCard} /> : null}
                <Tap
                  onPress={() => dispatch({ type: 'CYCLE_TASK_AUD', id: t.id })}
                  accessibilityLabel={`Seen by ${AUDIENCE_WORD[t.aud]}. Change.`}
                  style={{
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    minHeight: 36,
                    justifyContent: 'center',
                    backgroundColor: 'rgba(241,242,236,.08)',
                  }}
                >
                  <Sans size={10.5} weight={700} color={onDark.bodySecondary}>
                    {AUDIENCE_LABEL[t.aud]}
                  </Sans>
                </Tap>
                <Bri size={13} weight={800} color={color.lime}>
                  +{t.pts}
                </Bri>
                <Tap
                  onPress={() => dispatch({ type: 'REMOVE_TASK', id: t.id })}
                  accessibilityLabel={`Unstake ${t.title}`}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="close" size={13} color={onDark.secondary} />
                </Tap>
              </View>
            ))}

          {state.myTasks.length === 0 ? (
            <View
              style={{
                borderWidth: 1,
                borderStyle: 'dashed',
                borderColor: 'rgba(241,242,236,.15)',
                borderRadius: 16,
                paddingVertical: 16,
                paddingHorizontal: 10,
              }}
            >
              <Sans size={12.5} color={onDark.secondary} style={{ textAlign: 'center' }}>
                Nothing staked yet — name one above and put points on it.
              </Sans>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* footer with gradient scrim */}
      <LinearGradient
        colors={['rgba(18,23,15,0)', color.planBg]}
        locations={[0, 0.38]}
        style={{ paddingTop: 14, paddingHorizontal: planGutter, paddingBottom: Math.max(bottomInset, 20) + 14 }}
      >
        <Tap
          onPress={() => {
            if (onboarding) {
              dispatch({ type: 'FINISH_ONBOARD' });
              return;
            }
            dispatch({ type: 'GO_PLACE', patch: { tab: 'week', scope: 'personal' } });
            dispatch({ type: 'TOAST', message: `${staked} pts on the line` });
          }}
          style={{
            minHeight: 54,
            borderRadius: 17,
            backgroundColor: color.lime,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 9,
            ...shadows.doneCta,
          }}
        >
          <Bri size={16} weight={800} color={color.ink}>
            {onboarding ? 'Start my week' : 'Done — into the week'}
          </Bri>
          <Sans size={12.5} weight={700} color={color.ink} style={{ opacity: 0.55 }}>
            {staked} pts at stake
          </Sans>
        </Tap>
      </LinearGradient>
    </Overlay>
  );
}

function SectionRule({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <View style={[row, { gap: 9, marginTop: 16 }]}>
      <Caps size={10} tracking={1.5} color={onDark.secondary}>
        {label}
      </Caps>
      <View style={{ height: 1, flex: 1, backgroundColor: 'rgba(241,242,236,.08)' }} />
      {children}
    </View>
  );
}

/** First-run explanation of the privacy control. */
function AudienceTooltip() {
  const { dispatch } = useStore();
  return (
    <View
      style={[
        {
          position: 'absolute',
          top: 42,
          right: 0,
          width: 248,
          zIndex: 5,
          backgroundColor: color.lime,
          borderRadius: 14,
          paddingVertical: 12,
          paddingHorizontal: 13,
        },
        shadows.tooltip,
      ]}
    >
      <View
        style={{
          position: 'absolute',
          top: -6,
          right: 26,
          width: 12,
          height: 12,
          backgroundColor: color.lime,
          transform: [{ rotate: '45deg' }],
        }}
      />
      <Sans size={12.5} lineHeight={17.5} color={color.ink}>
        <Sans size={12.5} weight={700} color={color.ink}>
          Friends
        </Sans>
        {' means your circle can cheer you on. Switch it any time — it counts toward your week either way.'}
      </Sans>
      <Tap
        onPress={() => dispatch({ type: 'DISMISS_TOOLTIP' })}
        style={{ alignSelf: 'flex-end', marginTop: 8, padding: 2, minHeight: 32, justifyContent: 'center' }}
      >
        <Sans size={12} weight={700} color={color.avatarText}>
          Got it
        </Sans>
      </Tap>
    </View>
  );
}
