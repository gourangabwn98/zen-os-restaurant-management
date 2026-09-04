// src/logger.js
const ts = () => new Date().toISOString();

export const logger = {
  info:  (...args) => console.log(`[${ts()}] ℹ️ `, ...args),
  warn:  (...args) => console.warn(`[${ts()}] ⚠️ `, ...args),
  error: (...args) => console.error(`[${ts()}] ❌`, ...args),
  ok:    (...args) => console.log(`[${ts()}] ✅`, ...args),
};
