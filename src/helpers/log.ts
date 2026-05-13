export type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug: (message: string) => void;
};

export function createLogger(debugEnabled: boolean): Logger {
  return {
    info: (message) => console.log(`[proxy] ${message}`),
    warn: (message) => console.error(`[proxy] ${message}`),
    error: (message) => console.error(`[proxy] ${message}`),
    debug: (message) => {
      if (debugEnabled) {
        console.log(`[proxy] ${message}`);
      }
    },
  };
}
