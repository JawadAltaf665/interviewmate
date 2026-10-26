import { Injectable, signal } from '@angular/core';

// Light / dark appearance, applied as <html data-theme="..."> (tokens in
// styles.scss). Dark stays the default. The desktop app saves the choice in its
// settings file (localStorage on file:// did not survive restarts); the
// browser dev preview falls back to localStorage.

export type Theme = 'light' | 'dark';

const THEME_KEY = 'interviewmate.theme';

function savedTheme(): Theme {
  const desktop = window.interviewMate?.initialTheme;
  if (desktop) return desktop;
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(savedTheme());

  constructor() {
    this.apply(this.theme());
  }

  toggle(): void {
    const next: Theme = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* convenience only */ }
    this.apply(next);
  }

  private apply(theme: Theme): void {
    document.documentElement.dataset['theme'] = theme;
    // Desktop: recolour the native minimise/maximise/close buttons too.
    void window.interviewMate?.setTheme?.(theme).catch(() => undefined);
  }
}
