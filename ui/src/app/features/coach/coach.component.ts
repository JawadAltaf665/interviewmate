import { Component, inject, OnInit } from '@angular/core';
import { CoachService } from '../../core/coach.service';
import { CoachChatComponent } from '../../shared/coach-chat/coach-chat.component';

/** The Coach tab: the same conversation as the side panel, full width, with the chat history. */
@Component({
  selector: 'app-coach',
  imports: [CoachChatComponent],
  template: `<app-coach-chat layout="page" />`,
  styles: `:host { display: block; height: 100%; }`,
})
export class CoachComponent implements OnInit {
  private readonly coach = inject(CoachService);

  ngOnInit(): void {
    this.coach.close(); // the page replaces the side panel
    void this.coach.refreshChats();
  }
}
