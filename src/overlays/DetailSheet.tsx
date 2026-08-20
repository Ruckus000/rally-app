/**
 * The bottom sheet: task, person and invite variants.
 *
 * The prototype's drag handle is decorative and it closed on scrim tap only.
 * The build keeps the handle, adds a real close button, and wires Escape and
 * hardware back through <Overlay>.
 */
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  TextInput,
  View,
} from 'react-native';
import { onLight, radius } from '../theme/tokens';
import { useColors, type Palette } from '../theme/ThemeProvider';
import {
  AUDIENCE_LABEL,
  ME,
  Note,
  PERSON_NOTES,
  PERSON_TASKS,
  Task,
  TaskMedia,
} from '../data/fixtures';
import { DAY_NAMES } from '../data/week';
import { CIRCLE_NAME_MAX, useStore } from '../state/store';
import { myStats, visibleNotes } from '../state/selectors';
import { SHEET_DURATION, sheetEasing, useReducedMotion } from '../theme/motion';
import { Image } from 'expo-image';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Bri, Caps, Sans, Tap, fill, row } from '../components/primitives';
import { Trouble } from '../components/Trouble';
import { Overlay } from './Overlay';
import { createCircle } from '../sync/transport';
import { dropMediaFor, enqueueMedia } from '../sync/media';
import { forgetLocalPhoto, pickTaskPhoto } from '../lib/photos';
import { kickSync } from '../sync/useSyncEngine';
import { queueBlock } from '../sync/engine';
import type { PersonId } from '../data/people';
import type { ReportTarget } from '../state/store';

export function DetailSheet({ bottomInset }: { bottomInset: number }) {
  const color = useColors();
  const { state, dispatch } = useStore();
  // `CLOSE_SHEET` nulls the slice while <Presence> is still fading this out;
  // holding the last sheet keeps the content on screen through the exit
  // instead of the sheet blinking empty a frame before the fade. Guarded
  // setState during render — the sanctioned previous-value pattern.
  const [lastSheet, setLastSheet] = useState(state.sheet);
  if (state.sheet && state.sheet !== lastSheet) setLastSheet(state.sheet);
  const sheet = state.sheet ?? lastSheet;
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
            <Icon name="close" size={15} color={color.textPrimary} />
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
  const color = useColors();
  const { state, dispatch, people } = useStore();

  const mine = state.myTasks.find((x) => x.id === id);
  // One chain, three feeds. A post on the Global tab is a moment like any
  // other now — it used to be a fourth lookup into a fixture, with a `@handle`
  // and an avatar tint that came from nowhere else in the app.
  const moment =
    state.moments.find((x) => x.id === id) ?? state.globalPosts.find((x) => x.id === id);
  const raw = mine ?? moment;
  if (!raw) return null;

  const who = mine ? state.selfId : moment?.who;
  const name = who ? people.name(who) : '';
  const initials = who ? people.initials(who) : '?';
  const tintColor = who ? people.tint(who) : color.chip;
  const first = who ? people.first(who) : '';
  // A demo post has no thread of its own — what we can show is what you said.
  // Filtered, because this thread never passes through `mergedFeed` — the sheet
  // reads the moment straight out of state. Without this a note you just
  // reported is still sitting there on the screen you reported it from.
  const cmts: Note[] = visibleNotes(
    (mine?.cmts ?? moment?.cmts ?? state.globalNotes[id] ?? []) as Note[],
    state,
  );
  const pts = mine?.pts ?? moment?.pts;
  const title = 'title' in raw ? (raw.title ?? '') : '';

  const meta = mine
    ? `${mine.cat}${mine.aud !== 'friends' ? ` · ${AUDIENCE_LABEL[mine.aud]}` : ''}`
    : `${moment?.time} ago`;

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
        <Avatar who={who} initials={initials} tint={tintColor} label={name} size={42} />
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

      {/* The photo, at the aspect it was taken. Sized from the stored
          dimensions so the sheet does not reflow when the image arrives. */}
      {mine?.media ? <TaskPhoto media={mine.media} /> : null}

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
          <PhotoChip task={mine} />
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
                {/* Three fills under one label: `ink` when you are in, `lime`
                    when the other actions are done, `chip` when they are not.
                    Only the last of those flips, so the label splits with it. */}
                <Sans
                  size={12.5}
                  weight={600}
                  color={done ? (a.k === 'in' ? color.lime : onLight) : color.textPrimary}
                >
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

      {who ? <SafetyFooter target={{ kind: 'task', id, who }} /> : null}
    </ScrollView>
  );
}

function JointProgress({ task }: { task: Task }) {
  const color = useColors();
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

/**
 * A goal's photo.
 *
 * Drawn from `localUri` when this device has the file and from the signed
 * `url` otherwise, preferring the local one because it costs nothing and is
 * there before any URL has been minted. The aspect comes from the stored
 * dimensions rather than from the image, so the layout is settled before the
 * first byte arrives — a card that reflows when a photo loads is the jank
 * this app spent a release removing.
 *
 * `cacheKey` is the media id, deliberately not the URL: signed URLs are
 * re-minted on every pull, and keying the cache on one would re-download
 * every photo in the feed every cycle.
 */
function TaskPhoto({ media }: { media: TaskMedia }) {
  const color = useColors();
  const source = media.localUri ?? media.url;
  if (!source) return null;
  const ratio = media.w && media.h ? media.w / media.h : 4 / 3;
  return (
    <Image
      source={{ uri: source }}
      cachePolicy="disk"
      recyclingKey={media.id}
      contentFit="cover"
      accessibilityLabel="Photo on this goal"
      style={{
        width: '100%',
        // Capped so a tall photo cannot push the actions off the sheet.
        aspectRatio: Math.max(ratio, 3 / 4),
        borderRadius: radius.chip,
        marginTop: 12,
        backgroundColor: color.chip,
      }}
    />
  );
}

/**
 * Attach a photo, or take one back.
 *
 * Only on your own task, and only where a photo is not public: an image on an
 * `everyone` goal is open image hosting, and moderation is explicitly out of
 * scope (see docs/backend.md). The chip says so rather than being missing,
 * because a control that silently is not there reads as a bug.
 */
function PhotoChip({ task }: { task: Task }) {
  const color = useColors();
  const { state, dispatch } = useStore();
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);

  const owner = state.selfId;
  const public_ = task.aud === 'everyone';

  const attach = async () => {
    setBusy(true);
    setTrouble(null);
    try {
      const picked = await pickTaskPhoto(owner, task.id);
      if (!picked.ok) {
        // Changing your mind is not a failure and says nothing.
        if (picked.reason === 'cancelled') return;
        setTrouble(
          picked.reason === 'denied'
            ? 'Rally needs access to your photos for this.'
            : 'That photo didn’t attach. Try another?'
        );
        return;
      }
      // On screen first, uploaded second — see `media.ts`. Replacing an
      // existing photo drops the old local file; the row is replaced by the
      // one `unique (task_id)` allows.
      void forgetLocalPhoto(task.media);
      dispatch({ type: 'ATTACH_MEDIA', id: task.id, media: picked.media });
      enqueueMedia({
        id: picked.media.id,
        taskId: task.id,
        localUri: picked.media.localUri!,
        path: picked.media.path,
        width: picked.media.w,
        height: picked.media.h,
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    const had = task.media;
    dispatch({ type: 'REMOVE_MEDIA', id: task.id });
    dropMediaFor(task.id);
    void forgetLocalPhoto(had);
  };

  if (public_) {
    return (
      <View style={sheetChip('transparent', color.divider)}>
        <Sans size={12.5} weight={600} color={color.faintInk}>
          No photos on public goals
        </Sans>
      </View>
    );
  }

  return (
    <>
      <Tap
        onPress={busy ? undefined : () => void (task.media ? remove() : attach())}
        accessibilityLabel={task.media ? `Remove the photo on ${task.title}` : `Add a photo to ${task.title}`}
        accessibilityState={{ disabled: busy }}
        style={sheetChip(color.chip)}
      >
        <Sans size={12.5} weight={600} color={busy ? color.muted : color.textPrimary}>
          {busy ? 'Opening…' : task.media ? 'Remove photo' : 'Add a photo'}
        </Sans>
      </Tap>
      <Trouble message={trouble} />
    </>
  );
}

/* ── person ─────────────────────────────────────────────────────────────── */

/** One row of somebody's week, from whichever source could answer for it. */
type PersonTask = {
  key: string;
  title: string;
  sub: string;
  done: boolean;
  /**
   * The row this came from, when it is a real one. Backing a fixture can only
   * ever be a local gesture; backing a real moment is a reaction that reaches
   * the person it is about.
   */
  momentId?: string;
};

function PersonSheet({ who }: { who: PersonId }) {
  const color = useColors();
  const { state, dispatch, people } = useStore();
  const stats = people.isSelf(who) ? myStats(state) : people.stats(who);

  /**
   * Their week, from the feed this device has already pulled.
   *
   * This used to read `PERSON_TASKS`, a fixture keyed by the demo's person
   * ids — so every *real* friend's sheet rendered a caps label over nothing,
   * under a line reading "building back · 0/0 this week". The circle's rows
   * were on the device the whole time; the feed draws them. The demo's own
   * fixture is kept, because it is furniture written for those people.
   */
  const demoTasks = PERSON_TASKS[who] ?? [];
  const tasks: PersonTask[] = demoTasks.length
    ? demoTasks.map((t, i) => ({ key: `${who}${i}`, title: t.t, sub: t.sub, done: t.done }))
    : state.moments
        .filter((m) => m.who === who)
        .map((m) => ({
          key: m.id,
          momentId: m.id,
          title: m.title ?? '',
          sub: `${DAY_NAMES[m.day]}${m.pts ? ` · +${m.pts}` : ''}`,
          done: !!m.done,
        }));
  // `visibleNotes` drops anything from somebody this account has blocked —
  // main's rule, applied to the same thread this sheet has always shown.
  const notes = visibleNotes([...(PERSON_NOTES[who] ?? []), ...(state.personNotes[who] ?? [])], state);

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
          {/* "0/0 this week" is not a fact about somebody, it is the absence
              of one — so a person whose week has not synced says nothing
              rather than claiming they staked nothing. */}
          <Sans size={12.5} color={color.muted}>
            {stats.streak ? `🔥 ${stats.streak}-week streak` : 'building back'}
            {stats.total ? ` · ${stats.done}/${stats.total} this week` : ''}
          </Sans>
        </View>
      </View>

      <Caps size={11} tracking={1.4} style={{ marginTop: 16, marginBottom: 9, marginHorizontal: 2 }}>
        {people.first(who)}’s week
      </Caps>
      <View style={{ gap: 8 }}>
        {tasks.length === 0 ? (
          <Sans size={13} lineHeight={18} color={color.muted} style={{ padding: 16, textAlign: 'center' }}>
            Nothing of theirs has landed here yet.
          </Sans>
        ) : null}
        {tasks.map((t) => {
          // A real moment id where there is one, so the nod is a reaction that
          // syncs; the fixture's synthetic key where there is not.
          const actKey = t.momentId ?? t.key;
          const acted = !!state.acted[`${actKey}:nod`];
          return (
            <View
              key={t.key}
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
                <Sans size={14} weight={600} color={t.done ? color.muted : color.textPrimary}>
                  {t.title}
                </Sans>
                <Sans size={11.5} color={color.muted}>
                  {t.sub}
                </Sans>
              </View>
              <Tap
                onPress={() =>
                  dispatch({
                    type: 'OPEN_PLAN_WITH',
                    seed: { title: t.title, pair: [who], toast: `Staking it with ${people.first(who)}` },
                  })
                }
                accessibilityLabel={`Stake "${t.title}" with ${people.first(who)}`}
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
                accessibilityLabel={t.done ? `Cheer ${t.title}` : `Back ${t.title}`}
                style={{
                  borderRadius: 999,
                  paddingHorizontal: 11,
                  paddingVertical: 8,
                  minHeight: 34,
                  justifyContent: 'center',
                  backgroundColor: acted ? color.lime : color.chip,
                }}
              >
                {/* `lime` once acted, `chip` before — one fixed surface and
                    one that flips, so the label follows the same test. */}
                <Sans size={11.5} weight={700} color={acted ? onLight : color.textPrimary}>
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

      <SafetyFooter target={{ kind: 'profile', id: who, who }} />
    </ScrollView>
  );
}

/* ── invite ─────────────────────────────────────────────────────────────── */

/**
 * What a live account with no circle gets instead of an invite code.
 *
 * Riding solo through onboarding used to be permanent: this sheet was the only
 * invite surface, onboarding was the only place a circle could be made, and
 * neither could be reached again. One field and the call that already exists.
 */
function StartCircle() {
  const color = useColors();
  const { dispatch } = useStore();
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [trouble, setTrouble] = React.useState<string | null>(null);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setTrouble(null);
    try {
      await createCircle(trimmed);
      // The sheet reads `state.circle`, which only a pull can fill — so this is
      // what turns this screen into the invite code rather than leaving it here.
      kickSync();
      dispatch({ type: 'TOAST', message: `${trimmed} is live` });
    } catch {
      setTrouble('Couldn’t reach Rally just now. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={{ flexShrink: 1 }}
      contentContainerStyle={{ paddingTop: 6, paddingHorizontal: 18, paddingBottom: 20 }}
    >
      <Bri size={20} weight={800} tracking={-0.4}>
        Start a circle
      </Bri>
      <Sans size={13} color={color.muted} style={{ marginTop: 6, lineHeight: 18.5 }}>
        Name it, and you’ll get a code to send the people who should see your week.
      </Sans>

      <View style={[row, { gap: 8, marginTop: 14 }]}>
        <TextInput
          value={name}
          onChangeText={setName}
          onSubmitEditing={() => void create()}
          maxLength={CIRCLE_NAME_MAX}
          editable={!busy}
          placeholder="e.g. The Basement"
          placeholderTextColor={color.faintInk}
          selectionColor={color.moss}
          accessibilityLabel="Circle name"
          style={{
            ...fill,
            height: 46,
            borderRadius: radius.chip,
            backgroundColor: color.card,
            paddingHorizontal: 14,
            fontFamily: 'InstrumentSans_600SemiBold',
            fontSize: 14,
            color: color.textPrimary,
          }}
        />
        <Tap
          onPress={() => void create()}
          accessibilityLabel="Create circle"
          style={{
            borderRadius: 999,
            paddingHorizontal: 18,
            minHeight: 46,
            justifyContent: 'center',
            backgroundColor: name.trim() && !busy ? color.ink : color.chip,
          }}
        >
          <Sans size={12.5} weight={700} color={name.trim() && !busy ? color.lime : color.muted}>
            {busy ? 'Creating…' : 'Create'}
          </Sans>
        </Tap>
      </View>

      <Trouble message={trouble} />
    </ScrollView>
  );
}

function InviteSheet() {
  const color = useColors();
  const { state, dispatch, demo, people } = useStore();
  const pending: PersonId[] = Object.keys(state.pending);
  const suggestions = demo.inviteSuggestions.filter((k) => !state.pending[k]);

  const live = state.account === 'live';
  /**
   * The demo keeps its fiction — everything on this screen is a fixture there,
   * and `ME.inviteLink` is no more invented than "Alex Rivera". A live account
   * gets the real thing: the code `create_circle` minted, which is the only
   * string that will actually let anyone in.
   */
  const code = live ? (state.circle?.inviteCode ?? '') : ME.inviteLink;

  /**
   * The OS share sheet, not a clipboard. `Share` is core React Native, so this
   * needs no native module and no rebuild — and sending a friend a code is the
   * actual task, which a pasteboard only ever half-does.
   *
   * Ratified deviation — see design-reference/DEVIATIONS.md. The handoff asks
   * for a copyable link; the share sheet reaches the clipboard *and* every
   * app the code might be sent through, in one tap.
   */
  const share = () => {
    void Share.share({
      message: live ? `Join my circle on Rally with the code ${code}` : code,
    }).catch(() => dispatch({ type: 'TOAST', message: 'Couldn’t open the share sheet' }));
  };

  // A live account with no circle has, until now, had no way to make one after
  // onboarding — this sheet was the end of the road. It reuses the same
  // `createCircle` the onboarding step calls; there is no second creation path.
  if (live && !state.circle) {
    return <StartCircle />;
  }

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
        <Sans
          size={13.5}
          color={color.muted}
          numberOfLines={1}
          selectable
          style={fill}
          accessibilityLabel={`Invite code ${code}`}
        >
          {code}
        </Sans>
        <Tap
          onPress={share}
          accessibilityLabel="Share invite code"
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
            Share
          </Sans>
        </Tap>
      </View>

      <Caps size={11} tracking={1.4} style={{ marginTop: 18, marginBottom: 9, marginHorizontal: 2 }}>
        Pending ({pending.length})
      </Caps>
      <View style={{ gap: 8 }}>
        {pending.map((k) => (
          <View key={k} style={inviteRow(color)}>
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
          <View key={k} style={inviteRow(color)}>
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

/**
 * A function of the palette, not an object — the shape settled in
 * `theme/ThemeProvider.tsx`. As a plain object it captured `color.card` at
 * import and would have frozen whichever palette was active then, silently,
 * until the first live theme toggle.
 */
const inviteRow = (color: Palette) => ({
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 10,
  backgroundColor: color.card,
  borderRadius: radius.chip,
  paddingVertical: 11,
  paddingHorizontal: 13,
});

/* ── reporting, and blocking ────────────────────────────────────────────── */

/**
 * Whether this app will offer to report or block someone at all.
 *
 * Two absences, both deliberate. Yourself, because `blocks_not_self` refuses
 * the row and reporting your own post is a form to nowhere. A bot, because
 * `block_person` raises `22023` on one — and a control that opens a three-step
 * flow whose last tap fails at the database is worse than no control. Neither
 * refusal is worth explaining on screen: there is no honest label for a button
 * that cannot work, so there is no button. `ReportSheet` makes the same call
 * for the same reason, one screen further in.
 */
function useSafety(who: PersonId | undefined): boolean {
  const { state } = useStore();
  if (!who) return false;
  return who !== state.selfId && !state.people[who]?.bot;
}

/**
 * The one way out of a bad post or a bad week, per sheet.
 *
 * A footer, not a control on the header and emphatically not a fourth icon on
 * the engagement row — that row is 🔥, 💬 and an optional word at 44px and has
 * no room left. Text at the end of the sheet is the right weight for something
 * a person needs perhaps twice a year and should never be nudged toward: it is
 * findable by anyone looking for it and invisible to everyone else. `Tap` gets
 * it to 44px through hitSlop, so the quiet type costs nothing in aim.
 *
 * Blocking is offered only on the person sheet, because that is the only sheet
 * whose subject *is* a person. From a post, the route to a block is the report
 * sheet's second step — which is where the sentence about the circle lives, and
 * that sentence has to be read before a block, not after.
 */
function SafetyFooter({ target }: { target: ReportTarget }) {
  const color = useColors();
  const { dispatch, people } = useStore();
  const offer = useSafety(target.who);
  if (!offer) return null;

  const name = people.name(target.who);
  const first = people.first(target.who);
  const profile = target.kind === 'profile';

  /**
   * The same two facts `ReportSheet`'s block step spells out, in the shape a
   * confirm can hold: what a block does, and the thing it cannot do. Without
   * the second sentence the first thing you see after blocking someone is that
   * person, still on the ranked list, and the reasonable conclusion is that it
   * did not work. An `Alert` because this is the app's idiom for a decision
   * with a consequence — sign-out uses it — and because a second sheet over
   * this one would be a third overlay deep.
   */
  const block = () =>
    Alert.alert(
      `Block ${name}?`,
      `You stop seeing ${first} — their week, their notes, their cheers. They stop seeing yours. Neither of you is told.\n\n${first} stays in your circle: still on the ranked list, still counted in its totals, because those are the circle’s numbers and not your view of it.`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: () => {
            dispatch({ type: 'BLOCK', id: target.who });
            // Both halves in the same tick, per `queueBlock`: only the queue
            // survives the app closing.
            queueBlock(target.who);
            // This sheet is full of the person who was just blocked.
            dispatch({ type: 'CLOSE_SHEET' });
          },
        },
      ],
    );

  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 4,
        marginTop: 18,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: color.divider,
      }}
    >
      <Tap
        onPress={() => dispatch({ type: 'OPEN_REPORT', target })}
        accessibilityLabel={profile ? `Report ${name}` : 'Report this post'}
        style={footerAction}
      >
        <Sans size={12.5} weight={600} color={color.muted}>
          Report
        </Sans>
      </Tap>
      {profile ? (
        <Tap onPress={block} accessibilityLabel={`Block ${name}`} style={footerAction}>
          <Sans size={12.5} weight={600} color={color.muted}>
            Block
          </Sans>
        </Tap>
      ) : null}
    </View>
  );
}

const footerAction = {
  minHeight: 34,
  paddingHorizontal: 10,
  paddingVertical: 8,
  justifyContent: 'center' as const,
};

/* ── shared ─────────────────────────────────────────────────────────────── */

function NoteThread({ notes, emptyText }: { notes: Note[]; emptyText: string }) {
  const color = useColors();
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
        <NoteBubble key={`${c.w}-${i}`} note={c} />
      ))}
    </View>
  );
}

/**
 * One note, and — held down — the way to report it.
 *
 * A note is the smallest thing in this app that can be abusive, and it is also
 * the densest: a thread is a stack of 28px avatars and two lines of type, with
 * no room for a control beside each one that would not turn the thread into a
 * column of buttons. So the note *is* the control, on a long press, the way a
 * message bubble is in every chat app anyone has used.
 *
 * The cost is honest: there is no visible affordance, and somebody who has
 * never held a bubble down will not find it. What that buys is a thread that
 * still reads as a conversation. The screen reader is told outright, via the
 * hint and a named `longpress` action, so the least discoverable case is the
 * one that gets an explicit sentence.
 *
 * Absent — a plain, untappable bubble — for your own notes, for bots, and for
 * a note with no id. That last one is not a guard against the user: fixture
 * notes predate client-minted ids, and a report filed against `undefined` is a
 * row the server would accept and nobody could ever act on.
 */
function NoteBubble({ note }: { note: Note }) {
  const color = useColors();
  const { dispatch } = useStore();
  const offer = useSafety(note.k) && !!note.id;

  const bubble = (
    <View
      style={{
        backgroundColor: color.card,
        borderRadius: radius.chip,
        paddingVertical: 9,
        paddingHorizontal: 13,
        maxWidth: '82%',
        minHeight: 44,
        justifyContent: 'center',
      }}
    >
      <Sans size={11} weight={700} color={color.muted} style={{ marginBottom: 2 }}>
        {note.w}
      </Sans>
      <Sans size={13.5} lineHeight={18}>
        {note.t}
      </Sans>
    </View>
  );

  if (!offer) {
    return (
      <View style={{ flexDirection: 'row', gap: 9, alignItems: 'flex-start' }}>
        <Avatar who={note.k} size={28} label={note.w} />
        {bubble}
      </View>
    );
  }

  const report = () =>
    dispatch({ type: 'OPEN_REPORT', target: { kind: 'note', id: note.id as string, who: note.k } });

  return (
    <View style={{ flexDirection: 'row', gap: 9, alignItems: 'flex-start' }}>
      <Avatar who={note.k} size={28} label={note.w} />
      <Tap
        onLongPress={report}
        // Not a button: it does not do anything when tapped, and announcing
        // "button" would promise that it does. Text with an action on it.
        accessibilityRole="text"
        accessibilityLabel={`Note from ${note.w}: ${note.t}`}
        accessibilityHint="Press and hold to report this note"
        accessibilityActions={[{ name: 'longpress', label: 'Report this note' }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'longpress') report();
        }}
      >
        {bubble}
      </Tap>
    </View>
  );
}

function NoteComposer({ bottomInset }: { bottomInset: number }) {
  const color = useColors();
  const { state, dispatch, people } = useStore();
  const sheet = state.sheet;
  // Buffered locally while typing: a keystroke used to dispatch `SET_NOTE`,
  // re-rendering the whole app per character. The reducer still owns the send
  // — the buffer is written back in the same batch as `SEND_NOTE`. The buffer
  // resets when the sheet underneath changes (render-time adjustment).
  const [text, setText] = useState('');
  const sheetKey = sheet ? `${sheet.type}:${sheet.id}` : '';
  const [seenKey, setSeenKey] = useState(sheetKey);
  if (sheetKey !== seenKey) {
    setSeenKey(sheetKey);
    setText('');
  }
  const send = () => {
    dispatch({ type: 'SET_NOTE', value: text });
    dispatch({ type: 'SEND_NOTE' });
    setText('');
  };
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
          value={text}
          onChangeText={setText}
          onSubmitEditing={send}
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
            color: color.textPrimary,
          }}
        />
        <Tap
          onPress={send}
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
          <Icon name="send" size={19} color={onLight} />
        </Tap>
      </View>
    </KeyboardAvoidingView>
  );
}
