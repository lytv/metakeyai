import 'dotenv/config';

export const config = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  QUICK_EDIT_MODEL_OPENAI: process.env.QUICK_EDIT_MODEL_OPENAI || 'gpt-4.1',
  QUICK_EDIT_SYSTEM_PROMPT: process.env.QUICK_EDIT_SYSTEM_PROMPT || 'You are a helpful AI assistant.',
  WHISPER_MODEL: process.env.WHISPER_MODEL || 'whisper-1',
  TTS_VOICE: process.env.TTS_VOICE || 'nova', // Available: alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer
}; 

