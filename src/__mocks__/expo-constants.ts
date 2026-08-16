/**
 * expo-constants, for the one field that decides whether a push token can
 * exist: the EAS project id.
 *
 * Two places hold it — `easConfig` in a development build and
 * `expoConfig.extra.eas` in a release one — and reading only one of them is a
 * bug that appears in exactly half of builds. The fake models both so a test
 * can put the id in either place, or neither.
 */
type Extra = { eas?: { projectId?: string } };

const state: { easConfig: { projectId?: string } | null; extra: Extra } = {
  easConfig: null,
  extra: {},
};

export const fakeConstants = {
  reset(): void {
    state.easConfig = null;
    state.extra = {};
  },
  /** A development build: the id arrives on `easConfig`. */
  easConfigProject(projectId: string): void {
    state.easConfig = { projectId };
  },
  /** A release build: the id is baked into the manifest's `extra`. */
  manifestProject(projectId: string): void {
    state.extra = { eas: { projectId } };
  },
};

export default {
  get easConfig() {
    return state.easConfig;
  },
  get expoConfig() {
    return { extra: state.extra };
  },
};
