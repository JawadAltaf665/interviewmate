import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BridgeService } from '../../core/bridge.service';
import { AppInfo, AppSettings, CredentialMeta } from '../../core/interviewmate-api';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule, DatePipe],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent implements OnInit {
  protected readonly bridge = inject(BridgeService);

  readonly appInfo = signal<AppInfo | null>(null);
  readonly credentials = signal<CredentialMeta[]>([]);
  readonly settings = signal<AppSettings>({ freeTierOnly: true, coachingIntervalSec: 25, allowPaidUsage: false, textModel: 'gemini-3.8-flash' });
  readonly message = signal('');
  readonly error = signal('');

  // add-credential form
  readonly newName = signal('');
  readonly newProject = signal('');
  readonly newKey = signal('');
  readonly testingId = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      this.appInfo.set(await this.bridge.getAppInfo());
      this.credentials.set(await this.bridge.listCredentials());
      this.settings.set(await this.bridge.getSettings());
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not load settings.');
    }
  }

  async addCredential(): Promise<void> {
    this.message.set('');
    this.error.set('');
    const apiKey = this.newKey();
    // Clear the secret from the form immediately, before any async work.
    this.newKey.set('');
    if (!this.newName().trim() || !apiKey.trim()) {
      this.error.set('Give the credential a name and paste its API key.');
      return;
    }
    try {
      const list = await this.bridge.addCredential({
        name: this.newName().trim(),
        projectLabel: this.newProject().trim(),
        apiKey: apiKey.trim(),
      });
      this.credentials.set(list);
      this.newName.set('');
      this.newProject.set('');
      this.message.set('Credential saved. It is stored encrypted by the desktop app — the key itself is never displayed again.');
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not save the credential.');
    }
  }

  async testCredential(cred: CredentialMeta): Promise<void> {
    this.message.set('');
    this.error.set('');
    this.testingId.set(cred.id);
    try {
      const result = await this.bridge.testCredential(cred.id);
      if (result.ok) {
        this.message.set(`"${cred.name}" works${result.modelsCount != null ? ` — ${result.modelsCount} models visible` : ''}. ${result.message}`);
      } else {
        this.error.set(`"${cred.name}" failed (${result.kind ?? 'error'}): ${result.message}`);
      }
      this.credentials.set(await this.bridge.listCredentials());
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Test failed.');
    } finally {
      this.testingId.set(null);
    }
  }

  async toggleDisabled(cred: CredentialMeta): Promise<void> {
    try {
      this.credentials.set(await this.bridge.setCredentialDisabled(cred.id, !cred.disabled));
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not update the credential.');
    }
  }

  async removeCredential(cred: CredentialMeta): Promise<void> {
    if (!window.confirm(`Delete the credential "${cred.name}"? This cannot be undone.`)) return;
    try {
      this.credentials.set(await this.bridge.removeCredential(cred.id));
      this.message.set(`Deleted "${cred.name}".`);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not delete the credential.');
    }
  }

  /** Paid opt-in requires an explicit confirmation — it can cost money. */
  async togglePaidUsage(checked: boolean): Promise<void> {
    if (checked && !window.confirm(
      'Allow paid usage?\n\n' +
      'Paid text models are billed per token by Google to the Cloud project behind your API key. ' +
      'This app never enables billing for you — you must link a billing account in Google AI Studio yourself. ' +
      'A Google AI Pro / Google One subscription does NOT pay for API calls. ' +
      'You can turn this off at any time; turning it off returns the text model to free Gemini 3.8 Flash.')) {
      return; // declined: leave the checkbox as it was
    }
    await this.saveSettings({ allowPaidUsage: checked });
  }

  async saveSettings(partial: Partial<AppSettings>): Promise<void> {
    try {
      this.settings.set(await this.bridge.setSettings(partial));
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not save settings.');
    }
  }

  async clearAll(): Promise<void> {
    if (!window.confirm('Clear ALL local data — saved credentials, settings, and saved sessions? This cannot be undone.')) return;
    try {
      await this.bridge.clearAllData();
      this.message.set('All local data cleared.');
      await this.refresh();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not clear local data.');
    }
  }
}
