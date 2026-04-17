import axios, { AxiosInstance, AxiosError } from 'axios';
import type {
  LCPresentation,
  Finding,
  AuditEvent,
  Override,
  OverrideData,
  LoginResponse,
  PresentationsResponse,
  QueueStats,
} from '../types';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Request interceptor — attach JWT from localStorage
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Response interceptor — handle 401 by redirecting to login
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

// ─── Auth ────────────────────────────────────────────────────────────────────

export async function login(email: string, password: string): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>('/auth/login', { email, password });
  return data;
}

// ─── Document upload ─────────────────────────────────────────────────────────

export interface UploadResult {
  presentationId: string;
  presentation: LCPresentation;
}

export async function uploadDocuments(
  files: File[],
  onUploadProgress?: (percent: number) => void,
): Promise<UploadResult> {
  const formData = new FormData();
  files.forEach((file) => formData.append('documents', file));

  const { data } = await apiClient.post<UploadResult>('/presentations/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (event) => {
      if (onUploadProgress && event.total) {
        onUploadProgress(Math.round((event.loaded * 100) / event.total));
      }
    },
  });
  return data;
}

// ─── Presentations ───────────────────────────────────────────────────────────

export interface GetPresentationsParams {
  page?: number;
  pageSize?: number;
  status?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  search?: string;
}

export async function getPresentations(
  params?: GetPresentationsParams,
): Promise<PresentationsResponse> {
  const { data } = await apiClient.get<PresentationsResponse>('/presentations', { params });
  return data;
}

export async function getPresentation(id: string): Promise<LCPresentation> {
  const { data } = await apiClient.get<LCPresentation>(`/presentations/${id}`);
  return data;
}

// ─── Queue ───────────────────────────────────────────────────────────────────

export interface QueueResponse {
  presentations: LCPresentation[];
  stats: QueueStats;
}

export async function getQueue(): Promise<QueueResponse> {
  const { data } = await apiClient.get<QueueResponse>('/queue');
  return data;
}

// ─── Findings ────────────────────────────────────────────────────────────────

export async function getFindings(presentationId: string): Promise<Finding[]> {
  const { data } = await apiClient.get<Finding[]>(`/presentations/${presentationId}/findings`);
  return data;
}

// ─── Overrides ───────────────────────────────────────────────────────────────

export async function submitOverride(
  findingId: string,
  overrideData: OverrideData,
): Promise<Override> {
  const { data } = await apiClient.post<Override>(
    `/findings/${findingId}/override`,
    overrideData,
  );
  return data;
}

// ─── Audit trail ─────────────────────────────────────────────────────────────

export async function getAuditTrail(presentationId: string): Promise<AuditEvent[]> {
  const { data } = await apiClient.get<AuditEvent[]>(
    `/presentations/${presentationId}/audit`,
  );
  return data;
}

export async function exportAuditTrail(presentationId: string): Promise<Blob> {
  const { data } = await apiClient.get(`/presentations/${presentationId}/audit/export`, {
    responseType: 'blob',
  });
  return data;
}

// ─── SSE progress stream ──────────────────────────────────────────────────────

/**
 * Returns the SSE stream URL for real-time validation progress.
 * Use with the EventSource API — SSE doesn't support Authorization headers,
 * so the token is passed as a query param (handled by backend middleware).
 *
 * Note: the backend `authenticate` middleware should be updated to also check
 * `req.query.token` for SSE connections, in addition to the Authorization header.
 */
export function getProgressStreamUrl(presentationId: string): string {
  const token = localStorage.getItem('auth_token') ?? '';
  return `/api/validations/${presentationId}/progress?token=${encodeURIComponent(token)}`;
}

export default apiClient;
