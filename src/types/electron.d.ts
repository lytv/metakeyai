interface ElectronAPI {
  ipcRenderer?: {
    send: (channel: string, ...args: any[]) => void;
    // Thêm các method khác nếu cần
  };
}

declare interface Window {
  electron?: ElectronAPI;
} 