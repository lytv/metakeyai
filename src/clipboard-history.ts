import { clipboard } from 'electron';
import { EventEmitter } from 'events';

export interface ClipboardEntry {
  id: string;
  text: string;
  timestamp: Date;
}

export class ClipboardHistory extends EventEmitter {
  private history: ClipboardEntry[] = [];
  private currentIndex = -1;
  private maxEntries = 50;
  private lastClipboardText = '';
  private checkInterval: NodeJS.Timeout | null = null;
  private isInternalChange = false;

  constructor(maxEntries = 50) {
    super();
    this.maxEntries = maxEntries;
    
    // Initialize with current clipboard content
    const currentText = clipboard.readText();
    if (currentText) {
      this.lastClipboardText = currentText;
      this.addEntry(currentText);
    }
    
    this.startMonitoring();
  }

  private startMonitoring() {
    // Check clipboard every 500ms for changes
    this.checkInterval = setInterval(() => {
      const currentText = clipboard.readText();
      if (currentText && currentText !== this.lastClipboardText && !this.isInternalChange) {
        this.addEntry(currentText);
        this.lastClipboardText = currentText;
      }
      // Reset internal change flag after each check
      this.isInternalChange = false;
    }, 500);
  }

  private addEntry(text: string) {
    // Don't add empty or duplicate entries
    if (!text.trim() || (this.history.length > 0 && this.history[0].text === text)) {
      return;
    }

    const entry: ClipboardEntry = {
      id: Date.now().toString(),
      text: text,
      timestamp: new Date()
    };

    // Add to beginning of array
    this.history.unshift(entry);
    
    // Adjust current index when new entry is added (shift all indices by 1)
    if (this.currentIndex >= 0) {
      this.currentIndex += 1;
    }
    // If this is the first entry or we want to point to the new entry
    if (this.history.length === 1) {
      this.currentIndex = 0;
    }

    // Limit history size
    if (this.history.length > this.maxEntries) {
      this.history = this.history.slice(0, this.maxEntries);
      // Adjust index if it's beyond the new size
      if (this.currentIndex >= this.history.length) {
        this.currentIndex = this.history.length - 1;
      }
    }

    console.log('📋 Clipboard history updated, entries:', this.history.length, 'currentIndex:', this.currentIndex);
    this.emit('history-updated', this.getCurrentEntry());
  }

  public cycleNext(): ClipboardEntry | null {
    if (this.history.length === 0) return null;

    this.currentIndex = (this.currentIndex + 1) % this.history.length;
    const entry = this.history[this.currentIndex];
    
    // Mark as internal change to prevent monitoring from adding it again
    this.isInternalChange = true;
    clipboard.writeText(entry.text);
    this.lastClipboardText = entry.text;
    
    console.log('➡️ Cycled to next clipboard entry:', this.currentIndex + 1, '/', this.history.length, 'Text:', entry.text.substring(0, 30) + '...');
    this.emit('current-changed', entry);
    return entry;
  }

  public cyclePrevious(): ClipboardEntry | null {
    if (this.history.length === 0) return null;

    this.currentIndex = this.currentIndex <= 0 ? this.history.length - 1 : this.currentIndex - 1;
    const entry = this.history[this.currentIndex];
    
    // Mark as internal change to prevent monitoring from adding it again
    this.isInternalChange = true;
    clipboard.writeText(entry.text);
    this.lastClipboardText = entry.text;
    
    console.log('⬅️ Cycled to previous clipboard entry:', this.currentIndex + 1, '/', this.history.length, 'Text:', entry.text.substring(0, 30) + '...');
    this.emit('current-changed', entry);
    return entry;
  }

  public getCurrentEntry(): ClipboardEntry | null {
    if (this.history.length === 0 || this.currentIndex < 0) return null;
    return this.history[this.currentIndex];
  }

  public getHistory(): ClipboardEntry[] {
    return [...this.history];
  }

  public getCurrentIndex(): number {
    return this.currentIndex;
  }

  public getHistoryLength(): number {
    return this.history.length;
  }

  public destroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.removeAllListeners();
  }

  public clearHistory(): void {
    this.history = [];
    this.currentIndex = -1;
    this.lastClipboardText = ''; // Also clear the last tracked text
    
    // We can also clear the system clipboard
    // Be cautious with this, as it might not be expected by the user.
    // Let's make it an option or just clear our internal history.
    // For now, let's just clear our history.
    // clipboard.clear();

    console.log('🧹 Clipboard history cleared.');
    this.emit('history-cleared');
  }

  public deleteCurrentEntry(): ClipboardEntry | null {
    if (this.history.length === 0 || this.currentIndex < 0) {
      console.log('🗑️ No entry to delete.');
      return null;
    }
  
    const deletedEntry = this.history.splice(this.currentIndex, 1)[0];
    console.log('🗑️ Deleted entry:', deletedEntry.text.substring(0, 30) + '...');
  
    // If the history is now empty
    if (this.history.length === 0) {
      this.currentIndex = -1;
      this.lastClipboardText = '';
      this.isInternalChange = true;
      clipboard.clear();
    } else {
      // If the index is now out of bounds (we deleted the last item),
      // move it to the new last item.
      if (this.currentIndex >= this.history.length) {
        this.currentIndex = this.history.length - 1;
      }
      // The currentIndex now points to the next item, which is correct.
      // Let's update the system clipboard with the new current item.
      const newCurrentEntry = this.history[this.currentIndex];
      this.lastClipboardText = newCurrentEntry.text;
      this.isInternalChange = true;
      clipboard.writeText(newCurrentEntry.text);
    }
  
    console.log('📋 Clipboard history updated after deletion, entries:', this.history.length, 'currentIndex:', this.currentIndex);
    this.emit('history-updated', this.getCurrentEntry()); 
    
    return deletedEntry;
  }
} 