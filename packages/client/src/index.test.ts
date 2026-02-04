import { describe, expect, it } from 'vitest';
import { CndrClient } from './index.js';

describe('CndrClient', () => {
  it('should create a client instance', () => {
    const client = new CndrClient({
      baseUrl: 'http://localhost:3000',
      apiKey: 'test-key',
      timeout: 5000,
    });

    expect(client).toBeInstanceOf(CndrClient);
  });
});
