import type { User } from "../types";
export interface Prototype {
  users: (User & { roleLabel: string })[];
  user(): User;
  request(path: string, options?: RequestInit): Promise<unknown>;
  acceptInvitation(id: string): void;
  setUser(id: string): void;
  reset(): void;
  simulate(id: string, type: string): Promise<unknown>;
}
export function createPrototype(): Prototype;
