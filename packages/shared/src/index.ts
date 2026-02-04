/**
 * Shared types and utilities for cndr monorepo
 */

export type User = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
};

export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export type PaginationParams = {
  page: number;
  limit: number;
};

export type PaginatedResponse<T> = ApiResponse<{
  items: T[];
  total: number;
  page: number;
  limit: number;
}>;
