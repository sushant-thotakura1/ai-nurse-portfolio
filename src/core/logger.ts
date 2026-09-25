import { config } from './config';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  metadata?: Record<string, any>;
}

class Logger {
  private logLevel: LogLevel;

  constructor(level: LogLevel = 'info') {
    this.logLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['error', 'warn', 'info', 'debug'];
    return levels.indexOf(level) <= levels.indexOf(this.logLevel);
  }

  private log(
    level: LogLevel,
    message: string,
    metadata?: Record<string, any>,
  ) {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(metadata && { metadata }),
    };

    console.log(JSON.stringify(entry));
  }

  error(message: string, metadata?: Record<string, any>) {
    this.log('error', message, metadata);
  }

  warn(message: string, metadata?: Record<string, any>) {
    this.log('warn', message, metadata);
  }

  info(message: string, metadata?: Record<string, any>) {
    this.log('info', message, metadata);
  }

  debug(message: string, metadata?: Record<string, any>) {
    this.log('debug', message, metadata);
  }
}

export const logger = new Logger(config.logLevel as LogLevel);
