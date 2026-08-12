/**
 * The celebration screen's three states, and the one that used to say the same
 * words twice.
 *
 * `Stat` prints a value under the label "your circle", so the value is the
 * circle's *name*. Joining by code answers with a uuid and no name, and the
 * placeholder that stood in for one read "your circle / your circle" — and
 * announced "Your circle, your circle." to a screen reader.
 *
 * The named case is covered end to end in flow.test.tsx, where the name arrives
 * from the pull. This file owns the case that test cannot reach: the beat
 * before it lands.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { StakedScreen } from '../StakedScreen';

const show = (over: { circle?: string | null; joined?: boolean } = {}) =>
  render(
    <StakedScreen
      stakeSum={35}
      pickCount={1}
      circle={over.circle ?? null}
      joined={over.joined ?? false}
      weekNumber={33}
      onEnter={() => {}}
    />,
  );

describe('the circle you leave onboarding in', () => {
  it('names it when the name is known', () => {
    show({ circle: 'The Basement', joined: true });

    expect(screen.getByText('The Basement')).toBeTruthy();
    expect(screen.getByLabelText(/Your circle, The Basement\./)).toBeTruthy();
  });

  it('never prints "your circle" as the value above the label that says it', () => {
    // Joined, name not pulled yet.
    show({ circle: null, joined: true });

    expect(screen.getByText('Joined')).toBeTruthy();
    expect(screen.getByLabelText(/You’re in a circle\./)).toBeTruthy();
    expect(screen.queryByLabelText(/[Yy]our circle, your circle/)).toBeNull();
    // The closing line still has to read as a sentence without a name.
    expect(screen.getByText(/Everyone in your circle can see your plan/)).toBeTruthy();
  });

  it('says solo when you are in none — the control', () => {
    // Without this, treating every account as "joined" would satisfy the case
    // above while telling someone riding solo they are in a circle.
    show({ circle: null, joined: false });

    expect(screen.getByText('Solo')).toBeTruthy();
    expect(screen.getByLabelText(/Solo for now\./)).toBeTruthy();
  });
});
