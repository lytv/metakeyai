const { ipcRenderer: pastilleIpcRenderer } = require('electron');

interface ClipboardEntry {
  id: string;
  text: string;
  timestamp: Date;
}

class PastilleRenderer {
  private pastilleElement: HTMLElement;
  private contentElement: HTMLElement;
  private counterElement: HTMLElement;
  private hideTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.pastilleElement = document.getElementById('pastille')!;
    this.contentElement = document.getElementById('content')!;
    this.counterElement = document.getElementById('counter')!;
    
    this.setupEventListeners();
  }

  private setupEventListeners() {
    // Listen for clipboard updates from main process
    pastilleIpcRenderer.on('clipboard-updated', (event: any, data: { entry: ClipboardEntry | null, currentIndex: number, totalCount: number }) => {
      this.updatePastille(data.entry, data.currentIndex, data.totalCount);
    });

    // Listen for show/hide commands
    pastilleIpcRenderer.on('show-pastille', () => {
      this.show();
    });

    pastilleIpcRenderer.on('hide-pastille', () => {
      this.hide();
    });
  }

  private updatePastille(entry: ClipboardEntry | null, currentIndex: number, totalCount: number) {
    console.log('📋 Pastille renderer: updating with entry:', entry?.text?.substring(0, 30) + '...', `${currentIndex + 1}/${totalCount}`);
    
    if (!entry || totalCount === 0) {
      this.contentElement.textContent = 'No clipboard content';
      this.contentElement.className = 'content empty';
      this.counterElement.textContent = '0/0';
    } else {
      // Truncate long text
      const displayText = entry.text.length > 40 
        ? entry.text.substring(0, 40) + '...' 
        : entry.text;
      
      this.contentElement.textContent = displayText;
      this.contentElement.className = 'content';
      this.counterElement.textContent = `${currentIndex + 1}/${totalCount}`;
    }
  }

  private show() {
    console.log('👁️ Pastille renderer: showing pastille');
    this.pastilleElement.classList.remove('hidden');
    
    // Auto-hide after 4 seconds
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
    }
    
    this.hideTimeout = setTimeout(() => {
      this.hide();
    }, 4000);
  }

  private hide() {
    this.pastilleElement.classList.add('hidden');
    
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PastilleRenderer();
}); 