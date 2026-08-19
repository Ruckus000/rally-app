/**
 * Notifications — three tiers, in order: Needs you, Worth a look, Batched.
 * Only the first tier drives the unread badge, and routing is per item.
 */
import React from 'react';
import { ScrollView, View } from 'react-native';
import { color, gutter, radius, shadows } from '../theme/tokens';
import { NOTIF_TIERS, Notification, NotifTier } from '../data/fixtures';
import { EmptyState } from '../components/FeedCards';
import { useStore, usePeople } from '../state/store';
import { Icon, IconName } from '../components/Icon';
import { Avatar } from '../components/Avatar';
import { Bri, Caps, Sans, Tap, fill, row } from '../components/primitives';
import { Overlay } from './Overlay';
import { closeButton } from './LedgerOverlay';

const FILTERS: { k: 'all' | NotifTier; label: string }[] = [
  { k: 'all', label: 'All' },
  { k: 'needs', label: 'Needs you' },
  { k: 'week', label: 'Your week' },
  { k: 'circle', label: 'Circle' },
];

const TIER_ICON: Partial<Record<Notification['kind'], IconName>> = {
  due: 'due',
  streak: 'streak',
  wrap: 'wrap',
};

export function NotificationsOverlay({
  topInset,
  bottomInset = 0,
}: {
  topInset: number;
  bottomInset?: number;
}) {
  const { state, dispatch } = useStore();
  // One slice, every account. The demo's feed is seeded into it and a live
  // account's arrives from the server, so there is no world to read by mistake
  // — which is what left the bell empty however many people cheered you.
  const all = state.notifications;
  const close = () => dispatch({ type: 'CLOSE_NOTIF' });

  return (
    <Overlay zIndex={58} background={color.paper} onRequestClose={close}>
      <View
        style={{
          ...row,
          gap: 10,
          paddingTop: Math.max(topInset, 20) + 16,
          paddingHorizontal: gutter,
          paddingBottom: 6,
        }}
      >
        <Bri size={19} weight={800} tracking={-0.3} style={fill}>
          Notifications
        </Bri>
        {all.length ? (
          <Tap
            onPress={() => dispatch({ type: 'READ_ALL_NOTIFS' })}
            accessibilityLabel="Mark all as read"
            style={{ paddingHorizontal: 10, minHeight: 40, justifyContent: 'center' }}
          >
            <Sans size={12} weight={700} color={color.moss}>
              Mark all read
            </Sans>
          </Tap>
        ) : null}
        <Tap onPress={close} accessibilityLabel="Close notifications" style={closeButton}>
          <Icon name="close" size={16} color={color.ink} />
        </Tap>
      </View>

      {all.length === 0 ? (
        <EmptyState
          title="Nothing needs you"
          body="Nudges only arrive when someone is actually waiting on you. It’s quiet."
        />
      ) : (
      <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ gap: 7, paddingTop: 4, paddingBottom: 10, paddingHorizontal: gutter }}
      >
        {FILTERS.map((f) => {
          const on = state.notifFilter === f.k;
          const count =
            f.k === 'all' ? all.length : all.filter((n) => n.tier === f.k).length;
          return (
            <Tap
              key={f.k}
              onPress={() => dispatch({ type: 'SET_NOTIF_FILTER', filter: f.k })}
              accessibilityState={{ selected: on }}
              style={{
                ...row,
                gap: 6,
                borderRadius: 999,
                paddingHorizontal: 13,
                paddingVertical: 8,
                minHeight: 40,
                borderWidth: on ? 0 : 1,
                borderColor: color.divider,
                backgroundColor: on ? color.ink : color.card,
              }}
            >
              <Sans size={12.5} weight={700} color={on ? color.paper : color.avatarText}>
                {f.label}
              </Sans>
              {/* Same rule as the tiers: a filter with nothing behind it wears
                  no count rather than a pill reading 0. */}
              {f.k !== 'all' && count > 0 ? (
                <View
                  style={{
                    backgroundColor: on ? 'rgba(241,242,236,.18)' : color.limeTintChip,
                    borderRadius: 999,
                    paddingHorizontal: 6,
                    paddingVertical: 1,
                  }}
                >
                  <Bri size={10.5} weight={800} color={on ? color.lime : color.moss}>
                    {count}
                  </Bri>
                </View>
              ) : null}
            </Tap>
          );
        })}
      </ScrollView>

      <ScrollView
        style={{ flex: 1 }}
        // The last row and the footer line used to rest under the home
        // indicator — the sibling overlays already clear it this way.
        contentContainerStyle={{
          paddingTop: 4,
          paddingHorizontal: gutter,
          paddingBottom: Math.max(bottomInset, 20) + 20,
        }}
      >
        {NOTIF_TIERS.filter((t) => state.notifFilter === 'all' || state.notifFilter === t.key).map(
          (tier) => {
            const items = all.filter((n) => n.tier === tier.key);
            // "Never show a bare zero." A tier nobody has anything in is not a
            // heading over a count of nothing — it is a tier that says nothing.
            if (items.length === 0) return null;
            return (
              <View key={tier.key} style={{ marginBottom: 22 }}>
                <View style={[row, { gap: 8, marginHorizontal: 2, marginBottom: 4 }]}>
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: tier.accent }} />
                  <Caps size={11} tracking={1.4} color={color.avatarText}>
                    {tier.title}
                  </Caps>
                  <Sans size={11} weight={700} color={color.faintInk}>
                    {items.length}
                  </Sans>
                </View>
                <Sans
                  size={11.5}
                  lineHeight={15.5}
                  color={color.faintInk}
                  style={{ marginLeft: 17, marginRight: 2, marginBottom: 11 }}
                >
                  {tier.blurb}
                </Sans>

                <View style={{ gap: 8 }}>
                  {items.map((n) => (
                    <NotificationRow key={n.id} item={n} isNeeds={tier.key === 'needs'} />
                  ))}
                </View>
              </View>
            );
          },
        )}

        <Sans
          size={11.5}
          lineHeight={17}
          color={color.faintInk}
          style={{ textAlign: 'center', paddingHorizontal: 20, paddingTop: 2, paddingBottom: 6 }}
        >
          {/* True again, and the reason the line came back: `batchCheers`
              groups every cheer on a task into one row. It said this before
              anything did it, which is why there is a test holding it to it. */}
          {'Nudges only arrive when someone is actually waiting on you.\nCheers batch into one.'}
        </Sans>
      </ScrollView>
      </>
      )}
    </Overlay>
  );
}

function NotificationRow({ item, isNeeds }: { item: Notification; isNeeds: boolean }) {
  const { state, dispatch } = useStore();
  const people = usePeople();
  const isSystem = !item.who && !item.faces;
  const faces = item.faces ?? (item.who ? [item.who] : []);
  const read = !!state.notifRead[item.id];

  const route = () => {
    dispatch({ type: 'READ_NOTIF', id: item.id });
    if (item.goWrap) return dispatch({ type: 'OPEN_WRAP', week: null });
    if (item.goPlan) return dispatch({ type: 'OPEN_PLAN_WITH', seed: {} });
    if (item.goTab) return dispatch({ type: 'GO_PLACE', patch: { tab: item.goTab } });
    if (item.person) {
      dispatch({ type: 'CLOSE_NOTIF' });
      return dispatch({ type: 'OPEN_SHEET', sheet: { type: 'person', id: item.who ?? faces[0] } });
    }
    if (item.sheetId) {
      dispatch({ type: 'CLOSE_NOTIF' });
      return dispatch({ type: 'OPEN_SHEET', sheet: { type: 'task', id: item.sheetId } });
    }
  };

  const name = item.name ?? (item.who ? people.first(item.who) : '');

  return (
    <Tap
      onPress={route}
      accessibilityLabel={`${name} ${item.text}. ${item.time}${read ? '' : '. Unread'}`}
      style={[
        {
          ...row,
          gap: 11,
          borderRadius: radius.row,
          padding: 13,
          minHeight: 64,
          backgroundColor: isNeeds && !read ? color.askTint : color.card,
          borderWidth: isNeeds && !read ? 1.5 : 0,
          borderColor: 'rgba(195,245,60,.75)',
        },
        isNeeds && !read ? shadows.needsRow : shadows.card,
      ]}
    >
      {isSystem ? (
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 13,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: item.kind === 'streak' || item.kind === 'due' ? color.ink : color.avatarText,
          }}
        >
          <Icon
            name={TIER_ICON[item.kind] ?? 'due'}
            size={17}
            color={item.kind === 'streak' ? color.lime : color.paper}
          />
        </View>
      ) : (
        <View style={{ flexDirection: 'row' }}>
          {faces.map((k, i) => (
            <Avatar
              key={k}
              who={k}
              size={38}
              style={{
                marginLeft: i ? -13 : 0,
                borderWidth: 2,
                borderColor: isNeeds && !read ? color.askTint : color.card,
                zIndex: 9 - i,
              }}
            />
          ))}
        </View>
      )}

      <View style={fill}>
        <Sans size={13.5} lineHeight={18} color={isNeeds && !read ? color.ink : color.muted}>
          <Sans size={13.5} weight={700} color={color.ink}>
            {name}
          </Sans>
          {' '}
          {item.text}
        </Sans>
        <View style={[row, { gap: 7, marginTop: 3 }]}>
          <Sans size={11} color={color.faintInk}>
            {item.time}
          </Sans>
          {item.aging ? (
            <View style={{ backgroundColor: '#F6E6C8', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
              <Bri size={10} weight={800} color="#8A6218">
                waiting {item.aging}
              </Bri>
            </View>
          ) : null}
        </View>
      </View>

      {item.cta ? (
        <View
          style={{
            borderRadius: 999,
            paddingHorizontal: 12,
            paddingVertical: 7,
            backgroundColor: isNeeds && !read ? color.lime : color.chip,
          }}
        >
          <Sans size={11.5} weight={700} color={color.ink}>
            {item.cta}
          </Sans>
        </View>
      ) : null}
    </Tap>
  );
}
