import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'setup',
    loadComponent: () =>
      import('./features/interview-setup/interview-setup.component').then((m) => m.InterviewSetupComponent),
  },
  {
    // The live room itself is hosted by the app shell (see app.html) so it
    // survives tab switches; this route is the schedule screen around it.
    path: 'interview',
    loadComponent: () =>
      import('./features/interview-hub/interview-hub.component').then((m) => m.InterviewHubComponent),
  },
  {
    path: 'summary',
    loadComponent: () =>
      import('./features/feedback/feedback.component').then((m) => m.FeedbackComponent),
  },
  {
    path: 'reports',
    loadComponent: () =>
      import('./features/reports/reports.component').then((m) => m.ReportsComponent),
  },
  {
    path: 'vocabulary',
    loadComponent: () =>
      import('./features/vocabulary/vocabulary.component').then((m) => m.VocabularyComponent),
  },
  {
    path: 'coach',
    loadComponent: () =>
      import('./features/coach/coach.component').then((m) => m.CoachComponent),
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./features/settings/settings.component').then((m) => m.SettingsComponent),
  },
  { path: '**', redirectTo: '' },
];
