const winston = require('winston');
const config = require('../config');

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `[${info.timestamp}] [${info.level}]: ${info.message}${info.stack ? '\n' + info.stack : ''}`
  )
);

const transports = [
  new winston.transports.Console()
];

// If in production, also log to files
if (config.env === 'production') {
  transports.push(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: winston.format.combine(winston.format.uncolorize(), winston.format.json())
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: winston.format.combine(winston.format.uncolorize(), winston.format.json())
    })
  );
}

const logger = winston.createLogger({
  level: config.isDev ? 'debug' : 'info',
  levels,
  format,
  transports,
});

module.exports = logger;
