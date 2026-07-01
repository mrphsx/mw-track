import { AsyncLocalStorage } from 'async_hooks';
import { UserRole } from '@prisma/client';

export interface CompanyContext {
  companyId: string;
  userId: string;
  role: UserRole;
}

export const companyStorage = new AsyncLocalStorage<CompanyContext>();

export function getCompanyContext(): CompanyContext {
  const ctx = companyStorage.getStore();
  if (!ctx) throw new Error('Company context not initialized');
  return ctx;
}
