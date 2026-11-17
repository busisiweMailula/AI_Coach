export interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

export interface LoginResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    role: string;
    createdAt: string;
  };
}

export interface ConsentStatus {
  purpose: string;
  policyVersion: string;
  accepted: boolean;
}

export type ConsentPurpose = "resume_processing" | "external_model_processing";

export interface ResumeUploadResponse {
  resume: {
    parseJobId?: string;
  };
}

export interface JobStatus {
  status: string;
  error: {
    code: string;
    message: string;
  } | null;
}

interface RequestOptions extends Omit<RequestInit, "headers"> {
  token?: string;
  headers?: HeadersInit;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const { token, ...requestOptions } = options;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, { ...requestOptions, headers });
  const payload = await response.json().catch(() => null) as ApiEnvelope<T> & ApiErrorPayload | null;
  if (!response.ok) {
    throw new ApiError(
      payload?.error?.message ?? "The request could not be completed.",
      response.status,
      payload?.error?.code,
    );
  }
  if (!payload?.success) {
    throw new Error("The server returned an invalid response.");
  }
  return payload.data;
}

export function login(email: string, password: string): Promise<LoginResponse> {
  return request("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function getConsentStatus(token: string): Promise<ConsentStatus[]> {
  return request("/api/v1/candidates/me/consents/status", { token });
}

export function recordConsent(
  token: string,
  purpose: ConsentPurpose,
  granted: boolean,
): Promise<unknown> {
  return request("/api/v1/candidates/me/consents", {
    token,
    method: "PUT",
    body: JSON.stringify({ purpose, granted }),
  });
}

export function uploadResume(token: string, file: File): Promise<ResumeUploadResponse> {
  const form = new FormData();
  form.append("file", file);
  return request("/api/v1/resumes/upload", {
    token,
    method: "POST",
    body: form,
  });
}

export function getJobStatus(token: string, jobId: string): Promise<JobStatus> {
  return request(`/api/v1/jobs/status/${encodeURIComponent(jobId)}`, { token });
}
