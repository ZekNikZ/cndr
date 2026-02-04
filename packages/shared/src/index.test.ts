import { describe, expect, it } from 'vitest';
import type { ApiResponse, User } from './index.js';

describe('shared types', () => {
  it('should create a valid User type', () => {
    const user: User = {
      id: '123',
      name: 'Test User',
      email: 'test@example.com',
      createdAt: new Date(),
    };

    expect(user.id).toBe('123');
    expect(user.name).toBe('Test User');
    expect(user.email).toBe('test@example.com');
    expect(user.createdAt).toBeInstanceOf(Date);
  });

  it('should create a valid ApiResponse type', () => {
    const response: ApiResponse<string> = {
      success: true,
      data: 'test',
    };

    expect(response.success).toBe(true);
    expect(response.data).toBe('test');
  });
});
