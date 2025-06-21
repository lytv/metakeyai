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
  private waveCanvas: HTMLCanvasElement;
  private waveCtx: CanvasRenderingContext2D | null;
  private processingInterval: any = null;
  private isRecording = false;
  private fontSize = 15;
  private expanded = false;
  private editor: HTMLTextAreaElement;
  private dragbar: HTMLElement;
  private backdrop: HTMLElement;

  constructor() {
    this.pastilleElement = document.getElementById('pastille')!;
    this.contentElement = document.getElementById('content')!;
    this.counterElement = document.getElementById('counter')!;
    this.waveCanvas = document.getElementById('waveform') as HTMLCanvasElement;
    this.waveCtx = this.waveCanvas.getContext('2d');
    this.editor = document.getElementById('editor') as HTMLTextAreaElement;
    this.dragbar = document.getElementById('dragbar')!;
    this.backdrop = document.getElementById('backdrop')!;

    // Set canvas size to match styles
    this.waveCanvas.width = 300;
    this.waveCanvas.height = 40;
    
    // Apply initial font size
    this.applyFontSize();

    // Listen for Ctrl+Alt scroll to change font size
    document.addEventListener('wheel', (e) => {
      if (e.altKey && e.ctrlKey) {
        e.preventDefault();
        if (e.deltaY < 0) {
          this.fontSize = Math.min(this.fontSize + 1, 32);
        } else {
          this.fontSize = Math.max(this.fontSize - 1, 10);
        }
        this.applyFontSize();
      }
    }, { passive: false });

    this.setupEventListeners();

    // Toggle expand on double click
    this.pastilleElement.addEventListener('dblclick', () => {
      this.toggleExpand();
    });

    this.backdrop.addEventListener('click', () => this.collapse());
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

    // Generic notification
    pastilleIpcRenderer.on('show-message', (_: any, message: string) => {
      this.showMessage(message);
    });

    // Recording lifecycle
    pastilleIpcRenderer.on('start-recording', (_: any, msg: string) => {
      this.startRecording(msg);
    });

    pastilleIpcRenderer.on('audio-data', (_: any, data: Buffer) => {
      this.drawWaveform(data);
    });

    pastilleIpcRenderer.on('show-processing', (_: any, msg: string) => {
      this.showProcessing(msg);
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
      const displayText = entry.text.length > 80 
        ? entry.text.substring(0, 80) + '...' 
        : entry.text;
      
      this.contentElement.textContent = displayText;
      if (!this.expanded) {
        this.contentElement.className = 'content';
      }
      this.counterElement.textContent = `${currentIndex + 1}/${totalCount}`;
    }
  }

  private show() {
    console.log('👁️ Pastille renderer: showing pastille');
    this.pastilleElement.classList.remove('hidden');
  }

  private hide() {
    this.pastilleElement.classList.add('hidden');
  }

  private showMessage(message: string) {
    console.log('🔔 Pastille renderer: showing message:', message);
    this.clearProcessing();
    this.isRecording = false;
    this.waveCanvas.classList.add('hidden');
    this.contentElement.textContent = message;
    this.contentElement.className = 'content';
    this.counterElement.textContent = '';
    this.show();
  }

  // Recording UI
  private startRecording(message: string) {
    console.log('🎤 Pastille renderer: start recording');
    this.clearProcessing();
    this.isRecording = true;
    this.waveCanvas.classList.remove('hidden');
    this.contentElement.textContent = message;
    this.counterElement.textContent = '';
    this.show();
  }

  private drawWaveform(buffer: any) {
    if (!this.isRecording || !this.waveCtx) return;

    const ctx = this.waveCtx;
    const WIDTH = this.waveCanvas.width;
    const HEIGHT = this.waveCanvas.height;

    const data = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2);

    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.beginPath();

    const sliceWidth = WIDTH / data.length;
    let x = 0;

    for (let i = 0; i < data.length; i++) {
      const v = data[i] / 32768.0;
      const y = (v * HEIGHT) / 2 + HEIGHT / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    ctx.lineTo(WIDTH, HEIGHT / 2);
    ctx.stroke();
  }

  // Processing animation
  private showProcessing(message: string) {
    console.log('⏳ Pastille renderer: show processing');
    this.isRecording = false;
    this.waveCanvas.classList.add('hidden');
    this.contentElement.textContent = message;
    this.counterElement.textContent = '';

    this.clearProcessing();
    let dots = 0;
    this.processingInterval = setInterval(() => {
      dots = (dots + 1) % 4;
      this.contentElement.textContent = message + '.'.repeat(dots);
    }, 500);

    this.show();
  }

  private clearProcessing() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
  }

  private applyFontSize() {
    this.pastilleElement.style.fontSize = `${this.fontSize}px`;
    // Counter a bit smaller
    (this.counterElement as HTMLElement).style.fontSize = `${Math.max(8, this.fontSize - 4)}px`;
    this.editor.style.fontSize = `${this.fontSize}px`;
  }

  private toggleExpand() {
    this.expanded ? this.collapse() : this.expand();
  }

  private expand() {
    this.expanded = true;
    this.pastilleElement.classList.add('expanded');
    // Hide non-edit elements
    this.contentElement.classList.add('hidden');
    this.waveCanvas.classList.add('hidden');
    this.counterElement.classList.add('hidden');
    this.dragbar.classList.remove('hidden');
    // Show editor
    this.editor.classList.remove('hidden');
    this.editor.value = this.contentElement.textContent || '';
    setTimeout(() => this.editor.focus(), 50);
    // Disable drag on background while editing to avoid accidental moves
    this.pastilleElement.style.setProperty('-webkit-app-region', 'no-drag');

    // Request main process to handle expansion
    pastilleIpcRenderer.send('expand-pastille');

    this.backdrop.classList.remove('hidden');
  }

  private collapse() {
    this.expanded = false;
    this.pastilleElement.classList.remove('expanded');
    // Hide editor
    this.editor.classList.add('hidden');

    const newText = this.editor.value.trim();
    if (newText) {
      this.contentElement.textContent = newText.length > 80 ? newText.substring(0, 80) + '...' : newText;
      // Send to main to update clipboard
      pastilleIpcRenderer.send('update-clipboard', newText);
    }

    // Restore visibility
    this.contentElement.classList.remove('hidden');
    this.counterElement.classList.remove('hidden');
    this.dragbar.classList.add('hidden');
    // Re-enable drag
    this.pastilleElement.style.setProperty('-webkit-app-region', 'drag');

    // Request main process to handle collapse
    pastilleIpcRenderer.send('collapse-pastille');

    this.backdrop.classList.add('hidden');
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PastilleRenderer();
}); 