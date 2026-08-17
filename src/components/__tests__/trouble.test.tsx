/**
 * The shared inline failure line. Two screens render it and neither had a test
 * of its own — `flow.test.tsx` covers onboarding's use, and the create-circle
 * sheet's had nothing at all, which is how the two copies were free to drift
 * apart (one rounded to `radius.chip`, the other to a hardcoded 12).
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Trouble } from '../Trouble';

type Node = { props?: Record<string, unknown>; children?: unknown };

/**
 * Asked of the rendered markup rather than through `getByRole`, because a plain
 * `View` is not an accessibility element and a role query answers null whether
 * the alert is there or not — which would make the negative cases below pass
 * for the wrong reason.
 */
const alertNode = (tree: unknown): Node | null => {
  if (!tree || typeof tree !== 'object') return null;
  const node = tree as Node;
  if (node.props?.accessibilityRole === 'alert') return node;
  const kids = Array.isArray(node.children) ? node.children : [];
  for (const kid of kids) {
    const found = alertNode(kid);
    if (found) return found;
  }
  return null;
};

it('says nothing when there is nothing wrong', () => {
  expect(alertNode(render(<Trouble message={null} />).toJSON())).toBeNull();
  expect(alertNode(render(<Trouble message={undefined} />).toJSON())).toBeNull();
  // The empty string is the one a caller reaches by accident, clearing its
  // error state with `setTrouble('')` — an empty pill is worse than no pill.
  expect(alertNode(render(<Trouble message="" />).toJSON())).toBeNull();
});

it('announces the message rather than only drawing it', () => {
  const tree = render(<Trouble message="That code didn’t work." />).toJSON();

  // Both matter: the design has no failure state, so this line is the only
  // signal the button did anything, and a screen reader has to be told.
  expect(alertNode(tree)?.props?.accessibilityLiveRegion).toBe('polite');
  expect(screen.getByText('That code didn’t work.')).toBeTruthy();
});
