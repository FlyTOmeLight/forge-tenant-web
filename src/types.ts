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
  teams: { id: string; name: string }[];
  gitlab_id: number | null;
}
export interface Team {
  id: string;
  name: string;
  member_count: number;
}
export interface ProjectPermissions {
  viewProject: boolean;
  readCode: boolean;
  createTask: boolean;
  manageMembers: boolean;
  configureExecution: boolean;
}
export interface ProjectPerson {
  id: string;
  name: string;
  canReview: boolean;
  canOwn: boolean;
}
export interface Project {
  permissions: ProjectPermissions;
  id: string;
  name: string;
  path: string;
  gitlab_id: number | null;
}
export interface Grant {
  direct_role: string;
  sources: { kind: string; id: string; name: string; role: string }[];
  desired_role: string;
  observed_role: string;
  effective_role: string;
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
  permissions: {
    manageMembers: boolean;
    manageProjects: boolean;
    viewSettings: boolean;
    viewAudit: boolean;
    viewSync: boolean;
  };
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
export interface Judgment {
  status: string;
  summary?: string;
}
export interface CodingSettings {
  agentID: string;
  agentVersion: number;
  version: number;
  baseBranch: string;
  model: string;
  allowedPaths: string[];
  checks: string[];
  repairLimit: number;
  timeoutMinutes: number;
  checkedAt?: string | null;
}
export interface SettingsResponse {
  settings: CodingSettings;
  branches: { name: string }[];
  permissions: ProjectPermissions;
  agents: { id: string; name: string; publishedVersion: number }[];
}
export interface Connections {
  gitlab: { status: string; url?: string };
  model: { status: string; models?: string[] };
  identity: { status: string; organization?: string };
}
export interface Access {
  read: boolean;
  write: boolean;
  manage: boolean;
  level: number;
}
export interface Task {
  tenantId: string;
  projectId: string;
  reviewerIds: string[];
  updatedAt: string;
  baseBranch: string;
  reproduce: string;
  constraints: string;
  reference: string;
  question?: string;
  agentJudgment: Judgment;
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
  runtime_id?: string | null;
  finished_at?: string | null;
  config_snapshot?: CodingSettings;
  id: string;
  status: string;
  created_at: string;
  requirements: string;
  output: {
    judgment?: Judgment;
    configVersion?: number;
    summary?: string;
    durationSeconds?: number;
    checksCommit?: string;
    error?: string;
    checks?: { attempt: number; passed: boolean; log: string }[];
    stopConfirmed?: boolean;
    patch?: string;
  } | null;
}
export interface TaskDiff {
  mrIid: number;
  base: string;
  head: string;
  start: string;
  sourceBranch: string;
  targetBranch: string;
  patch: string;
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
  gitlabTarget: "mergeRequest" | "branch" | "project";
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

export interface RoleDefinition {
  id: string;
  scope: string;
  name: string;
  permissions: string[];
  conditions: string[];
}
export interface PermissionReport {
  member: {
    id: string;
    user_id: string;
    name: string;
    role: string;
    status: string;
    user_status: string;
    tenant_status: string;
    operator: boolean;
  };
  teams: { id: string; name: string }[];
  tenantPermissions: Snapshot["permissions"];
  projects: {
    id: string;
    name: string;
    desiredRole: string;
    effectiveRole: string;
    permissions: ProjectPermissions;
    reason: string;
    sources: { kind: string; id: string; name: string; role: string }[];
  }[];
}
export interface TeamGrant {
  id: string;
  name: string;
  role: string;
  member_count: number;
}

export interface RunEvent {
  runID: string;
  seq: number;
  kind: string;
  createdAt: string;
  payload: {
    stepID?: string;
    name?: string;
    arguments?: string;
    argumentsTruncated?: boolean;
    result?: string;
    resultTruncated?: boolean;
    output?: string;
    outputTruncated?: boolean;
    detail?: string;
    detailTruncated?: boolean;
    error?: string;
    waitingStep?: string;
    attempt?: number;
  };
}
export interface RunTrace {
  run: {
    id: string;
    status: string;
    error?: string;
    output?: string;
    waitingStep?: string;
    eventSeq: number;
    attempt: number;
  } | null;
  events: RunEvent[];
  latestEvent?: RunEvent;
  nextSeq: number;
  hasMore: boolean;
}
