// SafeAreaProvider measures via onLayout, which never fires under the test
// renderer, so without this the whole tree renders empty.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// The official in-memory AsyncStorage stand-in.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
