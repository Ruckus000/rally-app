/**
 * The bottom sheet: task, person and invite variants.
 *
 * The prototype's drag handle is decorative and it closed on scrim tap only.
 * The build keeps the handle, adds a real close button, and wires Escape and
 * hardware back through <Overlay>.
 */
import React, { useEffect, useState } from 'react';
import { Animated, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { color, radius } from '../theme/tokens';
import {
  AUDIENCE_LABEL,
  GLOBAL_POSTS,
  ME,
  Note,
  PERSON_NOTES,
  PERSON_TASKS,
  Task,
} from '../data/fixtures';
import { useStore } from '../state/store';
import { myStats } from '../state/selectors';
import { SHEET_DURATION, sheetEasing, useReducedMotion } from '../theme/motion';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Bri, Caps, Sans, Tap, fill, row } from '../components/primitives';
import { Overlay } from './Overlay';
import type { PersonId } from '../data/people';

export function DetailSheet({ bottomInset }: { bottomInset: number }) {
  const { state, dispatch } = useStore();
  const sheet = state.sheet;
  const reduced = useReducedMotion();
  const [slide] = useState(() => new Animated.Value(1));

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
  }, [sheet?.type, sheet?.id, reduced, slide]);

  if (!sheet) return null;
  const close = () => dispatch({ type: 'CLOSE_SHEET' });
  const hasComposer = sheet.type === 'task' || sheet.type === 'person';

  return (
    <Overlay zIndex={50} background="rgba(16,20,8,.42)" onRequestClose={close} style={{ justifyContent: 'flex-end' }}>
      {/* Tap-outside-to-dismiss. Hidden from the accessibility tree: it would
          otherwise announce as a second, identical "Close" control, and screen
          reader users have the real button below plus back/Escape. */}
      <Pressable
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        onPress={close}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

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
        <View style={[row, { paddingTop: 10, paddingHorizontal: 14 }]}>
          <View style={fill}>
            <View
              style={{
                width: 38,
                height: 4,
                borderRadius: 999,
                backgroundColor: 'rgba(25,30,22,.18)',
                alignSelf: 'center',
                marginLeft: 40,
              }}
            />
          </View>
          <Tap
            onPress={close}
            accessibilityLabel="Close"
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              backgroundColor: color.chip,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="close" size={15} color={color.ink} />
          </Tap>
        </View>

        {sheet.type === 'task' ? <TaskSheet id={sheet.id!} /> : null}
        {sheet.type === 'person' ? <PersonSheet who={sheet.id!} /> : null}
        {sheet.type === 'invite' ? <InviteSheet /> : null}

        {hasComposer ? <NoteComposer bottomInset={bottomInset} /> : null}
      </Animated.View>
    </Overlay>
  );
}

/* ── task ───────────────────────────────────────────────────────────────── */

function TaskSheet({ id }: { id: string }) {
  const { state, dispatch, people } = useStore();

  const mine = state.myTasks.find((x) => x.id === id);
  const moment = state.moments.find((x) => x.id === id);
  const global = GLOBAL_POSTS.find((x) => x.id === id);
  const raw = mine ?? moment ?? global;
  if (!raw) return null;

  const who = mine ? state.selfId : moment?.who;
  const name = global?.name ?? (who ? people.name(who) : '');
  const initials = global?.ini ?? (who ? people.initials(who) : '?');
  const tintColor = global?.tint ?? (who ? people.tint(who) : color.chip);
  const first = global ? global.name.replace('@', '') : who ? people.first(who) : '';
  // A public post has no thread of its own — what we can show is what you said.
  const cmts: Note[] = (mine?.cmts ?? moment?.cmts ?? state.globalNotes[id] ?? []) as Note[];
  const pts = mine?.pts ?? moment?.pts;
  const title = 'title' in raw ? (raw.title ?? '') : '';

  const meta = mine
    ? `${mine.cat}${mine.aud !== 'friends' ? ` · ${AUDIENCE_LABEL[mine.aud]}` : ''}`
    : `${(moment ?? global)?.time} ago`;

  const isAsk = moment?.kind === 'ask';
  const actions = mine
    ? []
    : isAsk
      ? [{ k: 'in', off: 'Sit with him', on: 'You’re in ✓', toast: `${first} knows you’re coming` }]
      : [
          { k: 'cheer', off: `Cheer ${first}`, on: 'Cheered ✓', toast: `${first} heard that` },
          { k: 'cosign', off: 'I’m in on this', on: 'You’re in ✓', toast: `You’re in with ${first}` },
        ];

  return (
    <ScrollView
      style={{ flexShrink: 1 }}
      contentContainerStyle={{ paddingTop: 10, paddingHorizontal: 18, paddingBottom: 12 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[row, { gap: 11 }]}>
        <Avatar who={global ? undefined : who} initials={initials} tint={tintColor} label={name} size={42} />
        <View style={fill}>
          <Sans size={15} weight={600}>
            {name}
          </Sans>
          <Sans size={12} color={color.muted}>
            {meta}
          </Sans>
        </View>
        {pts ? (
          <View style={{ backgroundColor: color.limeTintChip, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 }}>
            <Bri size={13} weight={800} color={color.moss}>
              +{pts}
            </Bri>
          </View>
        ) : null}
      </View>

      <Bri size={21} weight={700} tracking={-0.3} lineHeight={25} style={{ marginTop: 12, marginBottom: 4 }}>
        {title}
      </Bri>

      {mine && mine.aud === 'private' ? (
        <Sans size={12.5} color={color.muted} style={{ marginBottom: 6 }}>
          🔒{' '}
          {mine.pair.length
            ? `Only visible to you and ${mine.pair.map((k) => people.first(k)).join(', ')}`
            : 'Only visible to you'}
        </Sans>
      ) : null}

      {mine && mine.pairKind === 'joint' ? <JointProgress task={mine} /> : null}

      {/* Your own stake is editable — the one thing the prototype couldn't do. */}
      {mine ? (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 13, flexWrap: 'wrap' }}>
          <Tap
            onPress={() => dispatch({ type: 'START_EDIT', id: mine.id })}
            accessibilityLabel={`Edit ${mine.title}`}
            style={sheetChip(color.chip)}
          >
            <Sans size={12.5} weight={600}>
              Edit this
            </Sans>
          </Tap>
          <Tap
            onPress={() => dispatch({ type: 'TOGGLE_TASK', id: mine.id })}
            accessibilityLabel={mine.done ? `Reopen ${mine.title}` : `Close ${mine.title}`}
            style={sheetChip(mine.done ? color.chip : color.lime)}
          >
            <Sans size={12.5} weight={600}>
              {mine.done ? 'Reopen it' : 'Mark it done'}
            </Sans>
          </Tap>
          <Tap
            onPress={() => {
              dispatch({ type: 'CLOSE_SHEET' });
              dispatch({ type: 'REMOVE_TASK', id: mine.id });
            }}
            accessibilityLabel={`Unstake ${mine.title}`}
            style={sheetChip('transparent', color.divider)}
          >
            <Sans size={12.5} weight={600} color={color.muted}>
              Unstake
            </Sans>
          </Tap>
        </View>
      ) : null}

      {actions.length ? (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 13, flexWrap: 'wrap' }}>
          {actions.map((a) => {
            const done = !!state.acted[`${id}:${a.k}`];
            return (
              <Tap
                key={a.k}
                onPress={() => dispatch({ type: 'ACT', id, kind: a.k, toast: a.toast })}
                accessibilityState={{ selected: done }}
                style={{
                  borderRadius: 999,
                  paddingHorizontal: 13,
                  paddingVertical: 10,
                  minHeight: 40,
                  justifyContent: 'center',
                  backgroundColor: done ? (a.k === 'in' ? color.ink : color.lime) : color.chip,
                }}
              >
                <Sans size={12.5} weight={600} color={done && a.k === 'in' ? color.lime : color.ink}>
                  {done ? a.on : a.off}
                </Sans>
              </Tap>
            );
          })}
        </View>
      ) : null}

      <Caps size={11} tracking={1.4} style={{ marginTop: 18, marginBottom: 10, marginHorizontal: 2 }}>
        Notes ({cmts.length})
      </Caps>
      <NoteThread notes={cmts} emptyText="Nothing here yet." />
    </ScrollView>
  );
}

function JointProgress({ task }: { task: Task }) {
  const { people } = useStore();
  const roster: { key: PersonId; name: string; done: boolean }[] = [
    { key: people.selfId, name: people.first(people.selfId), done: task.done },
    ...task.pair.map((k) => ({ key: k, name: people.first(k), done: !!task.pairStatus?.[k] })),
  ];

  return (
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
      {roster.map((p) => (
        <View
          key={p.key}
          style={{
            ...row,
            flex: 1,
            gap: 8,
            backgroundColor: color.card,
            borderRadius: radius.smallCard,
            paddingVertical: 10,
            paddingHorizontal: 11,
          }}
        >
          <Avatar who={p.key} size={26} />
          <Sans size={12.5} weight={600} style={fill}>
            {p.name}
          </Sans>
          <View
            style={{
              width: 9,
              height: 9,
              borderRadius: 5,
              backgroundColor: p.done ? color.lime : 'transparent',
              ...(p.done ? null : { borderWidth: 2, borderStyle: 'dashed' as const, borderColor: color.dash }),
            }}
          />
        </View>
      ))}
    </View>
  );
}

/* ── person ─────────────────────────────────────────────────────────────── */

function PersonSheet({ who }: { who: PersonId }) {
  const { state, dispatch, people } = useStore();
  const stats = people.isSelf(who) ? myStats(state) : people.stats(who);
  const tasks = PERSON_TASKS[who] ?? [];
  const notes = [...(PERSON_NOTES[who] ?? []), ...(state.personNotes[who] ?? [])];

  return (
    <ScrollView
      style={{ flexShrink: 1 }}
      contentContainerStyle={{ paddingTop: 10, paddingHorizontal: 18, paddingBottom: 12 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[row, { gap: 12 }]}>
        <Avatar who={who} size={52} />
        <View style={fill}>
          <Bri size={20} weight={800} tracking={-0.4}>
            {people.name(who)}
          </Bri>
          <Sans size={12.5} color={color.muted}>
            {stats.streak ? `🔥 ${stats.streak}-week streak` : 'building back'} · {stats.done}/
            {stats.total} this week
          </Sans>
        </View>
      </View>

      <Caps size={11} tracking={1.4} style={{ marginTop: 16, marginBottom: 9, marginHorizontal: 2 }}>
        {people.first(who)}’s week
      </Caps>
      <View style={{ gap: 8 }}>
        {tasks.map((t, i) => {
          const actKey = `${who}${i}`;
          const acted = !!state.acted[`${actKey}:nod`];
          return (
            <View
              key={t.t}
              style={{
                ...row,
                gap: 10,
                backgroundColor: color.card,
                borderRadius: radius.chip,
                paddingVertical: 12,
                paddingHorizontal: 13,
              }}
            >
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: t.done ? color.lime : 'transparent',
                  ...(t.done
                    ? null
                    : { borderWidth: 2, borderStyle: 'dashed' as const, borderColor: color.dash }),
                }}
              />
              <View style={fill}>
                <Sans size={14} weight={600} color={t.done ? color.muted : color.ink}>
                  {t.t}
                </Sans>
                <Sans size={11.5} color={color.muted}>
                  {t.sub}
                </Sans>
              </View>
              <Tap
                onPress={() =>
                  dispatch({
                    type: 'OPEN_PLAN_WITH',
                    seed: { title: t.t, pair: [who], toast: `Staking it with ${people.first(who)}` },
                  })
                }
                accessibilityLabel={`Stake "${t.t}" with ${people.first(who)}`}
                style={{
                  borderWidth: 1,
                  borderColor: 'rgba(25,30,22,.14)',
                  backgroundColor: color.card,
                  borderRadius: 999,
                  paddingHorizontal: 11,
                  paddingVertical: 8,
                  minHeight: 34,
                  justifyContent: 'center',
                }}
              >
                <Sans size={11.5} weight={700} color={color.moss}>
                  Do it too
                </Sans>
              </Tap>
              <Tap
                onPress={() =>
                  dispatch({ type: 'ACT', id: actKey, kind: 'nod', toast: `${people.first(who)} saw it` })
                }
                accessibilityLabel={t.done ? `Cheer ${t.t}` : `Back ${t.t}`}
                style={{
                  borderRadius: 999,
                  paddingHorizontal: 11,
                  paddingVertical: 8,
                  minHeight: 34,
                  justifyContent: 'center',
                  backgroundColor: acted ? color.lime : color.chip,
                }}
              >
                <Sans size={11.5} weight={700} color={color.ink}>
                  {acted ? '✓' : t.done ? 'Cheer' : 'Back it'}
                </Sans>
              </Tap>
            </View>
          );
        })}
      </View>

      <Caps size={11} tracking={1.4} style={{ marginTop: 16, marginBottom: 9, marginHorizontal: 2 }}>
        Notes
      </Caps>
      <NoteThread notes={notes} emptyText="You could be the first voice they hear today." />
    </ScrollView>
  );
}

/* ── invite ─────────────────────────────────────────────────────────────── */

function InviteSheet() {
  const { state, dispatch, world, people } = useStore();
  const pending: PersonId[] = Object.keys(state.pending);
  const suggestions = world.inviteSuggestions.filter((k) => !state.pending[k]);

  return (
    <ScrollView
      style={{ flexShrink: 1 }}
      contentContainerStyle={{ paddingTop: 6, paddingHorizontal: 18, paddingBottom: 20 }}
    >
      <Bri size={20} weight={800} tracking={-0.4}>
        Grow the circle
      </Bri>

      <View
        style={{
          ...row,
          gap: 10,
          backgroundColor: color.card,
          borderRadius: radius.chip,
          paddingVertical: 12,
          paddingHorizontal: 14,
          marginTop: 12,
        }}
      >
        <Sans size={13.5} color={color.muted} numberOfLines={1} style={fill}>
          {ME.inviteLink}
        </Sans>
        <Tap
          onPress={() => dispatch({ type: 'TOAST', message: 'Link copied' })}
          accessibilityLabel="Copy invite link"
          style={{
            borderRadius: 999,
            paddingHorizontal: 14,
            paddingVertical: 9,
            minHeight: 38,
            justifyContent: 'center',
            backgroundColor: color.ink,
          }}
        >
          <Sans size={12.5} weight={700} color={color.lime}>
            Copy
          </Sans>
        </Tap>
      </View>

      <Caps size={11} tracking={1.4} style={{ marginTop: 18, marginBottom: 9, marginHorizontal: 2 }}>
        Pending ({pending.length})
      </Caps>
      <View style={{ gap: 8 }}>
        {pending.map((k) => (
          <View key={k} style={inviteRow}>
            <Avatar who={k} size={32} />
            <Sans size={13.5} weight={600} style={fill}>
              {people.name(k)}
            </Sans>
            <Sans size={11.5} color={color.muted}>
              invited just now
            </Sans>
          </View>
        ))}
        {pending.length === 0 ? (
          <Sans size={13} color={color.muted} style={{ paddingHorizontal: 2 }}>
            Nobody waiting. The link above does the rest.
          </Sans>
        ) : null}
      </View>

      <Caps size={11} tracking={1.4} style={{ marginTop: 18, marginBottom: 9, marginHorizontal: 2 }}>
        People you might know
      </Caps>
      <View style={{ gap: 8 }}>
        {suggestions.length === 0 ? (
          <Sans size={13} color={color.muted} style={{ paddingHorizontal: 2 }}>
            Nobody to suggest yet. The link above is the way in.
          </Sans>
        ) : null}
        {suggestions.map((k) => (
          <View key={k} style={inviteRow}>
            <Avatar who={k} size={32} />
            <Sans size={13.5} weight={600} style={fill}>
              {people.name(k)}
            </Sans>
            <Tap
              onPress={() => dispatch({ type: 'INVITE', key: k })}
              accessibilityLabel={`Invite ${people.name(k)}`}
              style={{
                borderRadius: 999,
                paddingHorizontal: 13,
                paddingVertical: 9,
                minHeight: 38,
                justifyContent: 'center',
                backgroundColor: color.chip,
              }}
            >
              <Sans size={12} weight={700}>
                Invite
              </Sans>
            </Tap>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const sheetChip = (background: string, border?: string) => ({
  borderRadius: 999,
  paddingHorizontal: 13,
  paddingVertical: 10,
  minHeight: 40,
  justifyContent: 'center' as const,
  backgroundColor: background,
  ...(border ? { borderWidth: 1, borderColor: border } : null),
});

const inviteRow = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 10,
  backgroundColor: color.card,
  borderRadius: radius.chip,
  paddingVertical: 11,
  paddingHorizontal: 13,
};

/* ── shared ─────────────────────────────────────────────────────────────── */

function NoteThread({ notes, emptyText }: { notes: Note[]; emptyText: string }) {
  if (!notes.length) {
    return (
      <Sans size={13} color={color.muted} style={{ textAlign: 'center', padding: 16 }}>
        {emptyText}
      </Sans>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      {notes.map((c, i) => (
        <View key={`${c.w}-${i}`} style={{ flexDirection: 'row', gap: 9, alignItems: 'flex-start' }}>
          <Avatar who={c.k} size={28} label={c.w} />
          <View
            style={{
              backgroundColor: color.card,
              borderRadius: radius.chip,
              paddingVertical: 9,
              paddingHorizontal: 13,
              maxWidth: '82%',
            }}
          >
            <Sans size={11} weight={700} color={color.muted} style={{ marginBottom: 2 }}>
              {c.w}
            </Sans>
            <Sans size={13.5} lineHeight={18}>
              {c.t}
            </Sans>
          </View>
        </View>
      ))}
    </View>
  );
}

function NoteComposer({ bottomInset }: { bottomInset: number }) {
  const { state, dispatch, people } = useStore();
  const sheet = state.sheet;
  const placeholder =
    sheet?.type === 'person' && sheet.id ? `Write to ${people.first(sheet.id)}…` : 'Say something…';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View
        style={{
          flexDirection: 'row',
          gap: 8,
          paddingTop: 10,
          paddingHorizontal: 16,
          paddingBottom: Math.max(bottomInset, 16) + 22,
          backgroundColor: 'rgba(255,255,255,.96)',
          borderTopWidth: 1,
          borderTopColor: 'rgba(25,30,22,.07)',
        }}
      >
        <TextInput
          value={state.note}
          onChangeText={(value) => dispatch({ type: 'SET_NOTE', value })}
          onSubmitEditing={() => dispatch({ type: 'SEND_NOTE' })}
          placeholder={placeholder}
          placeholderTextColor={color.muted}
          accessibilityLabel={placeholder}
          returnKeyType="send"
          style={{
            flex: 1,
            height: 46,
            backgroundColor: color.chip,
            borderRadius: 999,
            paddingHorizontal: 16,
            fontFamily: 'InstrumentSans_400Regular',
            fontSize: 14,
            color: color.ink,
          }}
        />
        <Tap
          onPress={() => dispatch({ type: 'SEND_NOTE' })}
          accessibilityLabel="Send note"
          style={{
            width: 46,
            height: 46,
            borderRadius: 23,
            backgroundColor: color.lime,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="send" size={19} color={color.ink} />
        </Tap>
      </View>
    </KeyboardAvoidingView>
  );
}
