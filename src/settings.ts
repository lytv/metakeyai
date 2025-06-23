const { ipcRenderer: settingsIpcRenderer } = require('electron');

interface Settings {
  OPENAI_API_KEY: string;
  QUICK_EDIT_MODEL_OPENAI: string;
  WHISPER_MODEL: string;
  TTS_VOICE: string;
  shortcuts: { id: string, key: string }[];
}

interface ShortcutConfig {
  id: string;
  name: string;
  description: string;
  defaultKey: string;
  currentKey: string;
  category: 'clipboard' | 'ai' | 'voice' | 'spells' | 'navigation';
}

class SettingsRenderer {
  private apiKeyInput: HTMLInputElement;
  private quickEditModelSelect: HTMLSelectElement;
  private whisperModelSelect: HTMLSelectElement;
  private ttsVoiceSelect: HTMLSelectElement;
  private testVoiceBtn: HTMLButtonElement;
  private saveBtn: HTMLButtonElement;
  private resetBtn: HTMLButtonElement;
  private resetShortcutsBtn: HTMLButtonElement;
  private saveStatus: HTMLElement;
  private apiStatus: HTMLElement;
  private shortcutsContainer: HTMLElement;
  
  private shortcuts: ShortcutConfig[] = [];
  private editingShortcut: string | null = null;
  
  private currentSettings: Settings = {
    OPENAI_API_KEY: '',
    QUICK_EDIT_MODEL_OPENAI: 'gpt-4o',
    WHISPER_MODEL: 'whisper-1',
    TTS_VOICE: 'ballad',
    shortcuts: []
  };

  constructor() {
    this.apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
    this.quickEditModelSelect = document.getElementById('quick-edit-model') as HTMLSelectElement;
    this.whisperModelSelect = document.getElementById('whisper-model') as HTMLSelectElement;
    this.ttsVoiceSelect = document.getElementById('tts-voice') as HTMLSelectElement;
    this.testVoiceBtn = document.getElementById('test-voice') as HTMLButtonElement;
    this.saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
    this.resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
    this.resetShortcutsBtn = document.getElementById('reset-shortcuts-btn') as HTMLButtonElement;
    this.saveStatus = document.getElementById('save-status')!;
    this.apiStatus = document.getElementById('api-status')!;
    this.shortcutsContainer = document.getElementById('shortcuts-container')!;

    this.setupEventListeners();
    this.loadSettings();
    this.loadShortcuts();
  }

  private setupEventListeners() {
    // Save button
    this.saveBtn.addEventListener('click', () => {
      this.saveSettings();
    });

    // Reset button
    this.resetBtn.addEventListener('click', () => {
      this.resetToDefaults();
    });

    // Reset shortcuts button
    this.resetShortcutsBtn.addEventListener('click', () => {
      this.resetAllShortcuts();
    });

    // Test voice button
    this.testVoiceBtn.addEventListener('click', () => {
      this.testVoice();
    });

    // API key input validation
    this.apiKeyInput.addEventListener('input', () => {
      this.validateApiKey();
    });

    // Form change detection
    [this.apiKeyInput, this.quickEditModelSelect, this.whisperModelSelect, this.ttsVoiceSelect].forEach(element => {
      element.addEventListener('change', () => {
        this.markUnsaved();
      });
    });

    // IPC listeners
    settingsIpcRenderer.on('settings-loaded', (event: any, settings: Settings) => {
      this.currentSettings = settings;
      this.shortcuts = settings.shortcuts.map(s => ({
        ...this.shortcuts.find(def => def.id === s.id)!,
        currentKey: s.key,
      }));
      this.populateForm();
      this.renderShortcuts();
      this.validateApiKey();
    });

    settingsIpcRenderer.on('settings-saved', (event: any, success: boolean, message: string) => {
      this.showSaveStatus(success, message);
    });

    settingsIpcRenderer.on('api-key-validated', (event: any, isValid: boolean) => {
      this.updateApiStatus(isValid);
    });
  }

  private loadSettings() {
    console.log('📋 Loading settings from main process...');
    settingsIpcRenderer.send('load-settings');
  }

  private populateForm() {
    console.log('🔄 Populating form with settings:', this.currentSettings);
    
    // Mask API key for display
    if (this.currentSettings.OPENAI_API_KEY) {
      this.apiKeyInput.value = this.currentSettings.OPENAI_API_KEY.substring(0, 8) + '...';
      this.apiKeyInput.setAttribute('data-full-key', this.currentSettings.OPENAI_API_KEY);
    }
    
    this.quickEditModelSelect.value = this.currentSettings.QUICK_EDIT_MODEL_OPENAI;
    this.whisperModelSelect.value = this.currentSettings.WHISPER_MODEL;
    this.ttsVoiceSelect.value = this.currentSettings.TTS_VOICE;

    this.clearSaveStatus();
  }

  private saveSettings() {
    console.log('💾 Saving settings...');
    
    // Collect shortcut configurations from the UI
    const shortcutConfigs = this.shortcuts.map(shortcut => ({
      id: shortcut.id,
      key: shortcut.currentKey,
    }));

    const settings: Settings = {
      OPENAI_API_KEY: this.getApiKey(),
      QUICK_EDIT_MODEL_OPENAI: this.quickEditModelSelect.value,
      WHISPER_MODEL: this.whisperModelSelect.value,
      TTS_VOICE: this.ttsVoiceSelect.value,
      shortcuts: shortcutConfigs,
    };

    console.log('📤 Sending settings to main process:', {
      ...settings,
      OPENAI_API_KEY: settings.OPENAI_API_KEY ? settings.OPENAI_API_KEY.substring(0, 8) + '...' : 'empty'
    });

    settingsIpcRenderer.send('save-settings', settings);
    this.showSaveStatus(null, 'Saving...');
  }

  private resetToDefaults() {
    console.log('🔄 Resetting to defaults...');
    
    this.apiKeyInput.value = '';
    this.apiKeyInput.removeAttribute('data-full-key');
    this.quickEditModelSelect.value = 'gpt-4.1';
    this.whisperModelSelect.value = 'whisper-1';
    this.ttsVoiceSelect.value = 'Nova';
    
    this.markUnsaved();
    this.updateApiStatus(false);
  }

  private testVoice() {
    console.log('🔊 Testing voice:', this.ttsVoiceSelect.value);
    
    const testText = "Hello! This is a test of the " + this.ttsVoiceSelect.value + " voice. How does it sound?";
    
    this.testVoiceBtn.textContent = '🔄 Testing...';
    this.testVoiceBtn.disabled = true;
    
    settingsIpcRenderer.send('test-voice', {
      voice: this.ttsVoiceSelect.value,
      text: testText
    });

    // Reset button after a delay
    setTimeout(() => {
      this.testVoiceBtn.textContent = '🔊 Test Voice';
      this.testVoiceBtn.disabled = false;
    }, 3000);
  }

  private validateApiKey() {
    const apiKey = this.getApiKey();
    
    if (!apiKey) {
      this.updateApiStatus(false);
      return;
    }

    if (apiKey.length < 20 || !apiKey.startsWith('sk-')) {
      this.updateApiStatus(false);
      return;
    }

    // Test API key with main process
    settingsIpcRenderer.send('validate-api-key', apiKey);
  }

  private getApiKey(): string {
    // If the input shows masked value, get the full key from data attribute
    const fullKey = this.apiKeyInput.getAttribute('data-full-key');
    if (fullKey && this.apiKeyInput.value.includes('...')) {
      return fullKey;
    }
    return this.apiKeyInput.value.trim();
  }

  private updateApiStatus(isValid: boolean) {
    const dot = this.apiStatus.querySelector('.api-status-dot')!;
    const text = this.apiStatus.querySelector('span')!;
    
    if (isValid) {
      this.apiStatus.className = 'api-status connected';
      text.textContent = 'Connected';
    } else {
      this.apiStatus.className = 'api-status disconnected';
      text.textContent = 'Not Connected';
    }
  }

  private markUnsaved() {
    this.showSaveStatus(null, 'Unsaved changes');
  }

  private showSaveStatus(success: boolean | null, message: string) {
    this.saveStatus.textContent = message;
    
    if (success === true) {
      this.saveStatus.className = 'status success';
    } else if (success === false) {
      this.saveStatus.className = 'status error';
    } else {
      this.saveStatus.className = 'status';
    }

    // Clear status after delay for success/error messages
    if (success !== null) {
      setTimeout(() => {
        this.clearSaveStatus();
      }, 3000);
    }
  }

  private clearSaveStatus() {
    this.saveStatus.textContent = '';
    this.saveStatus.className = 'status';
  }

  // Shortcuts Management
  private async loadShortcuts() {
    // This is now handled by the main process loading settings
    const allShortcuts: ShortcutConfig[] = await settingsIpcRenderer.invoke('get-shortcuts');
    this.shortcuts = allShortcuts;
    this.renderShortcuts();
  }

  private renderShortcuts() {
    // Group shortcuts by category
    const categories = {
      ai: { name: '🤖 AI Features', shortcuts: [] as ShortcutConfig[] },
      voice: { name: '🎤 Voice Features', shortcuts: [] as ShortcutConfig[] },
      clipboard: { name: '📋 Clipboard', shortcuts: [] as ShortcutConfig[] },
      navigation: { name: '🧭 Navigation', shortcuts: [] as ShortcutConfig[] },
      spells: { name: '🧙‍♂️ Python Spells', shortcuts: [] as ShortcutConfig[] }
    };

    // Group shortcuts by category
    this.shortcuts.forEach(shortcut => {
      if (categories[shortcut.category]) {
        categories[shortcut.category].shortcuts.push(shortcut);
      }
    });

    // Render categories
    this.shortcutsContainer.innerHTML = '';
    Object.entries(categories).forEach(([categoryKey, category]) => {
      if (category.shortcuts.length === 0) return;

      const categoryDiv = document.createElement('div');
      categoryDiv.className = 'shortcuts-category';

      const titleDiv = document.createElement('div');
      titleDiv.className = 'shortcuts-category-title';
      titleDiv.textContent = category.name;

      const gridDiv = document.createElement('div');
      gridDiv.className = 'shortcuts-grid';

      category.shortcuts.forEach(shortcut => {
        const shortcutRow = this.createShortcutRow(shortcut);
        gridDiv.appendChild(shortcutRow);
      });

      categoryDiv.appendChild(titleDiv);
      categoryDiv.appendChild(gridDiv);
      this.shortcutsContainer.appendChild(categoryDiv);
    });
  }

  private createShortcutRow(shortcut: ShortcutConfig): HTMLElement {
    const row = document.createElement('div');
    row.className = 'shortcut-row';
    row.setAttribute('data-shortcut-id', shortcut.id);

    const info = document.createElement('div');
    info.className = 'shortcut-info';

    const name = document.createElement('div');
    name.className = 'shortcut-name';
    name.textContent = shortcut.name;

    const description = document.createElement('div');
    description.className = 'shortcut-description';
    description.textContent = shortcut.description;

    info.appendChild(name);
    info.appendChild(description);

    const keyContainer = document.createElement('div');
    keyContainer.className = 'shortcut-key-container';

    const keyDisplay = document.createElement('div');
    keyDisplay.className = 'shortcut-key-display';
    if (shortcut.currentKey) {
      keyDisplay.textContent = this.formatShortcutKey(shortcut.currentKey);
    } else {
      keyDisplay.textContent = 'Click to assign';
      keyDisplay.setAttribute('data-empty', 'true');
    }
    keyDisplay.addEventListener('click', () => this.editShortcut(shortcut.id));

    const actions = document.createElement('div');
    actions.className = 'shortcut-actions';

    const resetBtn = document.createElement('button');
    resetBtn.className = 'shortcut-btn reset';
    resetBtn.textContent = '↺';
    resetBtn.title = 'Reset to default';
    resetBtn.addEventListener('click', () => this.resetShortcut(shortcut.id));

    actions.appendChild(resetBtn);
    keyContainer.appendChild(keyDisplay);
    keyContainer.appendChild(actions);

    row.appendChild(info);
    row.appendChild(keyContainer);

    return row;
  }

  private formatShortcutKey(key: string): string {
    return key
      .replace('CommandOrControl', 'Ctrl')
      .replace('numdiv', 'Num/')
      .replace('numsub', 'Num-')
      .replace('numadd', 'Num+')
      .replace('Left', '←')
      .replace('Right', '→')
      .replace('Up', '↑')
      .replace('Down', '↓')
      .replace(/\+/g, ' + ');
  }

  private async editShortcut(shortcutId: string) {
    if (this.editingShortcut) return; // Already editing another shortcut

    this.editingShortcut = shortcutId;
    const keyDisplay = document.querySelector(`[data-shortcut-id="${shortcutId}"] .shortcut-key-display`) as HTMLElement;
    
    if (!keyDisplay) return;

    keyDisplay.classList.add('editing');
    keyDisplay.textContent = 'Press keys...';

    const handleKeyPress = async (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      // Build the shortcut key string
      const modifiers = [];
      if (event.ctrlKey || event.metaKey) modifiers.push('CommandOrControl');
      if (event.altKey) modifiers.push('Alt');
      if (event.shiftKey) modifiers.push('Shift');

      let key = event.key;
      
      // Handle special keys
      if (key === 'ArrowLeft') key = 'Left';
      else if (key === 'ArrowRight') key = 'Right';
      else if (key === 'ArrowUp') key = 'Up';
      else if (key === 'ArrowDown') key = 'Down';
      else if (key === 'NumpadDivide') key = 'numdiv';
      else if (key === 'NumpadSubtract') key = 'numsub';
      else if (key === 'NumpadAdd') key = 'numadd';
      else if (key.startsWith('Digit')) key = key.replace('Digit', '');
      else if (key.startsWith('Numpad')) key = 'num' + key.replace('Numpad', '').toLowerCase();
      else if (key.length === 1) key = key.toLowerCase();

      // Skip if it's just a modifier key
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
        return;
      }

      // Allow clearing shortcuts with Delete or Backspace
      if (key === 'Delete' || key === 'Backspace') {
        const success = await settingsIpcRenderer.invoke('update-shortcut', shortcutId, '');
        if (success) {
          const shortcut = this.shortcuts.find(s => s.id === shortcutId);
          if (shortcut) {
            shortcut.currentKey = '';
          }
          finishAndCleanup('');
        } else {
          finishAndCleanup(null);
        }
        return;
      }

      const newShortcutKey = modifiers.length > 0 ? `${modifiers.join('+')}+${key}` : key;

      // Check for conflicts
      const conflict = await settingsIpcRenderer.invoke('test-shortcut-key', newShortcutKey);
      
      if (!conflict.available) {
        keyDisplay.classList.add('shortcut-conflict');
        keyDisplay.textContent = `Conflict: ${conflict.usedBy}`;
        setTimeout(() => {
          finishAndCleanup(null);
        }, 2000);
        return;
      }

      // Update the shortcut
      const success = await settingsIpcRenderer.invoke('update-shortcut', shortcutId, newShortcutKey);
      
      if (success) {
        // Update local data
        const shortcut = this.shortcuts.find(s => s.id === shortcutId);
        if (shortcut) {
          shortcut.currentKey = newShortcutKey;
        }
        finishAndCleanup(newShortcutKey);
      } else {
        keyDisplay.classList.add('shortcut-conflict');
        keyDisplay.textContent = 'Failed to set';
        setTimeout(() => {
          finishAndCleanup(null);
        }, 2000);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        finishAndCleanup(null);
      }
    };

    // Listen until a valid (non-modifier) key is pressed or the user cancels.
    // We remove the listeners manually inside finishEditingShortcut / cleanup.
    document.addEventListener('keydown', handleKeyPress);
    document.addEventListener('keydown', handleEscape);

    // Helper to clean up listeners when editing ends
    const cleanupListeners = () => {
      document.removeEventListener('keydown', handleKeyPress);
      document.removeEventListener('keydown', handleEscape);
    };

    // Auto-cancel after 10 seconds
    setTimeout(() => {
      if (this.editingShortcut === shortcutId) {
        finishAndCleanup(null);
      }
    }, 10000);

    const finishAndCleanup = (newKey: string | null) => {
      cleanupListeners();
      this.editingShortcut = null;
      const keyDisplay = document.querySelector(`[data-shortcut-id="${shortcutId}"] .shortcut-key-display`) as HTMLElement;
      
      if (!keyDisplay) return;

      keyDisplay.classList.remove('editing', 'shortcut-conflict');
      
      if (newKey !== null) {
        // newKey can be empty string (for clearing shortcuts)
        if (newKey) {
          keyDisplay.textContent = this.formatShortcutKey(newKey);
          keyDisplay.removeAttribute('data-empty');
        } else {
          keyDisplay.textContent = 'Click to assign';
          keyDisplay.setAttribute('data-empty', 'true');
        }
      } else {
        // Restore original key (null means cancelled)
        const shortcut = this.shortcuts.find(s => s.id === shortcutId);
        if (shortcut) {
          if (shortcut.currentKey) {
            keyDisplay.textContent = this.formatShortcutKey(shortcut.currentKey);
            keyDisplay.removeAttribute('data-empty');
          } else {
            keyDisplay.textContent = 'Click to assign';
            keyDisplay.setAttribute('data-empty', 'true');
          }
        }
      }
    };
  }

  private async resetShortcut(shortcutId: string) {
    const success = await settingsIpcRenderer.invoke('reset-shortcut', shortcutId);
    if (success) {
      await this.loadShortcuts(); // Reload to get updated data
    }
  }

  private async resetAllShortcuts() {
    if (confirm('Reset all shortcuts to their defaults?')) {
      const success = await settingsIpcRenderer.invoke('reset-all-shortcuts');
      if (success) {
        await this.loadShortcuts(); // Reload to get updated data
      }
    }
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new SettingsRenderer();
}); 