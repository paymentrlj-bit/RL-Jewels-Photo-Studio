// Thin API client. One place that knows how to talk to the server, so error
// handling and the 401 case are handled once rather than in every component.

import type {
  Product, Batch, SessionUser, CpcLookupResult, QueueDepth, HealthFeatures,
} from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string, public detail?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// Set when any request comes back 401, so the app can drop straight to the
// sign-in screen instead of rendering an empty dashboard.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    credentials: 'same-origin',
  });

  if (response.status === 401) {
    onUnauthorized?.();
    throw new ApiError(401, 'Your session has expired. Please sign in again.');
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) {
      throw new ApiError(response.status, `Server returned ${response.status}.`);
    }
    return undefined as T;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new ApiError(response.status, data?.error || `Server returned ${response.status}.`, data?.debugDetail);
  }
  return data as T;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
}

export const api = {
  // --- auth ---
  health: () => request<{ status: string; features: HealthFeatures; erpMapping: string }>('/health'),
  login: (username: string, password: string) => post<SessionUser>('/login', { username, password }),
  logout: () => post<{ success: boolean }>('/logout'),
  session: () => request<SessionUser>('/session'),

  // --- batches ---
  currentBatch: () => request<{ batch: Batch }>('/batches/current'),
  listBatches: () => request<{ batches: Batch[] }>('/batches'),
  createBatch: (name: string) => post<{ batch: Batch }>('/batches', { name }),
  closeBatch: (id: string) => post<{ success: boolean }>(`/batches/${id}/close`),

  // --- products ---
  listProducts: (params: { batchId?: string; status?: string; search?: string; limit?: number } = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    const suffix = query.toString();
    return request<{ products: Product[]; counts: Record<string, number> }>(`/products${suffix ? `?${suffix}` : ''}`);
  },
  getProduct: (id: string) =>
    request<{ product: Product; previousShoots: Product[] }>(`/products/${id}`),
  createProduct: (fields: Record<string, unknown>) => post<{ product: Product }>('/products', fields),
  updateProduct: (id: string, fields: Record<string, unknown>) =>
    request<{ product: Product }>(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }),
  deleteProduct: (id: string) => request<{ success: boolean }>(`/products/${id}`, { method: 'DELETE' }),

  attachPhoto: (id: string, imageBase64: string, source: string) =>
    post<{ product: Product; photoId: string; jobId: string }>(`/products/${id}/photo`, { imageBase64, source }),

  approve: (id: string, note?: string) => post<{ product: Product }>(`/products/${id}/approve`, { note }),
  reject: (id: string, note: string) => post<{ product: Product }>(`/products/${id}/reject`, { note }),
  requeue: (id: string, options: { proceedWithoutAngle?: boolean } = {}) =>
    post<{ product: Product }>(`/products/${id}/requeue`, options),
  addAngle: (id: string, imageBase64: string) =>
    post<{ product: Product; photoId: string; jobId: string }>(`/products/${id}/angle`, { imageBase64 }),

  photoUrl: (photoId: string) => `/api/photos/${photoId}`,

  // --- queue ---
  queueStatus: () => request<{ depth: QueueDepth; productCounts: Record<string, number> }>('/queue/status'),

  // --- catalog ---
  cpcLookup: (cpc: string) => request<CpcLookupResult>(`/cpc-lookup?cpc=${encodeURIComponent(cpc)}`),
  learnCpc: (body: Record<string, unknown>) => post<{ success: boolean }>('/cpc-lookup/learn', body),
  cpcStats: () => request<{ totalRows: number; totalProducts: number; learnedThisSession: number }>('/cpc-stats'),

  // --- export ---
  exportMappings: () =>
    request<{ mappings: { id: string; label: string; description?: string; columnCount: number }[]; active: string }>('/export/mappings'),
  driveStatus: () => request<{ configured: boolean }>('/export/drive-status'),
  exportToDrive: (batchId: string, mapping?: string) =>
    post<{ success: boolean; uploaded: number; failedCount: number; folderLink: string; failures: { cpc: string; error: string }[] }>(
      `/export/batch/${batchId}/drive`, { mapping }
    ),
  csvUrl: (batchId: string, mapping: string) => `/api/export/batch/${batchId}/csv?mapping=${encodeURIComponent(mapping)}`,
  zipUrl: (batchId: string, mapping: string) => `/api/export/batch/${batchId}/zip?mapping=${encodeURIComponent(mapping)}`,

  // --- admin ---
  listUsers: () => request<{ users: (SessionUser & { isActive: boolean; lastLoginAt: string | null })[] }>('/admin/users'),
  createUser: (body: Record<string, unknown>) => post<{ user: SessionUser }>('/admin/users', body),
  updateUser: (id: string, body: Record<string, unknown>) =>
    request<{ user: SessionUser }>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  getPrompt: () => request<{ prompt: string; isCustom: boolean; updatedAt: string | null; updatedBy: string | null }>('/admin/prompt'),
  savePrompt: (prompt: string) => post<{ prompt: string; isCustom: boolean }>('/admin/prompt', { prompt }),
  resetPrompt: () => post<{ prompt: string; isCustom: boolean }>('/admin/prompt', { reset: true }),
  analytics: (days = 30) => request<AnalyticsSummary>(`/admin/analytics/summary?days=${days}`),
};

export interface AnalyticsSummary {
  windowDays: number;
  throughput: {
    photosProcessed: number;
    byStatus: Record<string, number>;
    approvalRate: number | null;
    reshootRate: number | null;
    escalationCount: number;
    escalationRate: number | null;
    avgLatencyMs: number | null;
  };
  cost: { totalEstimatedUsd: number; avgPerPhotoUsd: number | null; calibrated: boolean; note: string };
  qualityChecks: { verdictsAnalyzed: number; failuresByCheck: Record<string, number>; note: string };
  stageLatency: Record<string, { calls: number; failures: number; timeouts: number; avgLatencyMs: number }>;
  system: {
    productCounts: Record<string, number>;
    queue: QueueDepth;
    storage: { photoCount: number; totalBytes: number };
    cpcMaster: { totalRows: number; totalProducts: number };
    erpMapping: string;
    axiomMirror: boolean;
  };
}
