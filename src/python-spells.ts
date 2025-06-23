import { PythonRunner, PythonRunOptions } from './python-runner';
import { ipcMain, BrowserWindow, globalShortcut, dialog, app, clipboard, Notification } from 'electron';
import path from 'path';
import fs from 'fs';
import { config } from './config';

export interface PythonSpell {
  id: string;
  name: string;
  description: string;
  script?: string;           // Inline Python code
  scriptFile?: string;       // Path to Python file
  args?: string[];          // Default arguments
  category: string;         // Category like 'text', 'data', 'analysis', etc.
  icon?: string;            // Emoji icon for the spell
  shortcut?: string;        // Keyboard shortcut (e.g., 'Ctrl+Alt+1')
  quickSlot?: number;       // Quick cast slot (1-9)
  timeout?: number;         // Custom timeout
  requiresInput?: boolean;  // Whether spell needs clipboard input
  outputFormat?: 'text' | 'json' | 'replace' | 'append';
  estimatedTime?: string;   // Human readable execution time estimate
}

export interface SpellResult {
  spellId: string;
  spellName: string;
  success: boolean;
  output: string;
  executionTime: number;
  error?: string;
}

export class PythonSpellCaster {
  private pythonRunner: PythonRunner;
  private spellBook: Map<string, PythonSpell> = new Map();
  private quickSlots: (PythonSpell | null)[] = new Array(9).fill(null);
  private spellBookPath: string;
  private isInitialized = false;

  constructor() {
    this.pythonRunner = new PythonRunner();
    this.setupIpcHandlers();
  }

  private getScriptPath(filename: string): string {
    // In webpack build, scripts are copied to __dirname/python_scripts
    const webpackPath = path.join(__dirname, 'python_scripts', filename);
    
    // In development, scripts are in src/python_scripts relative to project root
    const devPath = path.join(__dirname, '..', 'src', 'python_scripts', filename);
    
    // In packaged app, they should be in resources
    const prodPath = path.join(process.resourcesPath, 'python_scripts', filename);
    
    console.log('🔍 Checking script paths:');
    console.log('  Webpack path:', webpackPath, fs.existsSync(webpackPath) ? '✅' : '❌');
    console.log('  Dev path:', devPath, fs.existsSync(devPath) ? '✅' : '❌');
    console.log('  Prod path:', prodPath, fs.existsSync(prodPath) ? '✅' : '❌');
    
    // Check paths in order of preference
    if (fs.existsSync(webpackPath)) {
      console.log('📁 Using webpack path:', webpackPath);
      return webpackPath;
    } else if (fs.existsSync(devPath)) {
      console.log('📁 Using dev path:', devPath);
      return devPath;
    } else if (fs.existsSync(prodPath)) {
      console.log('📁 Using prod path:', prodPath);
      return prodPath;
    } else {
      console.error('❌ No valid Python script path found for:', filename);
      return webpackPath; // Return the expected path anyway
    }
  }

  async initialize(): Promise<void> {
    console.log('🧙‍♂️ Initializing Python Spell Caster...');
    
    // Set the persistent path for the spell book
    this.spellBookPath = path.join(app.getPath('userData'), 'spell_book.json');
    console.log('📖 Spell book path set to:', this.spellBookPath);
    
    try {
      // Initialize Python environment first
      const envInfo = await this.pythonRunner.initializeEnvironment();
      console.log('🐍 Python detected:', envInfo.version);
      
      if (envInfo.isEmbedded) {
        console.log('📦 Using embedded Python environment with', envInfo.packages.length, 'packages');
      } else {
        console.log('⚙️ Using system Python environment');
      }

      // Load spell book
      await this.loadSpellBook();
      
      // Register default spells
      await this.registerDefaultSpells();
      
      // Setup keyboard shortcuts
      this.setupKeyboardShortcuts();
      
      this.isInitialized = true;
      console.log('✨ Spell Caster ready! Spell book contains', this.spellBook.size, 'spells');
      
    } catch (error) {
      console.error('❌ Failed to initialize Spell Caster:', error);
      
      // Try to continue with fallback Python
      try {
        console.log('🔄 Attempting fallback initialization...');
        await this.loadSpellBook();
        await this.registerDefaultSpells();
        this.setupKeyboardShortcuts();
        this.isInitialized = true;
        console.log('⚠️ Spell Caster initialized with limited functionality');
      } catch (fallbackError) {
        console.error('❌ Fallback initialization also failed:', fallbackError);
        throw error;
      }
    }
  }

  private setupIpcHandlers(): void {
    // Cast spell by ID
    ipcMain.handle('cast-spell', async (event, spellId: string, input?: string) => {
      return this.castSpell(spellId, input);
    });

    // Cast spell by quick slot
    ipcMain.handle('cast-quick-spell', async (event, slot: number, input?: string) => {
      return this.castQuickSpell(slot, input);
    });

    // Get all spells
    ipcMain.handle('get-spell-book', async () => {
      return this.getSpellBook();
    });

    // Get quick slots
    ipcMain.handle('get-quick-slots', async () => {
      return this.getQuickSlots();
    });

    // Assign spell to quick slot
    ipcMain.handle('assign-quick-slot', async (event, spellId: string, slot: number) => {
      return this.assignQuickSlot(spellId, slot);
    });

    // Add custom spell
    ipcMain.handle('add-custom-spell', async (event, spell: Partial<PythonSpell>) => {
      return this.addCustomSpell(spell);
    });

    // Update spell
    ipcMain.handle('update-spell', async (event, spellId: string, updates: Partial<PythonSpell>) => {
      return this.updateSpell(spellId, updates);
    });

    // Delete spell
    ipcMain.handle('delete-spell', async (event, spellId: string) => {
      return this.deleteSpell(spellId);
    });

    // Test Python setup
    ipcMain.handle('test-python', async () => {
      try {
        const info = await this.pythonRunner.getInfo();
        return { success: true, info };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    });

    // Test custom spell
    ipcMain.handle('test-custom-spell', async (event, spell: Partial<PythonSpell>, input?: string) => {
      try {
        const result = await this.testSpell(spell, input);
        return result;
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    });
  }

  private setupKeyboardShortcuts(): void {
    console.log('⌨️ Spell shortcuts will be managed by ShortcutsManager');
    // Shortcuts are now handled by the global ShortcutsManager to allow customization
  }

  private async castSpellByCategory(category: string): Promise<void> {
    const categorySpells = Array.from(this.spellBook.values())
      .filter(spell => spell.category === category);

    if (categorySpells.length === 0) {
      this.showSpellError('Category Cast', `No spells found in category: ${category}`);
      return;
    }

    // Use the first spell in the category (could be enhanced with a selection dialog)
    const spell = categorySpells[0];
    const clipboardContent = clipboard.readText();
    
    const result = await this.castSpell(spell.id, clipboardContent);
    this.showSpellResult(result);
  }

  async castSpell(spellId: string, input?: string): Promise<SpellResult> {
    const spell = this.spellBook.get(spellId);
    
    if (!spell) {
      throw new Error(`Spell not found: ${spellId}`);
    }

    console.log(`🪄 Casting spell: ${spell.name} (${spell.icon || '✨'})`);

    const startTime = Date.now();

    try {
      const env: Record<string, string> = {
        PYTHONPATH: process.env.PYTHONPATH || '',
        PATH: process.env.PATH || '',
        PYTHONIOENCODING: 'utf-8',
      };
      if (config.OPENAI_API_KEY) {
        env.OPENAI_API_KEY = config.OPENAI_API_KEY;
      }

      // Prepare Python run options
      const runOptions: PythonRunOptions = {
        timeout: spell.timeout || 30000,
        input: spell.requiresInput !== false ? input : undefined,
        env: env
      };

      if (spell.script) {
        runOptions.script = spell.script;
      } else if (spell.scriptFile) {
        runOptions.scriptFile = path.resolve(spell.scriptFile);
      } else {
        throw new Error('Spell has no script or scriptFile defined');
      }

      if (spell.args) {
        runOptions.args = spell.args;
      }

      // Execute the spell
      const result = await this.pythonRunner.run(runOptions);
      const executionTime = Date.now() - startTime;

      // Process output based on format
      let processedOutput = result.stdout;
      
      if (spell.outputFormat === 'json') {
        try {
          const jsonData = JSON.parse(result.stdout);
          processedOutput = JSON.stringify(jsonData, null, 2);
        } catch {
          // Keep original output if not valid JSON
        }
      }

      const spellResult: SpellResult = {
        spellId: spell.id,
        spellName: spell.name,
        success: result.success,
        output: processedOutput,
        executionTime,
        error: result.success ? undefined : result.stderr
      };

      // Handle output format
      if (result.success && processedOutput) {
        await this.handleSpellOutput(spell, processedOutput);
      }

      console.log(`✅ Spell completed: ${spell.name} (${executionTime}ms)`);
      return spellResult;

    } catch (error) {
      const executionTime = Date.now() - startTime;
      console.error(`❌ Spell failed: ${spell.name}`, error);
      
      return {
        spellId: spell.id,
        spellName: spell.name,
        success: false,
        output: '',
        executionTime,
        error: (error as Error).message
      };
    }
  }

  async castQuickSpell(slot: number, input?: string): Promise<SpellResult> {
    if (slot < 1 || slot > 9) {
      throw new Error('Quick slot must be between 1 and 9');
    }

    const spell = this.quickSlots[slot - 1];
    
    if (!spell) {
      throw new Error(`No spell assigned to quick slot ${slot}`);
    }

    return this.castSpell(spell.id, input);
  }

  private async handleSpellOutput(spell: PythonSpell, output: string): Promise<void> {
    switch (spell.outputFormat) {
      case 'replace':
        clipboard.writeText(output);
        console.log('📋 Replaced clipboard with spell output');
        break;
        
      case 'append': {
        const currentClipboard = clipboard.readText();
        clipboard.writeText(currentClipboard + '\n\n' + output);
        console.log('📋 Appended spell output to clipboard');
        break;
      }
        
      case 'text':
      case 'json':
        clipboard.writeText(output);
        console.log('📋 Copied spell output to clipboard');
        break;
    }
  }

  private showSpellResult(result: SpellResult): void {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(window => {
      window.webContents.send('spell-result', result);
    });

    // Also show system notification for quick feedback
    if (result.success) {
      new Notification({
        title: `✨ ${result.spellName}`,
        body: `Spell completed in ${result.executionTime}ms`,
        silent: true
      }).show();
    } else {
      new Notification({
        title: `❌ ${result.spellName} Failed`,
        body: result.error || 'Spell casting failed',
        silent: false
      }).show();
    }
  }

  private showSpellError(spellName: string, error: string): void {
    new Notification({
      title: `❌ ${spellName} Failed`,
      body: error,
      silent: false
    }).show();
  }

  private async registerDefaultSpells(): Promise<void> {
    console.log('📚 Registering default spells...');

    const defaultSpells: PythonSpell[] = [
      {
        id: 'data-processor',
        name: 'Data Processor',
        description: 'Process and analyze CSV, JSON, and other data formats',
        scriptFile: this.getScriptPath('data_processor.py'),
        category: 'data',
        icon: '🔄',
        requiresInput: true,
        outputFormat: 'json',
        estimatedTime: '1-3 seconds',
        timeout: 15000
      },
      {
        id: 'translate-en-to-ja',
        name: 'Translate English to Japanese',
        description: 'Translate clipboard text from English to Japanese using a DSPy program.',
        scriptFile: this.getScriptPath('translator_en_to_ja.py'),
        category: 'Translation',
        icon: '🌐',
        requiresInput: true,
        outputFormat: 'replace',
        estimatedTime: '< 15s'
      }
    ];

    // Add default spells to the spell book
    for (const spell of defaultSpells) {
      this.spellBook.set(spell.id, spell);
    }

    // Only set up default quick slots if the spell book doesn't exist yet (first run)
    if (!fs.existsSync(this.spellBookPath)) {
      console.log('💡 First run detected, setting up default quick slots.');
      this.quickSlots[0] = this.spellBook.get('data-processor') || null;
      this.quickSlots[1] = this.spellBook.get('translate-en-to-ja') || null;
      for (let i = 2; i < 9; i++) {
        this.quickSlots[i] = null;
      }
    }

    console.log(`✅ Registered ${defaultSpells.length} default spells`);
  }

  private async loadSpellBook(): Promise<void> {
    try {
      if (fs.existsSync(this.spellBookPath)) {
        const data = fs.readFileSync(this.spellBookPath, 'utf8');
        const savedData = JSON.parse(data);
        
        // Load custom spells
        if (savedData.spells) {
          for (const spell of savedData.spells) {
            this.spellBook.set(spell.id, spell);
          }
        }
        
        // Load quick slot assignments
        if (savedData.quickSlots) {
          this.quickSlots = savedData.quickSlots;
        }
        
        console.log('📖 Loaded spell book from disk');
      }
    } catch (error) {
      console.warn('⚠️ Could not load spell book:', error);
    }
  }

  private async saveSpellBook(): Promise<void> {
    try {
      const customSpells = Array.from(this.spellBook.values())
        .filter(spell => !spell.id.startsWith('data-processor') && 
                        !spell.id.startsWith('translate-en-to-ja'));

      const data = {
        spells: customSpells,
        quickSlots: this.quickSlots
      };

      fs.writeFileSync(this.spellBookPath, JSON.stringify(data, null, 2));
      console.log('💾 Saved spell book to disk');
    } catch (error) {
      console.error('❌ Failed to save spell book:', error);
    }
  }

  // Public API methods

  getSpellBook(): PythonSpell[] {
    return Array.from(this.spellBook.values());
  }

  getQuickSlots(): (PythonSpell | null)[] {
    return [...this.quickSlots];
  }

  assignQuickSlot(spellId: string, slot: number): boolean {
    if (slot < 1 || slot > 9) return false;
    
    const spell = this.spellBook.get(spellId);
    if (!spell) return false;
    
    this.quickSlots[slot - 1] = spell;
    this.saveSpellBook();
    
    console.log(`🎯 Assigned "${spell.name}" to quick slot ${slot}`);
    return true;
  }

  async addCustomSpell(spellData: Partial<PythonSpell>): Promise<string> {
    const spell: PythonSpell = {
      id: spellData.id || `custom-${Date.now()}`,
      name: spellData.name || 'Custom Spell',
      description: spellData.description || 'A custom Python spell',
      category: spellData.category || 'custom',
      icon: spellData.icon || '🪄',
      script: spellData.script,
      scriptFile: spellData.scriptFile,
      args: spellData.args,
      requiresInput: spellData.requiresInput !== false,
      outputFormat: spellData.outputFormat || 'text',
      timeout: spellData.timeout || 30000,
      estimatedTime: spellData.estimatedTime || 'Unknown'
    };

    this.spellBook.set(spell.id, spell);
    await this.saveSpellBook();

    console.log(`✨ Added custom spell: ${spell.name}`);
    return spell.id;
  }

  updateSpell(spellId: string, updates: Partial<PythonSpell>): boolean {
    const spell = this.spellBook.get(spellId);
    if (!spell) return false;

    Object.assign(spell, updates);
    this.saveSpellBook();

    console.log(`🔄 Updated spell: ${spell.name}`);
    return true;
  }

  deleteSpell(spellId: string): boolean {
    const spell = this.spellBook.get(spellId);
    if (!spell) return false;

    // Remove from spell book
    this.spellBook.delete(spellId);

    // Remove from quick slots
    for (let i = 0; i < this.quickSlots.length; i++) {
      if (this.quickSlots[i]?.id === spellId) {
        this.quickSlots[i] = null;
      }
    }

    this.saveSpellBook();

    console.log(`🗑️ Deleted spell: ${spell.name}`);
    return true;
  }

  // Test a spell without registering it
  async testSpell(spellData: Partial<PythonSpell>, input?: string): Promise<SpellResult> {
    console.log('🧪 Testing spell:', spellData.name);
    
    const startTime = Date.now();
    
    try {
      const env: Record<string, string> = {
        PYTHONPATH: process.env.PYTHONPATH || '',
        PATH: process.env.PATH || '',
        PYTHONIOENCODING: 'utf-8',
      };
      if (config.OPENAI_API_KEY) {
        env.OPENAI_API_KEY = config.OPENAI_API_KEY;
      }

      const runOptions: PythonRunOptions = {
        timeout: spellData.timeout || 15000,
        input: spellData.requiresInput !== false ? input : undefined,
        env: env
      };

      let result;
      if (spellData.script) {
        // Run inline script
        result = await this.pythonRunner.run({
          ...runOptions,
          script: spellData.script
        });
      } else {
        throw new Error('No script provided for testing');
      }

      const executionTime = Date.now() - startTime;
      
      const spellResult: SpellResult = {
        spellId: 'test-spell',
        spellName: spellData.name || 'Test Spell',
        success: result.success,
        output: result.stdout,
        executionTime,
        error: result.success ? undefined : result.stderr
      };

      console.log('🧪 Test completed:', spellResult.success ? '✅' : '❌', `(${executionTime}ms)`);
      return spellResult;
      
    } catch (error) {
      const executionTime = Date.now() - startTime;
      console.error('❌ Test failed:', error);
      
      return {
        spellId: 'test-spell',
        spellName: spellData.name || 'Test Spell',
        success: false,
        output: '',
        executionTime,
        error: (error as Error).message
      };
    }
  }

  cleanup(): void {
    console.log('🧹 Cleaning up Python Spell Caster...');
    globalShortcut.unregisterAll();
  }
}

// Export singleton instance
export const pythonSpellCaster = new PythonSpellCaster(); 