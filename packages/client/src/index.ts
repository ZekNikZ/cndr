/**
 * Client library for cndr API
 */

import type { ApiResponse, PaginatedResponse, User } from '@cndr/shared';

export type ClientConfig = {
  baseUrl: string;
  apiKey?: string;
  timeout?: number;
};

export class CndrClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeout: number;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? 30000;
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (options?.headers) {
      const optHeaders = new Headers(options.headers);
      optHeaders.forEach((value, key) => {
        headers[key] = value;
      });
    }

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error || `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      return {
        success: true,
        data,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getUser(id: string): Promise<ApiResponse<User>> {
    return this.request<User>(`/users/${id}`);
  }

  async listUsers(page = 1, limit = 10): Promise<PaginatedResponse<User>> {
    return this.request<{ items: User[]; total: number; page: number; limit: number }>(
      `/users?page=${page}&limit=${limit}`
    );
  }

  async createUser(user: Omit<User, 'id' | 'createdAt'>): Promise<ApiResponse<User>> {
    return this.request<User>('/users', {
      method: 'POST',
      body: JSON.stringify(user),
    });
  }
}

export type { User, ApiResponse, PaginatedResponse } from '@cndr/shared';
