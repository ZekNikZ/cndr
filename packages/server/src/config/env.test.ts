import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('env configuration', () => {
  it('should validate environment variables', () => {
    const envSchema = z.object({
      NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
      PORT: z.coerce.number().default(3000),
      HOST: z.string().default('localhost'),
    });

    const result = envSchema.parse({
      NODE_ENV: 'test',
      PORT: 3000,
      HOST: 'localhost',
    });

    expect(result.NODE_ENV).toBe('test');
    expect(result.PORT).toBe(3000);
    expect(result.HOST).toBe('localhost');
  });
});
