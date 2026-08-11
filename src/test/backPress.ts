/**
 * Hardware back, for tests.
 *
 * `BackHandler` on iOS — which is jest-expo's default platform — is a stub
 * whose `addEventListener` registers nothing and which can never fire. So the
 * only way to press back in a test is to capture what the overlays register and
 * call it, newest first: overlays stack, and the one on top is the one Android
 * would deliver the press to.
 *
 * Lives outside `__tests__` so jest doesn't try to run it as a suite.
 */
import { BackHandler } from 'react-native';
import { act } from '@testing-library/react-native';

type Handler = () => boolean | null | undefined;

export function captureBackPress() {
  const handlers: Handler[] = [];

  const spy = jest
    .spyOn(BackHandler, 'addEventListener')
    .mockImplementation((_event, handler) => {
      const h = handler as Handler;
      handlers.push(h);
      return {
        remove: () => {
          const i = handlers.lastIndexOf(h);
          if (i >= 0) handlers.splice(i, 1);
        },
      };
    });

  return {
    press: () => {
      const handler = handlers[handlers.length - 1];
      if (!handler) throw new Error('nothing is listening for hardware back');
      act(() => {
        handler();
      });
    },
    restore: () => spy.mockRestore(),
  };
}
