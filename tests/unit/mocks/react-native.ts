/**
 * `Platform` din react-native, cât folosesc modulele din src/lib (OS, Version, select).
 * Obiect mutabil: testul schimbă `OS` ca să verifice ramurile web / Android / iOS.
 */
export type PlatformOS = 'ios' | 'android' | 'web';

export interface PlatformMock {
  OS: PlatformOS;
  Version: string | number | undefined;
  select<T>(options: { ios?: T; android?: T; web?: T; native?: T; default?: T }): T | undefined;
}

export function createPlatform(): PlatformMock {
  return {
    OS: 'ios',
    Version: '17.4',
    select(options) {
      const own = options[this.OS];
      if (own !== undefined) return own;
      if (this.OS !== 'web' && options.native !== undefined) return options.native;
      return options.default;
    },
  };
}
