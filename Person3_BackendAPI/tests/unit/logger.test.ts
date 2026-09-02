import { logger } from '@/utils/logger';

describe('logger', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('redacts credentials embedded in a connection-string-shaped message', () => {
    logger.info('Connecting to mongodb+srv://dbuser:sup3rSecret@cluster0.mongodb.net/pnsm');

    const logged = logSpy.mock.calls[0][0] as string;
    expect(logged).not.toContain('sup3rSecret');
    expect(logged).not.toContain('dbuser');
    expect(logged).toContain('***:***@');
  });

  it('redacts credentials inside an Error object logged via logger.error', () => {
    const err = new Error('failed to connect to mongodb+srv://dbuser:sup3rSecret@cluster0.mongodb.net/pnsm');
    logger.error('MongoDB connection error', err);

    const logged = errorSpy.mock.calls[0][0] as string;
    expect(logged).not.toContain('sup3rSecret');
    expect(logged).toContain('***:***@');
  });

  it('redacts credentials nested inside logged fields, on any log level', () => {
    logger.warn('Upstream failure', { endpoint: 'https://key123:secretvalue@r2.example.com/bucket' });

    const logged = warnSpy.mock.calls[0][0] as string;
    expect(logged).not.toContain('secretvalue');
    expect(logged).not.toContain('key123');
    expect(logged).toContain('***:***@');
  });

  it('leaves ordinary messages with no embedded credentials unchanged', () => {
    logger.info('Server listening on port 5000');
    const logged = logSpy.mock.calls[0][0] as string;
    expect(logged).toContain('Server listening on port 5000');
  });

  it('leaves non-Error, non-string error() payloads intact aside from redaction', () => {
    logger.error('Something failed', { code: 'ETIMEDOUT' });
    const logged = errorSpy.mock.calls[0][0] as string;
    expect(logged).toContain('ETIMEDOUT');
  });
});
