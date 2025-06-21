#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Setup Python environment for MetaKeyAI
async function setupPythonEnvironment() {
  console.log('🐍 Setting up Python environment for MetaKeyAI...');
  
  const appPath = process.cwd();
  const envPath = path.join(appPath, 'python-env');
  const requirementsPath = path.join(appPath, 'requirements.txt');
  
  // Check if environment already exists
  if (fs.existsSync(envPath)) {
    console.log('✅ Python environment already exists');
    return;
  }
  
  // Check if uv is available
  const uvPath = await findUv();
  if (!uvPath) {
    console.error('❌ uv not found. Please install uv first:');
    console.error('   curl -LsSf https://astral.sh/uv/install.sh | sh');
    process.exit(1);
  }
  
  try {
    // Create virtual environment
    console.log('🔧 Creating Python virtual environment...');
    await runCommand(uvPath, ['venv', envPath, '--python', '3.11', '--seed']);
    
    // Install dependencies if requirements.txt exists
    if (fs.existsSync(requirementsPath)) {
      console.log('📦 Installing Python dependencies...');
      const pythonPath = path.join(envPath, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      await runCommand(uvPath, ['pip', 'install', '-r', requirementsPath, '--python', pythonPath]);
    }
    
    console.log('✅ Python environment setup complete!');
    
  } catch (error) {
    console.error('❌ Failed to setup Python environment:', error.message);
    process.exit(1);
  }
}

async function findUv() {
  const possiblePaths = [
    'uv',
    '/usr/local/bin/uv',
    '/usr/bin/uv',
    path.join(process.env.HOME || '', '.local/bin/uv'),
    path.join(process.env.HOME || '', '.cargo/bin/uv'),
  ];
  
  for (const uvPath of possiblePaths) {
    try {
      await runCommand(uvPath, ['--version'], { stdio: 'ignore' });
      return uvPath;
    } catch (error) {
      // Continue trying
    }
  }
  
  return null;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ['pipe', 'inherit', 'inherit'],
      ...options
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
    
    proc.on('error', reject);
  });
}

// Run setup if called directly
if (require.main === module) {
  setupPythonEnvironment().catch(console.error);
}

module.exports = { setupPythonEnvironment }; 