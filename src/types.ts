export interface User {
  id: string;
  name: string;
  email: string;
  operator: boolean;
}
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  version: number;
  sync_status: string;
  member_count: number;
  project_count: number;
}
export interface Member {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  team_id: string | null;
  team_name: string | null;
  gitlab_id: number | null;
}
export interface Team {
  id: string;
  name: string;
}
export interface Project {
  id: string;
  name: string;
  path: string;
  gitlab_id: number | null;
}
export interface Grant {
  project_id: string;
  membership_id: string;
  name: string;
  member_status: string;
  desired_level: number;
  observed_level: number;
  effective_level: number;
  checked_at: string | null;
}
export interface Operation {
  id: string;
  version: number;
  status: string;
  attempts: number;
  error_message: string;
  error_code: string;
  updated_at: string;
  next_attempt_at: string;
}
export interface Audit {
  id: string;
  actor_id: string;
  action: string;
  detail: unknown;
  target: string;
  operation_id: string;
  created_at: string;
}
export interface Snapshot {
  tenant: Tenant;
  can_manage: boolean;
  members: Member[];
  teams: Team[];
  projects: Project[];
  grants: Grant[];
  operations: Operation[];
  audit: Audit[];
}
export interface Mutation {
  tenant_id?: string;
  invitation_url?: string;
  operation_id?: string;
}
export interface Field {
  name: string;
  label: string;
  type?: string;
  value?: string;
  required?: boolean;
  help?: string;
  options?: { value: string; label: string }[];
}
export interface Discussion {
  id: string;
  notes?: {
    id: number;
    system: boolean;
    body: string;
    author?: { name: string };
    position?: {
      head_sha: string;
      new_path: string;
      old_path: string;
      new_line: number;
      old_line: number;
    };
  }[];
}
export interface Task {
  id: string;
  title: string;
  description: string;
  criteria: string;
  head: string;
  branch: string;
  targetBranch: string;
  mrIid: number;
  status: string;
  control: string;
  version: number;
  round: number;
  checks: string;
  checkedHead: string;
  approvalHead: string;
  ownerId: string;
  synthetic: boolean;
  activeRun: string | null;
  stopConfirmed: boolean;
  stopRequestedAt: string | null;
  discussions: Discussion[];
}
export interface Feedback {
  id: string;
  status: string;
  requirements: string;
  head: string;
}
export interface Run {
  id: string;
  status: string;
  created_at: string;
  requirements: string;
  output: {
    summary?: string;
    durationSeconds?: number;
    checksCommit?: string;
    error?: string;
    checks?: { attempt: number; passed: boolean; log: string }[];
    stopConfirmed?: boolean;
    patch?: string;
  } | null;
}
export interface TaskDetail {
  task: Task;
  permissions: {
    read: boolean;
    write: boolean;
    manage: boolean;
    review: boolean;
  };
  gitlabUrl: string;
  feedback: Feedback[];
  runs: Run[];
  events: {
    id: string;
    type: string;
    actor_id: string;
    created_at: string;
    detail: unknown;
  }[];
}
