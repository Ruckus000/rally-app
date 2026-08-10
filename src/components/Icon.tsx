/**
 * All iconography is inline SVG, stroke-width 2 (2.2–2.6 for close/check/plus),
 * round caps and joins, inheriting the passed colour.
 */
import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

export type IconName =
  | 'bell'
  | 'check'
  | 'chevronLeft'
  | 'close'
  | 'plus'
  | 'comment'
  | 'heart'
  | 'send'
  | 'week'
  | 'circle'
  | 'me'
  | 'due'
  | 'streak'
  | 'wrap';

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
};

export function Icon({ name, size = 20, color = 'currentColor', strokeWidth }: Props) {
  const sw = strokeWidth ?? DEFAULT_STROKE[name] ?? 2;
  const common = {
    stroke: color,
    strokeWidth: sw,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {name === 'bell' && <Path d="M6 17h12M7 17V10a5 5 0 0 1 10 0v7M10 20h4" {...common} />}
      {name === 'check' && <Path d="M5 13l4 4L19 7" {...common} />}
      {name === 'chevronLeft' && <Path d="M14.5 5 8 12l6.5 7" {...common} />}
      {name === 'close' && <Path d="M6 6l12 12M18 6 6 18" {...common} />}
      {name === 'plus' && <Path d="M12 5v14M5 12h14" {...common} />}
      {name === 'comment' && (
        <Path d="M21 11.5a8.4 8.4 0 0 1-12.1 7.5L4 20l1.1-4.8A8.4 8.4 0 1 1 21 11.5z" {...common} />
      )}
      {name === 'heart' && (
        <Path d="M12 20s-7-4.6-7-9.4A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7 2.6C19 15.4 12 20 12 20z" {...common} />
      )}
      {name === 'send' && <Path d="M12 19V6M6.5 11.5 12 6l5.5 5.5" {...common} />}
      {name === 'week' && (
        <>
          <Path d="M5 4v16M5 7h14M5 13h10" {...common} />
          <Circle cx={16} cy={18} r={2.4} fill={color} />
        </>
      )}
      {name === 'circle' && (
        <>
          <Circle cx={8.5} cy={9} r={3.3} {...common} />
          <Circle cx={15.5} cy={9} r={3.3} {...common} />
          <Path d="M3.5 19c.7-2.6 2.6-3.9 5-3.9M20.5 19c-.7-2.6-2.6-3.9-5-3.9" {...common} />
        </>
      )}
      {name === 'me' && (
        <>
          <Circle cx={12} cy={8} r={3.6} {...common} />
          <Path d="M4.5 20c0-3.6 3.4-5.4 7.5-5.4s7.5 1.8 7.5 5.4" {...common} />
        </>
      )}
      {name === 'due' && <Path d="M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" {...common} />}
      {name === 'streak' && (
        <Path
          d="M12 3c1 3.5 4.5 4.5 4.5 8.5A4.5 4.5 0 0 1 12 16a4.5 4.5 0 0 1-4.5-4.5C7.5 9 9 8 12 3ZM7 16c-.6 1-1 2-1 3 0 1.7 2.7 3 6 3s6-1.3 6-3c0-1-.4-2-1-3"
          {...common}
        />
      )}
      {name === 'wrap' && <Path d="M4 6h16M4 12h16M4 18h9" {...common} />}
    </Svg>
  );
}

const DEFAULT_STROKE: Partial<Record<IconName, number>> = {
  check: 2.6,
  plus: 2.6,
  close: 2.2,
  chevronLeft: 2.4,
  send: 2.4,
  comment: 1.8,
};
