// SafeAreaProvider measures via onLayout, which never fires under the test
// renderer, so without this the whole tree renders empty.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
