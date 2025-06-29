import { app, Tray, Menu, globalShortcut, clipboard, nativeImage, BrowserWindow, screen, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { callOpenAIForQuickEdit, callWhisperApi, callTextToSpeechApi } from './openai-api';
import { config } from './config';
import { AudioRecorder } from './audio-recorder';
import { ClipboardHistory } from './clipboard-history';
import { AudioPlayer } from './audio-player';
import { pythonSpellCaster } from './python-spells';
import { ShortcutsManager } from './shortcuts-manager';

// This allows TypeScript to pick up the magic constants that are auto-generated by Forge's Webpack
// plugin that tells the Electron app where to look for the Webpack-bundled app code.
// We don't have a window anymore, but we'll keep these for potential future use.
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
declare const VISUALIZER_WINDOW_WEBPACK_ENTRY: string;
declare const VISUALIZER_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
declare const PASTILLE_WINDOW_WEBPACK_ENTRY: string;
declare const PASTILLE_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
declare const SETTINGS_WINDOW_WEBPACK_ENTRY: string;
declare const SETTINGS_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
declare const SPELL_BOOK_WINDOW_WEBPACK_ENTRY: string;
declare const SPELL_BOOK_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

const SETTINGS_FILE_PATH = path.join(app.getPath('userData'), 'settings.json');

let tray: Tray | null = null;
let recorder: AudioRecorder | null = null;
const visualizerWindow: BrowserWindow | null = null;
let pastilleWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let spellBookWindow: BrowserWindow | null = null;
let clipboardHistory: ClipboardHistory | null = null;
let audioPlayer: AudioPlayer | null = null;
let shortcutsManager: ShortcutsManager | null = null;
let lastTTSFilePath: string | null = null;

const AUDIO_HISTORY_DIR = path.join(__dirname, '../audio_history');

function getTodayDir() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return path.join(AUDIO_HISTORY_DIR, `${dd}${mm}${yyyy}`);
}

async function moveAudioToHistory(audioFilePath: string) {
  const todayDir = getTodayDir();
  if (!fs.existsSync(todayDir)) {
    fs.mkdirSync(todayDir, { recursive: true });
  }
  const fileName = path.basename(audioFilePath);
  const destPath = path.join(todayDir, fileName);
  try {
    fs.renameSync(audioFilePath, destPath);
  } catch (err: any) {
    if (err.code === 'EXDEV') {
      fs.copyFileSync(audioFilePath, destPath);
      fs.unlinkSync(audioFilePath);
    } else {
      throw err;
    }
  }
  lastTTSFilePath = destPath;
  return destPath;
}

async function replayLastTTS() {
  // Ưu tiên phát file vừa tạo nhất nếu có
  if (lastTTSFilePath && fs.existsSync(lastTTSFilePath)) {
    if (!audioPlayer) {
      audioPlayer = new AudioPlayer();
      audioPlayer.on('finished', () => {
        positionPillNearCursor();
        pastilleWindow?.webContents.send('show-message', 'Replay completed.');
        pastilleWindow?.show();
      });
      audioPlayer.on('error', (error) => {
        positionPillNearCursor();
        pastilleWindow?.webContents.send('show-message', `Replay Error – ${error.message}`);
        pastilleWindow?.show();
      });
      audioPlayer.on('stopped', () => {
        // No action needed on stop for replay
      });
    }
    await audioPlayer.play(lastTTSFilePath);
    positionPillNearCursor();
    pastilleWindow?.webContents.send('show-message', '🔊 Replaying last TTS audio...');
    pastilleWindow?.show();
    return;
  }
  // Nếu không có, fallback sang tìm file mới nhất trong thư mục
  const todayDir = getTodayDir();
  if (!fs.existsSync(todayDir)) {
    positionPillNearCursor();
    pastilleWindow?.webContents.send('show-message', 'No TTS audio found for today!');
    pastilleWindow?.show();
    return;
  }
  const files = fs.readdirSync(todayDir)
    .filter(f => f.endsWith('.mp3'))
    .map(f => ({
      name: f,
      time: fs.statSync(path.join(todayDir, f)).mtime.getTime()
    }))
    .sort((a, b) => b.time - a.time);
  if (files.length === 0) {
    positionPillNearCursor();
    pastilleWindow?.webContents.send('show-message', 'No TTS audio found for today!');
    pastilleWindow?.show();
    return;
  }
  const lastFile = path.join(todayDir, files[0].name);
  if (!audioPlayer) {
    audioPlayer = new AudioPlayer();
    audioPlayer.on('finished', () => {
      positionPillNearCursor();
      pastilleWindow?.webContents.send('show-message', 'Replay completed.');
      pastilleWindow?.show();
    });
    audioPlayer.on('error', (error) => {
      positionPillNearCursor();
      pastilleWindow?.webContents.send('show-message', `Replay Error – ${error.message}`);
      pastilleWindow?.show();
    });
    audioPlayer.on('stopped', () => {
      // No action needed on stop for replay
    });
  }
  await audioPlayer.play(lastFile);
  positionPillNearCursor();
  pastilleWindow?.webContents.send('show-message', '🔊 Replaying last TTS audio...');
  pastilleWindow?.show();
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

function loadSettingsFromFile() {
  try {
    if (fs.existsSync(SETTINGS_FILE_PATH)) {
      const fileContent = fs.readFileSync(SETTINGS_FILE_PATH, 'utf-8');
      const loadedSettings = JSON.parse(fileContent);
      
      // Apply general settings
      Object.assign(config, loadedSettings);
      console.log('✅ Settings loaded from', SETTINGS_FILE_PATH);

      // Pass shortcut settings to the manager
      if (loadedSettings.shortcuts && shortcutsManager) {
        console.log('⚙️ Applying shortcuts from settings file...');
        shortcutsManager.applyShortcutConfiguration(loadedSettings.shortcuts);
      }
    }
  } catch (error) {
    console.error('❌ Failed to load settings, using defaults:', error);
  }
}

const handleClipboardNext = () => {
  console.log('➡️ handleClipboardNext triggered!');
  if (!clipboardHistory) return;
  
  const entry = clipboardHistory.cycleNext();
  showPastille(); // Always show pastille to see current state
  if (entry) {
    console.log('📋 Next clipboard entry:', entry.text.substring(0, 50) + '...');
  }
};

const handleClipboardPrevious = () => {
  console.log('⬅️ handleClipboardPrevious triggered!');
  if (!clipboardHistory) return;
  
  const entry = clipboardHistory.cyclePrevious();
  showPastille(); // Always show pastille to see current state
  if (entry) {
    console.log('📋 Previous clipboard entry:', entry.text.substring(0, 50) + '...');
  }
};

const handleShowClipboard = () => {
  console.log('👁️ handleShowClipboard triggered!');
  showPastille(); // Show current clipboard state
};

const handleClipboardClear = () => {
  console.log('🧹 handleClipboardClear triggered!');
  if (clipboardHistory) {
    clipboardHistory.clearHistory();
    
    // Refresh the pastille to show the cleared state
    showPastille(); 

    // Optionally, show a confirmation message as well
    // We can use the pastille for this to be more integrated
    setTimeout(() => {
      pastilleWindow?.webContents.send('show-message', 'Clipboard history cleared');
    }, 100); // Small delay to ensure it appears after the clear
  }
};

const handleClipboardDeleteCurrent = () => {
  console.log('🗑️ handleClipboardDeleteCurrent triggered!');
  if (clipboardHistory) {
    clipboardHistory.deleteCurrentEntry();
    
    // Refresh the pastille to show the new state
    showPastille(); 

    setTimeout(() => {
      pastilleWindow?.webContents.send('show-message', 'Current entry deleted');
    }, 100);
  }
};

const showPastille = () => {
  if (!pastilleWindow || !clipboardHistory) return;
  
  const currentEntry = clipboardHistory.getCurrentEntry();
  const currentIndex = clipboardHistory.getCurrentIndex();
  const totalCount = clipboardHistory.getHistoryLength();
  
  // Get fresh cursor position each time
  const cursorPosition = screen.getCursorScreenPoint();
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  
  // Calculate position with bounds checking
  let x = cursorPosition.x + 20;
  let y = cursorPosition.y - 60;
  
  // Keep pastille on screen
  if (x + 520 > screenWidth) {
    x = cursorPosition.x - 540; // Show to the left of cursor
  }
  if (y < 0) {
    y = cursorPosition.y + 20; // Show below cursor
  }
  
  console.log('🖱️ Cursor position:', cursorPosition, '-> Pastille position:', { x, y });
  
  pastilleWindow.setPosition(x, y);
  
  pastilleWindow.webContents.send('clipboard-updated', {
    entry: currentEntry,
    currentIndex: currentIndex,
    totalCount: totalCount
  });
  
  pastilleWindow.webContents.send('show-pastille');
  pastilleWindow.show(); // Make sure the window is shown
  console.log('👁️ Pastille window shown at cursor position');
};

// Utility to position pill near current cursor
const positionPillNearCursor = () => {
  if (!pastilleWindow) return;
  const cursorPosition = screen.getCursorScreenPoint();
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  let x = cursorPosition.x + 20;
  let y = cursorPosition.y - 80;
  if (x + 520 > screenWidth) x = cursorPosition.x - 540;
  if (y < 0) y = cursorPosition.y + 20;
  pastilleWindow.setPosition(x, y);
};

const handleQuickEdit = async () => {
  console.log('🚀 handleQuickEdit triggered!');
  if (!config.OPENAI_API_KEY) {
    console.log('❌ No OpenAI API key found');
    positionPillNearCursor();
    pastilleWindow?.webContents.send('show-message', 'Configuration Error: OpenAI API key is not set.');
    pastilleWindow?.show();
    return;
  }
  const text = clipboard.readText();
  console.log('📋 Clipboard text:', text ? `"${text}"` : 'EMPTY');
  if (!text) {
    console.log('❌ No text in clipboard');
    positionPillNearCursor();
    pastilleWindow?.webContents.send('show-message', 'Quick Edit – No text in clipboard!');
    pastilleWindow?.show();
    return;
  }

  console.log('⏳ Starting OpenAI processing...');
  positionPillNearCursor();
  pastilleWindow?.webContents.send('show-processing', 'Processing');
  pastilleWindow?.show();

  const response = await callOpenAIForQuickEdit(text);
  console.log('📝 OpenAI response:', response ? `"${response}"` : 'NULL');

  if (response) {
    clipboard.writeText(response);
    console.log('✅ Text processed and copied to clipboard');
    positionPillNearCursor();
    pastilleWindow?.webContents.send('show-message', response);
    pastilleWindow?.show();
  } else {
    console.log('❌ Failed to process text');
    positionPillNearCursor();
    pastilleWindow?.webContents.send('show-message', 'Quick Edit – Failed to process text!');
    pastilleWindow?.show();
  }
};

const processRecording = async (filePath: string) => {
  try {
    console.log(`🔄 Processing recording from ${filePath}`);
    const transcript = await callWhisperApi(filePath);
    console.log('📝 Whisper transcript:', transcript ? `"${transcript}"` : 'NULL');

    if (transcript) {
      // Save transcript to a file next to the recording
      const transcriptPath = filePath.replace('.wav', '.txt');
      fs.writeFileSync(transcriptPath, transcript);
      
      // Copy to clipboard
      clipboard.writeText(transcript);
      
      console.log(`💾 Transcript saved to ${transcriptPath} and copied to clipboard`);
      positionPillNearCursor();
      pastilleWindow?.webContents.send('show-message', transcript);
      pastilleWindow?.show();
    } else {
      console.log('❌ Failed to transcribe audio');
      positionPillNearCursor();
      pastilleWindow?.webContents.send('show-message', 'Failed to transcribe audio.');
      pastilleWindow?.show();
    }
  } catch (e) {
    console.error('❌ Error processing recording:', e);
    positionPillNearCursor();
    pastilleWindow?.webContents.send('show-message', `Error – Failed to process recording: ${e.message}`);
    pastilleWindow?.show();
  } finally {
    // Clean up the recording file
    // fs.unlink(filePath, (err) => {
    //   if (err) console.error(`Failed to delete audio file: ${filePath}`, err);
    //   else console.log(`Deleted audio file: ${filePath}`);
    // });
  }
};

const handleVoiceRecord = () => {
  console.log('🎤 handleVoiceRecord triggered!');
  if (recorder && recorder.isRecording) {
    console.log('🛑 Stopping recording...');
    recorder.stop();
    // Visualizer merged into pastille – no separate window needed
    // stop showing waveform; pastille will switch to processing
    positionPillNearCursor();
    pastilleWindow?.webContents.send('show-processing', 'Processing');
    pastilleWindow?.show();
  } else {
    console.log('🎙️ Starting recording...');
    recorder = new AudioRecorder();
    recorder.start();

    // Tell pastille to enter recording mode with waveform
    positionPillNearCursor();
    pastilleWindow?.webContents.send('start-recording', 'Recording... Press Ctrl+Alt+W to stop.');
    pastilleWindow?.show();

    recorder.on('audio-data', (data: Buffer) => {
      pastilleWindow?.webContents.send('audio-data', data);
    });

    recorder.on('finished', (filePath: string) => {
      console.log('✅ Recording finished, file:', filePath);
      processRecording(filePath);
      recorder = null; // Reset recorder
    });

    recorder.on('error', (error: any) => {
      console.log('❌ Recording error:', error);
      positionPillNearCursor();
      pastilleWindow?.webContents.send('show-message', `Recording Error – ${error.message}`);
      pastilleWindow?.show();
      recorder = null; // Reset recorder
    });
  }
};

const handleTextToSpeech = async () => {
  console.log('🎤 handleTextToSpeech triggered!');
  if (!config.OPENAI_API_KEY) {
    console.log('❌ No OpenAI API key found');
    positionPillNearCursor();
    pastilleWindow?.webContents.send('show-message', 'Configuration Error: OpenAI API key is not set.');
    pastilleWindow?.show();
    return;
  }

  const text = clipboard.readText();
  console.log('📋 Clipboard text for TTS:', text ? `"${text.substring(0, 100)}..."` : 'EMPTY');
  
  if (!text) {
    console.log('❌ No text in clipboard');
    positionPillNearCursor();
    pastilleWindow?.webContents.send('show-message', 'Text-to-Speech – No text in clipboard!');
    pastilleWindow?.show();
    return;
  }

  // Stop any currently playing audio
  if (audioPlayer && audioPlayer.playing) {
    console.log('🛑 Stopping current audio playback');
    audioPlayer.stop();
    positionPillNearCursor();
    pastilleWindow?.webContents.send('show-message', 'Audio playback stopped.');
    pastilleWindow?.show();
    return;
  }

  console.log('⏳ Starting TTS processing...');
  positionPillNearCursor();
  pastilleWindow?.webContents.send('show-processing', 'Generating speech');
  pastilleWindow?.show();

  try {
    const audioFilePath = await callTextToSpeechApi(text, config.TTS_VOICE);
    console.log('🎵 TTS response:', audioFilePath ? `"${audioFilePath}"` : 'NULL');

    if (audioFilePath) {
      // Move file vào thư mục lịch sử và cập nhật lastTTSFilePath ngay lập tức
      const movedPath = await moveAudioToHistory(audioFilePath);
      lastTTSFilePath = movedPath;
      console.log('🔊 Starting audio playback...');
      positionPillNearCursor();
      pastilleWindow?.webContents.send('show-message', '🔊 Playing audio... (Ctrl+Alt+E to stop)');
      pastilleWindow?.show();

      // Initialize audio player if needed
      if (!audioPlayer) {
        audioPlayer = new AudioPlayer();
        audioPlayer.on('finished', () => {
          console.log('✅ Audio playback finished');
          positionPillNearCursor();
          pastilleWindow?.webContents.send('show-message', 'Audio playback completed.');
          pastilleWindow?.show();
        });
        audioPlayer.on('error', (error) => {
          console.error('❌ Audio playback error:', error);
          positionPillNearCursor();
          pastilleWindow?.webContents.send('show-message', `Audio Error – ${error.message}`);
          pastilleWindow?.show();
        });
        audioPlayer.on('stopped', () => {
          console.log('🛑 Audio playback stopped');
        });
      }
      await audioPlayer.play(movedPath);
    } else {
      console.log('❌ Failed to generate speech');
      positionPillNearCursor();
      pastilleWindow?.webContents.send('show-message', 'Text-to-Speech – Failed to generate audio!');
      pastilleWindow?.show();
    }
  } catch (error) {
    console.error('❌ TTS error:', error);
    positionPillNearCursor();
    pastilleWindow?.webContents.send('show-message', `TTS Error – ${error.message}`);
    pastilleWindow?.show();
  }
};

app.on('ready', async () => {
  loadSettingsFromFile(); // Load settings at the very beginning

  console.log('🚀 App ready event triggered');
  
  // Initialize clipboard history
  console.log('📋 Initializing clipboard history...');
  clipboardHistory = new ClipboardHistory(50);
  
  clipboardHistory.on('history-updated', (entry) => {
    console.log('📋 Clipboard history updated:', entry?.text?.substring(0, 50) + '...');
  });
  
  clipboardHistory.on('current-changed', (entry) => {
    console.log('📋 Current clipboard entry changed:', entry?.text?.substring(0, 50) + '...');
  });
  
  console.log('✅ Clipboard history initialized');
  
  // Initialize Python Spell Caster
  console.log('🧙‍♂️ Initializing Python Spell Caster...');
  try {
    await pythonSpellCaster.initialize();
    console.log('✅ Python Spell Caster initialized');
  } catch (error) {
    console.error('❌ Failed to initialize Python Spell Caster:', error);
  }
  
  // Create the visualizer window
  console.log('🪟 Creating visualizer window...');
  // Visualizer merged into pastille – no separate window needed
  // let visualizerWindow = new BrowserWindow({
  //   width: 200,
  //   height: 60,
  //   frame: false,
  //   transparent: true,
  //   alwaysOnTop: true,
  //   show: false,
  //   resizable: false,
  //   webPreferences: {
  //     nodeIntegration: true,
  //     contextIsolation: false, // Needed for ipcRenderer in visualizer.ts without a preload script
  //   },
  // });

  // visualizerWindow.loadURL(VISUALIZER_WINDOW_WEBPACK_ENTRY);
  // visualizerWindow.setIgnoreMouseEvents(true); // Make the window click-through
  // console.log('✅ Visualizer window created');
  
  // Create the pastille window
  console.log('🪟 Creating pastille window...');
  pastilleWindow = new BrowserWindow({
    width: 500,
    height: 70,
    frame: false,
    transparent: true,
    alwaysOnTop: false,
    show: false,
    resizable: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // Needed for ipcRenderer in pastille.ts without a preload script
    },
  });

  pastilleWindow.loadURL(PASTILLE_WINDOW_WEBPACK_ENTRY);
  // Allow mouse events so user can drag the pill
  pastilleWindow.setIgnoreMouseEvents(false);
  
  // Initialize pastille with current clipboard content once it's ready
  pastilleWindow.webContents.once('did-finish-load', () => {
    console.log('🎯 Pastille window loaded, initializing with current clipboard');
    setTimeout(() => {
      const currentEntry = clipboardHistory?.getCurrentEntry();
      const currentIndex = clipboardHistory?.getCurrentIndex() ?? -1;
      const totalCount = clipboardHistory?.getHistoryLength() ?? 0;
      
      pastilleWindow?.webContents.send('clipboard-updated', {
        entry: currentEntry,
        currentIndex: currentIndex,
        totalCount: totalCount
      });
    }, 100);
  });
  
  console.log('✅ Pastille window created');

  // We don't want a window, just a tray icon.
  // Create a native image from a data URL for the tray icon.
  // This is a simple 16x16 transparent PNG.
  console.log('🖼️ Creating tray icon...');
  const image = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAEklEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  );
  tray = new Tray(image);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Exit', type: 'normal', click: () => app.quit() },
  ]);

  tray.setToolTip('MetaKeyAI');
  tray.setContextMenu(contextMenu);
  console.log('✅ Tray created');
  
  showPillNotification('MetaKeyAI running in background\nCtrl+Alt+Q: Quick edit\nCtrl+Alt+W: Voice record\nCtrl+Alt+E: Text-to-speech\nCtrl+Alt+C: Show clipboard\nCtrl+Alt+←/→/Num-/Num/: Navigate clipboard\nCustomize shortcuts in Settings!');

  if (!config.OPENAI_API_KEY) {
    console.log('⚠️ No OpenAI API key found in config');
    showPillNotification('Configuration Warning – OpenAI API key not set. Voice and edit features will not work.');
  } else {
    console.log('✅ OpenAI API key found in config');
  }

  // Initialize shortcuts manager
  console.log('⌨️ Initializing shortcuts manager...');
  shortcutsManager = new ShortcutsManager();
  
  // Define all shortcut handlers
  const shortcutHandlers = {
    'quick-edit': handleQuickEdit,
    'voice-record': handleVoiceRecord,
    'text-to-speech': handleTextToSpeech,
    'clipboard-show': handleShowClipboard,
    'clipboard-next': handleClipboardNext,
    'clipboard-previous': handleClipboardPrevious,
    'clipboard-clear': handleClipboardClear,
    'clipboard-delete-current': handleClipboardDeleteCurrent,
    'clipboard-next-alt1': handleClipboardNext,
    'clipboard-previous-alt1': handleClipboardPrevious,
    'clipboard-next-alt2': handleClipboardNext,
    'clipboard-previous-alt2': handleClipboardPrevious,
    'open-settings': openSettingsWindow,
    'open-spell-book': openSpellBookWindow,
    'spells-data': async () => {
      const clipboardContent = clipboard.readText();
      const spells = pythonSpellCaster.getSpellBook().filter(s => s.category === 'data');
      if (spells.length > 0) {
        await pythonSpellCaster.castSpell(spells[0].id, clipboardContent);
      }
    },
    // Quick spell slots
    'spell-slot-1': async () => { 
      const clipboardContent = clipboard.readText();
      await pythonSpellCaster.castQuickSpell(1, clipboardContent);
    },
    'spell-slot-2': async () => { 
      const clipboardContent = clipboard.readText();
      await pythonSpellCaster.castQuickSpell(2, clipboardContent);
    },
    'spell-slot-3': async () => { 
      const clipboardContent = clipboard.readText();
      await pythonSpellCaster.castQuickSpell(3, clipboardContent);
    },
    'spell-slot-4': async () => { 
      const clipboardContent = clipboard.readText();
      await pythonSpellCaster.castQuickSpell(4, clipboardContent);
    },
    'spell-slot-5': async () => { 
      const clipboardContent = clipboard.readText();
      await pythonSpellCaster.castQuickSpell(5, clipboardContent);
    },
    'spell-slot-6': async () => { 
      const clipboardContent = clipboard.readText();
      await pythonSpellCaster.castQuickSpell(6, clipboardContent);
    },
    'spell-slot-7': async () => { 
      const clipboardContent = clipboard.readText();
      await pythonSpellCaster.castQuickSpell(7, clipboardContent);
    },
    'spell-slot-8': async () => { 
      const clipboardContent = clipboard.readText();
      await pythonSpellCaster.castQuickSpell(8, clipboardContent);
    },
    'spell-slot-9': async () => { 
      const clipboardContent = clipboard.readText();
      await pythonSpellCaster.castQuickSpell(9, clipboardContent);
    },
    'tts-replay': replayLastTTS,
  };
  
  await shortcutsManager.initialize(shortcutHandlers);

  // After initializing the manager with default shortcuts, load and apply the saved settings
  loadSettingsFromFile();

  // Add IPC listener for update-clipboard
  ipcMain.on('update-clipboard', (event, text) => {
    console.log('📋 Received update-clipboard event:', text);
    clipboard.writeText(text);
    showPastille();
  });

  // Add IPC listener for update-clipboard-draft (real-time editing)
  ipcMain.on('update-clipboard-draft', (event, text) => {
    console.log('📝 Received update-clipboard-draft event:', text.substring(0, 50) + '...');
    clipboard.writeText(text);
    // Don't show pastille for draft updates to avoid interrupting editing
  });

  // Add IPC listener for expand-pastille
  ipcMain.on('expand-pastille', () => {
    if (pastilleWindow) {
      const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
      const targetWidth = Math.round(screenWidth * 0.7);
      const targetHeight = Math.round(screenHeight * 0.6);
      pastilleWindow.setAlwaysOnTop(true);
      pastilleWindow.setSize(targetWidth, targetHeight, true);
      pastilleWindow.center();
    }
  });

  // Add IPC listener for collapse-pastille
  ipcMain.on('collapse-pastille', () => {
    if (pastilleWindow) {
      pastilleWindow.setSize(500, 70, true);
      pastilleWindow.setAlwaysOnTop(false);
    }
  });

  // Add IPC listener for clipboard navigation from control bar
  ipcMain.on('clipboard-navigate', (event, direction) => {
    console.log('🔄 Received clipboard-navigate event:', direction);
    if (direction === 'next') {
      handleClipboardNext();
    } else if (direction === 'previous') {
      handleClipboardPrevious();
    }
  });

  // Add IPC listener for opening settings
  ipcMain.on('open-settings', () => {
    console.log('⚙️ Opening settings window...');
    openSettingsWindow();
  });

  // Add IPC listener for opening spell book
  ipcMain.on('open-spell-book', () => {
    console.log('🧙‍♂️ Opening spell book window...');
    openSpellBookWindow();
  });

  // Add IPC listeners for settings management
  ipcMain.on('load-settings', (event) => {
    console.log('📋 Loading settings for dashboard...');
    const settings = {
      OPENAI_API_KEY: config.OPENAI_API_KEY || '',
      QUICK_EDIT_MODEL_OPENAI: config.QUICK_EDIT_MODEL_OPENAI,
      WHISPER_MODEL: config.WHISPER_MODEL,
      TTS_VOICE: config.TTS_VOICE,
      shortcuts: shortcutsManager ? shortcutsManager.getShortcutConfiguration() : []
    };
    event.reply('settings-loaded', settings);
  });

  ipcMain.on('save-settings', (event, newSettings) => {
    console.log('💾 Saving settings to runtime and file...');
    try {
      // Update runtime config
      Object.assign(config, newSettings);

      // Apply shortcuts immediately
      if (newSettings.shortcuts && shortcutsManager) {
        shortcutsManager.applyShortcutConfiguration(newSettings.shortcuts);
      }

      // Write to file
      const settingsJson = JSON.stringify(newSettings, null, 2); // Pretty format
      fs.writeFileSync(SETTINGS_FILE_PATH, settingsJson, 'utf-8');
      
      console.log('✅ Settings saved successfully to:', SETTINGS_FILE_PATH);
      event.reply('settings-saved', true, 'Settings saved successfully!');
    } catch (error) {
      console.error('❌ Error saving settings:', error);
      event.reply('settings-saved', false, 'Failed to save settings: ' + error.message);
    }
  });

  ipcMain.on('validate-api-key', async (event, apiKey) => {
    console.log('🔍 Validating API key...');
    try {
      // Simple validation - try to make a basic API call with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      const isValid = response.ok;
      console.log('🔑 API key validation result:', isValid);
      event.reply('api-key-validated', isValid);
    } catch (error) {
      console.log('❌ API key validation failed:', error.message);
      event.reply('api-key-validated', false);
    }
  });

  ipcMain.on('test-voice', async (event, { voice, text }) => {
    console.log('🔊 Testing voice from settings:', voice);
    try {
      const audioFilePath = await callTextToSpeechApi(text, voice);
      if (audioFilePath && audioPlayer) {
        await audioPlayer.play(audioFilePath);
      }
    } catch (error) {
      console.error('❌ Voice test error:', error);
    }
  });

  ipcMain.on('replay-tts', () => {
    replayLastTTS();
  });
});

const openSettingsWindow = () => {
  // If settings window already exists, focus it
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  console.log('🪟 Creating settings window...');
  settingsWindow = new BrowserWindow({
    width: 700,
    height: 900,
    minWidth: 600,
    minHeight: 700,
    title: 'MetaKeyAI Settings',
    icon: null, // You can add an icon here
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  settingsWindow.loadURL(SETTINGS_WINDOW_WEBPACK_ENTRY);

  settingsWindow.once('ready-to-show', () => {
    settingsWindow?.show();
    console.log('✅ Settings window ready and shown');
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
    console.log('🚪 Settings window closed');
  });
};

const openSpellBookWindow = () => {
  // If spell book window already exists, focus it
  if (spellBookWindow) {
    spellBookWindow.focus();
    return;
  }

  console.log('🪟 Creating spell book window...');
  spellBookWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Python Spell Book - MetaKeyAI',
    icon: null,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Load the spell book HTML file
  spellBookWindow.loadURL(SPELL_BOOK_WINDOW_WEBPACK_ENTRY);

  spellBookWindow.once('ready-to-show', () => {
    spellBookWindow?.show();
    console.log('✅ Spell book window ready and shown');
  });

  spellBookWindow.on('closed', () => {
    spellBookWindow = null;
    console.log('🚪 Spell book window closed');
  });
};

// Since there are no windows, we don't need to handle 'window-all-closed'
// The app will continue running in the background.

app.on('will-quit', () => {
  // Cleanup shortcuts manager
  if (shortcutsManager) {
    shortcutsManager.cleanup();
    shortcutsManager = null;
  }
  
  // Cleanup clipboard history
  if (clipboardHistory) {
    clipboardHistory.destroy();
    clipboardHistory = null;
  }
  
  // Cleanup audio player
  if (audioPlayer) {
    audioPlayer.stop();
    audioPlayer = null;
  }
  
  // Cleanup Python Spell Caster
  pythonSpellCaster.cleanup();
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

/**
 * Shows a pill-style notification instead of the system notification.
 * Positions it near the bottom-right of the primary display.
 */
const showPillNotification = (message: string) => {
  if (!pastilleWindow) {
    console.warn('Pastille window not ready, cannot show pill notification');
    return;
  }

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  const x = screenWidth - 500; // leave some margin
  const y = screenHeight - 100;

  pastilleWindow.setPosition(x, y);
  pastilleWindow.webContents.send('show-message', message);
  pastilleWindow.show();
};
