import { Component, inject } from '@angular/core';
import { BACKGROUND_COLORS, VirtualBackgroundService } from '../../features/interview-room/virtual-background.service';

/** Teams-style background tiles. Processing happens on this device only. */
@Component({
  selector: 'app-bg-picker',
  standalone: true,
  template: `
    <div class="tiles" role="radiogroup" aria-label="Camera background">
      <button type="button" class="tile none" role="radio" [attr.aria-checked]="vbg.selectedMode() === 'none'" (click)="vbg.select('none')" title="No effect">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="m6.5 17.5 11-11"/></svg>
        <span>None</span>
      </button>
      <button type="button" class="tile blur" role="radio" [attr.aria-checked]="vbg.selectedMode() === 'blur'" (click)="vbg.select('blur')" title="Blur">
        <span>Blur</span>
      </button>
      @for (c of colors; track c.id) {
        <button type="button" class="tile" role="radio" [style.background]="c.hex"
                [attr.aria-checked]="vbg.selectedMode() === 'color' && vbg.selectedColorId() === c.id"
                (click)="vbg.select('color', c.id)" [title]="c.label">
          <span>{{ c.label }}</span>
        </button>
      }
      <label class="tile upload" [class.has-image]="!!vbg.selectedImage()" role="radio" [attr.aria-checked]="vbg.selectedMode() === 'image'" title="Upload an image"
             [style.background-image]="imageUrl()">
        <input type="file" accept="image/*" (change)="onFile($event)" />
        @if (!vbg.selectedImage()) {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        }
        <span>Image</span>
      </label>
    </div>
    @if (vbg.notice()) { <p class="notice warn small mt-3 mb-0" role="status">{{ vbg.notice() }}</p> }
  `,
  styles: `
    .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 0.5rem; }
    .tile {
      position: relative; height: 52px; border-radius: 8px; cursor: pointer; overflow: hidden;
      display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
      border: 2px solid var(--card-border); background: var(--bg-raised) center / cover no-repeat;
      color: #fff; font: inherit; font-size: 0.7rem; font-weight: 600; padding: 0 0 0.2rem;
      transition: border-color 120ms ease, transform 120ms ease;
    }
    .tile:hover { border-color: var(--border-strong); transform: translateY(-1px); }
    .tile[aria-checked="true"] { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(108, 111, 245, 0.25); }
    .tile span { text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7); }
    .tile svg { width: 18px; height: 18px; position: absolute; top: 9px; color: var(--text-dim); }
    .tile.blur::before {
      content: ""; position: absolute; inset: -8px;
      background: radial-gradient(circle at 35% 40%, #c7cde0, transparent 45%), linear-gradient(135deg, #4b5a7a, #8e98b3 50%, #3b4256);
      filter: blur(5px);
    }
    .tile.blur span { position: relative; }
    .tile.upload { border-style: dashed; }
    /* Plain tiles sit on the theme surface, so their label follows the theme. */
    .tile.none span, .tile.upload:not(.has-image) span { color: var(--text-dim); text-shadow: none; }
    .tile.upload input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  `,
})
export class BgPickerComponent {
  protected readonly vbg = inject(VirtualBackgroundService);
  protected readonly colors = BACKGROUND_COLORS;

  protected imageUrl(): string | null {
    const img = this.vbg.selectedImage();
    return img ? `url("${img.src}")` : null;
  }

  protected onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.vbg.selectImageFile(file);
  }
}
