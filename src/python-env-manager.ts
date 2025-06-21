import { spawn, ChildProcess } from 'child_process';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';

export interface PythonEnvInfo {
  pythonPath: string;
  pipPath: string;
  envPath: string;
  version: string;
  isEmbedded: boolean;
  packages: string[];
}

export class PythonEnvironmentManager extends EventEmitter {
  private envPath: string;
  private pythonPath: string;
  private pipPath: string;
  private uvPath: string;
  private isInitialized = false;
  private isEmbedded = false;

  constructor() {
    super();
    
    // Determine paths based on whether we're in development or production
    const isDev = !app.isPackaged;
    const appPath = isDev ? process.cwd() : app.getAppPath();
    
    this.envPath = path.join(appPath, 'python-env');
    this.pythonPath = path.join(this.envPath, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    this.pipPath = path.join(this.envPath, process.platform === 'win32' ? 'Scripts/pip.exe' : 'bin/pip');
    this.uvPath = this.findUv();
    
    console.log('🐍 Python Environment Manager initialized');
    console.log('📁 Environment path:', this.envPath);
    console.log('🔧 UV path:', this.uvPath);
  }

  private findUv(): string {
    // Try common locations for uv
    const possiblePaths = [
      'uv',
      '/usr/local/bin/uv',
      '/usr/bin/uv',
      path.join(process.env.HOME || '', '.local/bin/uv'),
      path.join(process.env.HOME || '', '.cargo/bin/uv'),
    ];

    for (const uvPath of possiblePaths) {
      try {
        const result = spawn(uvPath, ['--version'], { stdio: 'pipe' });
        if (result) {
          return uvPath;
        }
      } catch (error) {
        // Continue trying
      }
    }

    throw new Error('uv not found. Please install uv: curl -LsSf https://astral.sh/uv/install.sh | sh');
  }

  async initialize(): Promise<PythonEnvInfo> {
    console.log('🚀 Initializing Python environment...');

    try {
      // Check if embedded environment already exists
      if (await this.checkEmbeddedEnvironment()) {
        console.log('✅ Using existing embedded Python environment');
        this.isEmbedded = true;
        this.isInitialized = true;
        return this.getEnvironmentInfo();
      }

      // Try to create embedded environment
      console.log('🔧 Creating embedded Python environment with uv...');
      await this.createEmbeddedEnvironment();
      
      // Install dependencies
      console.log('📦 Installing Python dependencies...');
      await this.installDependencies();

      this.isEmbedded = true;
      this.isInitialized = true;
      console.log('✅ Embedded Python environment ready!');
      
      return this.getEnvironmentInfo();

    } catch (error) {
      console.warn('⚠️ Failed to create embedded environment, falling back to system Python');
      console.error('Error:', error);
      
      // Fallback to system Python
      return this.initializeSystemPython();
    }
  }

  private async checkEmbeddedEnvironment(): Promise<boolean> {
    return fs.existsSync(this.pythonPath) && fs.existsSync(this.envPath);
  }

  private async createEmbeddedEnvironment(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Create virtual environment with uv
      const uvProcess = spawn(this.uvPath, [
        'venv',
        this.envPath,
        '--python', '3.11', // Use Python 3.11 for good compatibility
        '--seed' // Include pip, setuptools, wheel
      ], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      uvProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      uvProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      uvProcess.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Virtual environment created successfully');
          resolve();
        } else {
          console.error('❌ Failed to create virtual environment');
          console.error('STDOUT:', stdout);
          console.error('STDERR:', stderr);
          reject(new Error(`uv venv failed with exit code ${code}: ${stderr}`));
        }
      });

      uvProcess.on('error', (error) => {
        reject(error);
      });
    });
  }

  private async installDependencies(): Promise<void> {
    const requirementsPath = path.join(process.cwd(), 'requirements.txt');
    
    if (!fs.existsSync(requirementsPath)) {
      console.log('📝 No requirements.txt found, skipping dependency installation');
      return;
    }

    return new Promise((resolve, reject) => {
      // Use uv pip install for faster dependency resolution
      const installProcess = spawn(this.uvPath, [
        'pip', 'install',
        '-r', requirementsPath,
        '--python', this.pythonPath
      ], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      installProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        console.log('📦', output.trim());
      });

      installProcess.stderr?.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        console.log('📦', output.trim());
      });

      installProcess.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Dependencies installed successfully');
          resolve();
        } else {
          console.error('❌ Failed to install dependencies');
          console.error('STDERR:', stderr);
          reject(new Error(`Dependency installation failed with exit code ${code}: ${stderr}`));
        }
      });

      installProcess.on('error', (error) => {
        reject(error);
      });
    });
  }

  private async initializeSystemPython(): Promise<PythonEnvInfo> {
    // Fallback to system Python detection
    const systemPythonPaths = [
      'python3',
      'python',
      '/usr/bin/python3',
      '/usr/local/bin/python3',
      'python3.11',
      'python3.10',
      'python3.9'
    ];

    for (const pythonCmd of systemPythonPaths) {
      try {
        const version = await this.getPythonVersion(pythonCmd);
        if (version) {
          this.pythonPath = pythonCmd;
          this.isEmbedded = false;
          this.isInitialized = true;
          console.log(`✅ Using system Python: ${pythonCmd} (${version})`);
          return this.getEnvironmentInfo();
        }
      } catch (error) {
        // Continue trying other Python paths
      }
    }

    throw new Error('No suitable Python installation found');
  }

  private async getPythonVersion(pythonPath: string): Promise<string | null> {
    return new Promise((resolve) => {
      const process = spawn(pythonPath, ['--version'], { stdio: 'pipe' });
      
      let output = '';
      process.stdout?.on('data', (data) => output += data.toString());
      process.stderr?.on('data', (data) => output += data.toString());
      
      process.on('close', (code) => {
        if (code === 0 && output.includes('Python')) {
          resolve(output.trim());
        } else {
          resolve(null);
        }
      });

      process.on('error', () => resolve(null));
    });
  }

  async installPackage(packageName: string): Promise<boolean> {
    if (!this.isInitialized) {
      throw new Error('Python environment not initialized');
    }

    console.log(`📦 Installing package: ${packageName}`);

    return new Promise((resolve) => {
      const installCmd = this.isEmbedded && this.uvPath ? 
        [this.uvPath, 'pip', 'install', packageName, '--python', this.pythonPath] :
        [this.pipPath || 'pip', 'install', packageName];

      const installProcess = spawn(installCmd[0], installCmd.slice(1), {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      installProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      installProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      installProcess.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ Successfully installed ${packageName}`);
          resolve(true);
        } else {
          console.error(`❌ Failed to install ${packageName}:`, stderr);
          resolve(false);
        }
      });

      installProcess.on('error', (error) => {
        console.error(`❌ Error installing ${packageName}:`, error);
        resolve(false);
      });
    });
  }

  async getEnvironmentInfo(): Promise<PythonEnvInfo> {
    const packages = await this.getInstalledPackages();
    const version = await this.getPythonVersion(this.pythonPath) || 'Unknown';

    return {
      pythonPath: this.pythonPath,
      pipPath: this.pipPath,
      envPath: this.envPath,
      version,
      isEmbedded: this.isEmbedded,
      packages
    };
  }

  private async getInstalledPackages(): Promise<string[]> {
    return new Promise((resolve) => {
      const listCmd = this.isEmbedded && this.uvPath ?
        [this.uvPath, 'pip', 'list', '--python', this.pythonPath] :
        [this.pipPath || 'pip', 'list'];

      const listProcess = spawn(listCmd[0], listCmd.slice(1), {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      listProcess.stdout?.on('data', (data) => output += data.toString());

      listProcess.on('close', () => {
        const packages = output
          .split('\n')
          .slice(2) // Skip header lines
          .map(line => line.split(/\s+/)[0])
          .filter(pkg => pkg && pkg.length > 0);
        
        resolve(packages);
      });

      listProcess.on('error', () => resolve([]));
    });
  }

  getPythonPath(): string {
    return this.pythonPath;
  }

  isReady(): boolean {
    return this.isInitialized;
  }

  isUsingEmbeddedEnvironment(): boolean {
    return this.isEmbedded;
  }

  async cleanup(): Promise<void> {
    // Cleanup if needed
    console.log('🧹 Python Environment Manager cleanup');
  }
} 