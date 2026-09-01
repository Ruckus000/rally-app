/**
 * What you reported, and who you blocked, leave the feed you did it from.
 *
 * The sheet on top of the feed already got this right, and says so at
 * `DetailSheet.tsx:164`: "Without this a note you just reported is still
 * sitting there on the screen you reported it from." The list underneath did
 * not, for a reason no reader of either file would spot — `Feed`'s `useMemo`
 * was keyed on three slices and `mergedFeed` reads five, so the two writers
 * that matter here moved a slice nobody was watching and the memo handed back
 * the array it built before.
 *
 * The halves fail differently, which is why both are here. A block is repaired
 * by the next pull, because the SELECT policies drop the blocked person's rows
 * server-side and the shorter array is a new one — up to a minute of showing
 * somebody you have just blocked. A report is repaired by nothing at all:
 * `reported` is local-only by design (`persistence.ts` calls it "the only copy
 * of 'hidden from you'"), so the server keeps returning the row, and only an
 * unrelated change to `moments` ever recomputes the memo. On a quiet account
 * that is hours, and the app said "hidden from you" as it happened.
 *
 * Deliberately driven through `WeekScreen` rather than by calling `mergedFeed`.
 * The selector was always right; the bug lived entirely in what the screen
 * asked it to recompute for, and a selector test would have passed throughout.
 */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import { StoreProvider, useStore } from '../../state/store';
import { WeekScreen } from '../WeekScreen';
import { DEMO_PEOPLE, indexPeople } from '../../data/people';
import type { Moment } from '../../data/fixtures';

const MAYA = 'maya';
const PEOPLE = indexPeople(DEMO_PEOPLE);

const moment = (id: string, title: string): Moment => ({
  id,
  who: MAYA,
  kind: 'normal',
  time: '2h',
  day: 1,
  title,
  pts: 30,
  cmts: [],
});

/** The only way in: these two are dispatched by controls on other screens. */
let fire: ReturnType<typeof useStore>['dispatch'];

function Hold() {
  const { dispatch } = useStore();
  // In an effect, like `reportEntry.test.tsx`'s `Watch`: a render body has to
  // be pure, and `dispatch` is stable, so once is enough.
  React.useEffect(() => {
    fire = dispatch;
  }, [dispatch]);
  return null;
}

const mount = async (moments: Moment[]) => {
  render(
    <StoreProvider
      persist={false}
      sync={false}
      restored={{ account: 'seeded', people: PEOPLE, scope: 'feed', moments }}
    >
      <Hold />
      <WeekScreen />
    </StoreProvider>,
  );
  await act(async () => {});
};

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('drops a post you reported, without waiting for anything to arrive', async () => {
  await mount([moment('m1', 'Ran the whole loop'), moment('m2', 'Swim 2k')]);
  expect(screen.getByText('Ran the whole loop')).toBeTruthy();

  await act(async () => {
    fire({ type: 'REPORT_FILED', id: 'm1' });
  });

  expect(screen.queryByText('Ran the whole loop')).toBeNull();
  // The other card is the control: this is the feed re-deriving, not unmounting.
  expect(screen.getByText('Swim 2k')).toBeTruthy();
});

it('drops the posts of someone you blocked, in the same frame', async () => {
  await mount([moment('m1', 'Ran the whole loop'), moment('m2', 'Swim 2k')]);

  await act(async () => {
    fire({ type: 'BLOCK', id: MAYA });
  });

  expect(screen.queryByText('Ran the whole loop')).toBeNull();
  expect(screen.queryByText('Swim 2k')).toBeNull();
});
