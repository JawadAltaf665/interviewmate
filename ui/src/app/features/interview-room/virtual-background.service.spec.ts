import {
  BACKGROUND_COLORS,
  BACKGROUND_MODE_KEY,
  isBackgroundMode,
  loadBackgroundMode,
  saveBackgroundMode,
} from './virtual-background.service';

function memoryStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    snapshot: () => ({ ...store }),
  };
}

describe('virtual background mode helpers', () => {
  it('accepts only the four known modes', () => {
    expect(isBackgroundMode('none')).toBe(true);
    expect(isBackgroundMode('blur')).toBe(true);
    expect(isBackgroundMode('color')).toBe(true);
    expect(isBackgroundMode('image')).toBe(true);
    expect(isBackgroundMode('teams')).toBe(false);
    expect(isBackgroundMode('')).toBe(false);
    expect(isBackgroundMode(null)).toBe(false);
    expect(isBackgroundMode(42)).toBe(false);
  });

  it('loads a saved mode and falls back to none for unknown or missing values', () => {
    expect(loadBackgroundMode(memoryStorage({ [BACKGROUND_MODE_KEY]: 'blur' }))).toBe('blur');
    expect(loadBackgroundMode(memoryStorage({ [BACKGROUND_MODE_KEY]: 'bogus' }))).toBe('none');
    expect(loadBackgroundMode(memoryStorage())).toBe('none');
    expect(loadBackgroundMode(null)).toBe('none');
  });

  it('persists only the mode string under the documented key', () => {
    const storage = memoryStorage();
    saveBackgroundMode('color', storage);
    expect(storage.snapshot()).toEqual({ [BACKGROUND_MODE_KEY]: 'color' });
  });

  it('offers exactly three solid colours', () => {
    expect(BACKGROUND_COLORS.length).toBe(3);
    for (const color of BACKGROUND_COLORS) {
      expect(color.hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
