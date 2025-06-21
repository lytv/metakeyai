import axios from 'axios';
import { config } from './config';
import fs from 'fs';
import FormData from 'form-data';
import path from 'path';

const OPEANAI_API_URL = 'https://api.openai.com/v1';

export async function callOpenAIForQuickEdit(text: string): Promise<string | null> {
  console.log('🔗 callOpenAIForQuickEdit called with text length:', text.length);
  
  if (!config.OPENAI_API_KEY) {
    console.error('❌ OpenAI API key not found');
    // We could show a notification here to the user
    return null;
  }

  const headers = {
    'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  };

  const data = {
    model: config.QUICK_EDIT_MODEL_OPENAI,
    messages: [
      { role: 'system', content: config.QUICK_EDIT_SYSTEM_PROMPT },
      { role: 'user', content: text },
    ],
    max_tokens: 4096,
  };

  console.log('📤 Request data:', {
    model: data.model,
    systemPrompt: data.messages[0].content,
    userTextLength: text.length,
    maxTokens: data.max_tokens
  });

  try {
    console.log('🌐 Sending request to OpenAI API for quick edit...');
    const response = await axios.post(`${OPEANAI_API_URL}/chat/completions`, data, { 
      headers,
      timeout: 30000 // 30 second timeout
    });
    console.log(`✅ API Response status: ${response.status}`);
    console.log('📥 Response data keys:', Object.keys(response.data));
    const result = response.data.choices[0].message.content;
    console.log('📝 Extracted result length:', result?.length || 0);
    return result;
  } catch (error) {
    console.error('❌ OpenAI API call error:');
    console.error('Error status:', error.response?.status);
    console.error('Error data:', error.response?.data);
    console.error('Error message:', error.message);
    return null;
  }
}

export async function callWhisperApi(filePath: string): Promise<string | null> {
  console.log('🎵 callWhisperApi called with file:', filePath);
  
  if (!config.OPENAI_API_KEY) {
    console.error('❌ OpenAI API key not found');
    return null;
  }

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    console.error('❌ Audio file does not exist:', filePath);
    return null;
  }

  const fileStats = fs.statSync(filePath);
  console.log('📊 File stats:', {
    size: fileStats.size,
    sizeKB: Math.round(fileStats.size / 1024),
    created: fileStats.birthtime
  });

  const headers = {
    'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
  };

  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), {
    filename: path.basename(filePath),
    contentType: 'audio/wav',
  });
  form.append('model', config.WHISPER_MODEL);

  console.log('📤 Whisper request data:', {
    filename: path.basename(filePath),
    model: config.WHISPER_MODEL,
    filePath: filePath
  });

  try {
    console.log('🌐 Sending request to Whisper API...');
    const response = await axios.post(`${OPEANAI_API_URL}/audio/transcriptions`, form, {
      headers: {
        ...headers,
        ...form.getHeaders(),
      },
      timeout: 30000 // 30 second timeout
    });
    console.log(`✅ API Response status: ${response.status}`);
    console.log('📥 Response data keys:', Object.keys(response.data));
    const result = response.data.text;
    console.log('📝 Transcript length:', result?.length || 0);
    return result;
  } catch (error) {
    console.error('❌ Whisper API call error:');
    console.error('Error status:', error.response?.status);
    console.error('Error data:', error.response?.data);
    console.error('Error message:', error.message);
    return null;
  }
} 