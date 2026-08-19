/**
 * The 44pt guarantee, and the hole that used to be in it.
 *
 * `Tap` grows a small control's touch area with hitSlop rather than with its
 * visual box, so the dense card grammar survives. That only worked for a
 * control whose style *declared* a size — one sized by its own text had no
 * number to read, so the slop came out zero and several shipped controls sat
 * near 30pt while appearing to be covered. The measured path closes that.
 */
import React from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import { Tap } from '../primitives';

/** What the renderer will report for a control that declares no size. */
const layout = (w: number, h: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: w, height: h } } });

const slopOf = (label: string) => screen.getByLabelText(label).props.hitSlop;

describe('the 44pt target', () => {
  it('grows a declared box that is too small', () => {
    render(<Tap accessibilityLabel="chip" style={{ width: 24, height: 24 }} />);
    // 10 a side takes 24 to 44.
    expect(slopOf('chip')).toEqual({ top: 10, bottom: 10, left: 10, right: 10 });
  });

  it('leaves a box that is already big enough alone', () => {
    render(<Tap accessibilityLabel="big" style={{ width: 60, height: 50 }} />);
    expect(slopOf('big')).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });

  it('reads minHeight as the height, which is how call sites declare it', () => {
    render(<Tap accessibilityLabel="row" style={{ minHeight: 36 }} />);
    expect(slopOf('row')).toMatchObject({ top: 4, bottom: 4 });
  });

  it('measures a control that declares nothing, and grows it', () => {
    render(
      <Tap accessibilityLabel="text-only">
        <Text>Say something</Text>
      </Tap>,
    );
    // Before layout there is nothing to go on — this is the state the old
    // implementation was stuck in permanently.
    expect(slopOf('text-only')).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });

    act(() => screen.getByLabelText('text-only').props.onLayout(layout(80, 30)));

    // 7 a side takes 30 to 44; the width was already past it.
    expect(slopOf('text-only')).toMatchObject({ top: 7, bottom: 7, left: 0, right: 0 });
  });

  it('does not measure a control that opted out', () => {
    render(<Tap accessibilityLabel="card" minSize={0} />);
    // A card-sized Tap says so deliberately, and pays no layout pass for it.
    expect(screen.getByLabelText('card').props.onLayout).toBeUndefined();
  });

  it('does not measure a control that already declared its size', () => {
    render(<Tap accessibilityLabel="declared" style={{ width: 30, height: 30 }} />);
    expect(screen.getByLabelText('declared').props.onLayout).toBeUndefined();
  });
});
