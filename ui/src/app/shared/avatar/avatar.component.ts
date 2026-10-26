import { Component, Input } from '@angular/core';
import { AvatarState } from '../../core/live-session';

// Stylized illustrated interviewer (inline SVG, no paid avatar service).
// Animation is driven by the session state: breathing at idle, mouth/head
// motion while speaking, a pulsing ring while listening, dots while thinking,
// a spinning ring while connecting, and a red tint on error.
@Component({
  selector: 'app-avatar',
  standalone: true,
  templateUrl: './avatar.component.html',
  styleUrl: './avatar.component.scss',
})
export class AvatarComponent {
  @Input() state: AvatarState = 'idle';

  stateLabel(): string {
    switch (this.state) {
      case 'speaking': return 'Speaking';
      case 'listening': return 'Listening';
      case 'thinking': return 'Thinking';
      case 'connecting': return 'Connecting';
      case 'error': return 'Connection problem';
      default: return 'Idle';
    }
  }
}
