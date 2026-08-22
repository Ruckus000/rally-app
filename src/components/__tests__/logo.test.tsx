/**
 * The identity spec's rules, as behaviour.
 *
 * A brand guideline is a PDF nobody opens twice. The parts of it that can be
 * enforced — which colour is allowed where, and the size at which the drawing
 * has to change — live in the component, and this is what holds them there.
 *
 * Colours are asserted against tokens rather than hex literals, as everywhere
 * else in this suite. The exception is the *flipping* question: these read the
 * static `color` export on purpose, because a logo's colorway follows the
 * ground it is placed on and must not follow the device's scheme.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Circle, Path } from 'react-native-svg';

import { Logo, LogoMark, clearSpaceFor } from '../Logo';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { MARK_CORE_R, MARK_CORE_R_SMALL, MARK_CORE_R_SOLID, MARK_WEDGE, MARK_WEDGE_SMALL } from '../../theme/mark';
import { color, onDark } from '../../theme/tokens';

const wedges = () => screen.UNSAFE_getAllByType(Path);
const core = () => screen.UNSAFE_getAllByType(Circle)[0];

describe('Logo', () => {
  it('draws five wedges and one core', () => {
    render(<LogoMark />);
    expect(wedges()).toHaveLength(5);
    expect(screen.UNSAFE_getAllByType(Circle)).toHaveLength(1);
  });

  it('is ink and olive by default', () => {
    render(<LogoMark />);
    expect(wedges()[0].props.fill).toBe(color.ink);
    expect(core().props.fill).toBe(color.moss);
  });

  it('reversed moves only the core to lime', () => {
    // "The core switches to lime — it is the only element that changes."
    render(<LogoMark tone="reversed" />);
    expect(wedges()[0].props.fill).toBe(onDark.primary);
    expect(core().props.fill).toBe(color.lime);
  });

  it('never paints the wedges lime', () => {
    // The misuse panel's second entry. Lime is only ever the core.
    for (const tone of ['ink', 'reversed', 'solid'] as const) {
      render(<LogoMark tone={tone} />);
      expect(wedges()[0].props.fill).not.toBe(color.lime);
      screen.unmount();
    }
  });

  it('fuses the huddle when it is one colour', () => {
    render(<LogoMark tone="solid" />);
    expect(core().props.fill).toBe(wedges()[0].props.fill);
    expect(core().props.r).toBe(MARK_CORE_R_SOLID);
  });

  it('switches to the small cut below 22px', () => {
    render(<LogoMark size={20} />);
    expect(wedges()[0].props.d).toBe(MARK_WEDGE_SMALL);
    expect(core().props.r).toBe(MARK_CORE_R_SMALL);
  });

  it('keeps the standard cut at and above 22px', () => {
    render(<LogoMark size={22} />);
    expect(wedges()[0].props.d).toBe(MARK_WEDGE);
    expect(core().props.r).toBe(MARK_CORE_R);
  });

  it('warns below the 16px floor', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    render(<LogoMark size={12} />);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('16px minimum'));
    warn.mockRestore();
  });

  it.each(['horizontal', 'stacked'] as const)('%s locks the wordmark to the mark', (variant) => {
    render(<Logo variant={variant} />);
    const word = screen.getByText('Rally');
    // Load-bearing: the mark beside it is a fixed-size SVG, so a wordmark that
    // grew with the OS text size would pull the lockup apart.
    expect(word.props.allowFontScaling).toBe(false);
  });

  it('names the lockup once, not twice', () => {
    // The wordmark is real text and already carries the name; labelling the
    // mark as well has a screen reader say "Rally Rally".
    render(<Logo variant="horizontal" />);
    expect(screen.queryAllByLabelText('Rally')).toHaveLength(0);
    expect(screen.getByText('Rally')).toBeTruthy();
  });

  it('names the mark when it stands alone', () => {
    render(<Logo variant="mark" />);
    expect(screen.getByLabelText('Rally')).toBeTruthy();
  });

  it.each(['light', 'dark'] as const)('does not follow the %s scheme', (scheme) => {
    // A mark that repainted itself with the device is a mark you could not put
    // on a photograph.
    render(
      <ThemeProvider scheme={scheme}>
        <LogoMark tone="reversed" />
      </ThemeProvider>,
    );
    expect(wedges()[0].props.fill).toBe(onDark.primary);
    expect(core().props.fill).toBe(color.lime);
  });

  it('scales clear space with the mark', () => {
    // One core diameter on all four sides, at any size.
    expect(clearSpaceFor(100)).toBe(MARK_CORE_R * 2);
    expect(clearSpaceFor(50)).toBe(MARK_CORE_R);
  });
});
