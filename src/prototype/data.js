import roleDefinitions from "./roles.json";
import { TaskFlow } from "./state.js";
/* Explicit local prototype transport. Live mode never uses these records. */
export function createPrototype() {
  "use strict";
  const key = "forge-vue-prototype-v3",
    now = () => new Date().toISOString();
  const users = [
    {
      id: "u-lin",
      name: "林予安",
      email: "lin@example.test",
      operator: true,
      roleLabel: "项目管理员",
    },
    {
      id: "u-zhou",
      name: "周以宁",
      email: "zhou@example.test",
      operator: false,
      roleLabel: "审查者",
    },
    {
      id: "u-chen",
      name: "陈澄",
      email: "chen@example.test",
      operator: false,
      roleLabel: "开发者",
    },
  ];
  users.push({
    id: "u-platform",
    name: "平台运营员",
    email: "platform@example.test",
    operator: true,
    roleLabel: "仅平台管理员",
  });
  function seed() {
    const tenant = {
      id: "demo-tenant",
      name: "星河科技",
      slug: "xinghe",
      status: "active",
      sync_status: "succeeded",
      version: 1,
      member_count: 3,
      project_count: 3,
    };
    const members = users.slice(0, 3).map((u, i) => ({
      id: "m-" + i,
      user_id: u.id,
      name: u.name,
      email: u.email,
      role: i === 0 ? "admin" : "member",
      status: "active",
      gitlab_id: i + 1,
      teams: [{ id: "team-1", name: "应用研发" }],
    }));
    const projects = ["billing-api", "agentic-kit", "portal-web"].map(
      (name, i) => ({
        id: "p-" + i,
        name,
        path: "xinghe/" + name,
        gitlab_id: i + 1,
      }),
    );
    const grants = projects.flatMap((p) =>
      members.map((m, i) => ({
        project_id: p.id,
        membership_id: m.id,
        name: m.name,
        member_status: "active",
        direct_level: [40, 20, 30][i],
        desired_level: [40, 20, 30][i],
        observed_level: [40, 20, 30][i],
        effective_level: [40, 20, 30][i],
        checked_at: now(),
      })),
    );
    const settings = Object.fromEntries(
      projects.map((p) => [
        p.id,
        {
          version: 1,
          baseBranch: "main",
          agentID: "demo-coding-agent",
          agentVersion: 1,
          model: "qwen3.8:27b-mlx",
          allowedPaths: p.name === "portal-web" ? ["src/"] : ["internal/"],
          checks:
            p.name === "portal-web"
              ? ["npm test", "npm run build"]
              : ["go test ./...", "go vet ./..."],
          repairLimit: 3,
          timeoutMinutes: 30,
          checkedAt: now(),
        },
      ]),
    );
    const states = [
      ["修复分页参数为空时接口异常", "queued"],
      ["修复工作目录路径越界校验", "running"],
      ["确认空值与默认参数的处理约定", "waiting"],
      ["修复权限撤销后仍可执行的问题", "review"],
      ["处理批量导入时的验证失败", "failed"],
      ["完善移动端任务详情布局", "review"],
      ["修复错误提示未保留上下文", "completed"],
      ["取消过期的接口修复需求", "canceled"],
    ];
    const tasks = states.map(([title, status], i) => {
      const t = TaskFlow.create({
        id: String(142 + i),
        title,
        status,
        project: projects[i % 3].name,
        owner: i === 5 ? "陈澄" : "林予安",
        creator: "林予安",
        reviewers: ["林予安", "周以宁"],
        round: status === "queued" ? 0 : 1,
        roundConfig: 1,
        head: "demo-" + (1001 + i),
        base: "main",
        branch: "agent/fix-" + (142 + i),
        description:
          "在真实使用流程中发现边界输入处理不完整，需要保持现有契约并补充验证。",
        reproduce: "打开对应功能，输入空值或边界参数，观察结果与约定不一致。",
        criteria: "修复所述问题；保留已有行为；相关检查通过。",
        constraint: "只修改本项目允许范围内的实现和相邻测试。",
        question:
          status === "waiting" ? "空参数应返回错误还是采用默认值？" : "",
        resource: status === "running",
        active: ["running", "waiting"].includes(status),
        stopConfirmed: !["running", "waiting"].includes(status),
        control: i === 5 ? "human" : "agent",
        hasChanges: ["review", "failed", "completed"].includes(status),
        mr: ["review", "failed", "completed"].includes(status)
          ? "!" + (50 + i)
          : null,
        mrState:
          status === "completed"
            ? "merged"
            : ["review", "failed"].includes(status)
              ? "open"
              : "none",
        verified: ["review", "completed"].includes(status),
        verification: ["review", "completed"].includes(status)
          ? "passed"
          : status === "failed"
            ? "failed"
            : "pending",
        verificationCommit: ["review", "completed", "failed"].includes(status)
          ? "demo-" + (1001 + i)
          : null,
        humanReview:
          status === "completed"
            ? {
                commit: "demo-" + (1001 + i),
                result: "通过",
                reviewer: "林予安",
              }
            : null,
        agentJudgment: ["review", "completed"].includes(status)
          ? "满足验收条件（模拟）"
          : "待执行",
      });
      return {
        state: t,
        projectId: projects[i % 3].id,
        apiVersion: 1,
        synthetic: true,
        createdAt: now(),
        updatedAt: now(),
        runs:
          status === "queued"
            ? []
            : [
                {
                  id: "run-" + i,
                  status:
                    status === "running"
                      ? "Running"
                      : status === "waiting"
                        ? "Waiting"
                        : status === "failed"
                          ? "Failed"
                          : "Passed",
                  created_at: now(),
                  requirements: t.criteria,
                  config_snapshot: structuredClone(
                    settings[projects[i % 3].id],
                  ),
                  output: {
                    summary: "原型执行结果，用于演练协作流程。",
                    checks: [
                      {
                        attempt: 1,
                        passed: status !== "failed",
                        log:
                          status === "failed"
                            ? "模拟检查失败：预期参数错误，实际未返回错误。"
                            : "模拟执行 go test / go vet：检查通过。",
                      },
                    ],
                    patch:
                      'diff --git a/internal/params.go b/internal/params.go\n--- a/internal/params.go\n+++ b/internal/params.go\n@@ -8,1 +8,2 @@\n+ // Validate boundary input before continuing.\n+ if input == "" { return ErrInvalidInput }',
                    judgment: {
                      status: status === "failed" ? "Unmet" : "Met",
                      summary: "模拟判断，真实环境由执行轮次生成。",
                    },
                    checksCommit: t.head,
                  },
                },
              ],
        events: [
          {
            type: "TaskCreated",
            actor_id: "u-lin",
            created_at: now(),
            detail: { text: "原型任务已创建" },
          },
        ],
      };
    });
    [...members, ...projects, ...grants, ...tasks].forEach(
      (x) => (x.tenant_id = "demo-tenant"),
    );
    return {
      userId: "u-lin",
      tenants: [tenant],
      members,
      projects,
      grants,
      teamGrants: [],
      teams: [{ id: "team-1", name: "应用研发", tenant_id: "demo-tenant" }],
      settings,
      tasks,
      operations: [],
      audit: [],
    };
  }
  let db;
  try {
    db = JSON.parse(localStorage.getItem(key)) || seed();
  } catch {
    db = seed();
  }
  const save = () => {
    try {
      localStorage.setItem(key, JSON.stringify(db));
    } catch {}
  };
  const user = () => users.find((u) => u.id === db.userId) || users[0];
  const member = () =>
    db.members.find((m) => m.user_id === user().id && m.status === "active");
  const tenant = (id) => db.tenants.find((t) => t.id === id);
  function level(pid, uid = user().id) {
    const tid = db.projects.find((p) => p.id === pid)?.tenant_id;
    const m = db.members.find(
      (m) => m.tenant_id === tid && m.user_id === uid && m.status === "active",
    );
    const g = db.grants.find(
      (g) => g.project_id === pid && g.membership_id === m?.id,
    );
    return tenant(tid)?.status === "active"
      ? Math.min(
          g?.desired_level || 0,
          g?.observed_level || 0,
          g?.effective_level || 0,
        )
      : 0;
  }
  const access = (pid) => ({
    read: level(pid) >= 20,
    write: level(pid) >= 30,
    manage: level(pid) >= 40,
  });
  const tenantAdmin = (tid) =>
    db.members.some(
      (m) =>
        m.tenant_id === tid &&
        m.user_id === user().id &&
        m.status === "active" &&
        m.role === "admin",
    );
  function projectPermissions(pid) {
    const tid = db.projects.find((p) => p.id === pid)?.tenant_id,
      a = access(pid),
      active = tenant(tid)?.status === "active";
    return {
      viewProject: tenantAdmin(tid) || a.read,
      readCode: a.read,
      createTask: a.write,
      manageMembers: active && (tenantAdmin(tid) || a.manage),
      configureExecution: a.manage,
    };
  }
  const roleName = (level) =>
    level >= 40
      ? "admin"
      : level >= 30
        ? "developer"
        : level >= 20
          ? "reviewer"
          : "none";
  const person = (name) => users.find((u) => u.name === name)?.id || name;
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  function task(r) {
    const t = r.state;
    return {
      id: t.id,
      tenantId: r.tenant_id || "demo-tenant",
      projectId: r.projectId,
      title: t.title,
      description: t.description,
      reproduce: t.reproduce,
      criteria: t.criteria,
      constraints: t.constraint,
      reference: t.reference,
      baseBranch: t.base,
      targetBranch: t.base,
      branch: t.branch,
      ownerId: person(t.owner),
      reviewerIds: t.reviewers.map(person),
      status: cap(t.status),
      control: cap(t.control),
      head: t.head,
      checkedHead: t.verificationCommit || "",
      checks:
        t.verification === "passed"
          ? "Passed"
          : t.verification === "failed"
            ? "Failed"
            : "NotRun",
      agentJudgment: {
        status:
          t.verification === "passed"
            ? "Met"
            : t.verification === "failed"
              ? "Unmet"
              : "Unknown",
        summary: t.agentJudgment,
      },
      mrIid: t.mr ? Number(t.mr.slice(1)) : 0,
      mrState: t.mrState === "open" ? "opened" : t.mrState,
      round: t.round,
      activeRun: t.active ? "demo-run-" + t.round : "",
      stopConfirmed: t.stopConfirmed,
      stopRequestedAt: t.stopUnconfirmed
        ? new Date(Date.now() - 65000).toISOString()
        : t.stopReason
          ? now()
          : null,
      approvalHead: t.humanReview?.commit || "",
      synthetic: r.synthetic,
      version: r.apiVersion,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      question: t.question,
      discussions: t.comments.map((c) => ({
        id: c.id,
        notes: [
          {
            id: c.id,
            author: { name: c.author },
            body: c.text,
            system: false,
            position: {
              new_path: c.file,
              new_line: c.line,
              head_sha: c.commit,
            },
          },
        ],
      })),
    };
  }
  function details(r) {
    const a = access(r.projectId),
      t = r.state;
    return {
      task: task(r),
      permissions: {
        ...a,
        manage: a.manage || (a.write && t.owner === user().name),
        review: a.read && t.reviewers.includes(user().name),
      },
      runs: r.runs,
      feedback: t.pending.map((p) => ({
        id: p.id,
        status: p.stale ? "NeedsReconfirmation" : "Queued",
        requirements: p.text,
        head: p.commit,
      })),
      events: r.events,
      gitlabTarget: task(r).mrIid ? "mergeRequest" : "project",
      gitlabUrl:
        "#task/" +
        (r.tenant_id || "demo-tenant") +
        "/" +
        r.projectId +
        "/" +
        t.id,
    };
  }
  function apply(r, action) {
    const a = {
      name: user().name,
      admin: level(r.projectId) >= 40,
      write: level(r.projectId) >= 30,
    };
    const before = r.state,
      answer = TaskFlow.reduce(before, action, a);
    if (!answer.ok) throw Error(answer.message);
    r.state = answer.state;
    r.apiVersion++;
    r.updatedAt = now();
    r.events.unshift({
      type: action.type,
      actor_id: user().id,
      created_at: now(),
      detail: { text: answer.message, head: r.state.head },
    });
    if (action.type === "start") {
      r.runs.unshift({
        id: "run-" + r.state.id + "-" + r.state.round,
        status: "Running",
        created_at: now(),
        requirements: r.state.feedback || r.state.criteria,
        config_snapshot: structuredClone(db.settings[r.projectId]),
        output: {},
      });
    }
    if (
      ["verify-pass", "verify-fail", "fail", "stop-confirm"].includes(
        action.type,
      ) &&
      r.runs[0]
    ) {
      const x = r.runs[0];
      x.status =
        action.type === "verify-pass"
          ? "Passed"
          : action.type === "stop-confirm"
            ? "Stopped"
            : "Failed";
      x.output = {
        summary: answer.message,
        checksCommit: r.state.head,
        stopConfirmed: r.state.stopConfirmed,
        patch:
          "diff --git a/internal/params.go b/internal/params.go\n+ // 模拟修改：边界校验与回归用例",
        checks: [
          {
            attempt: r.state.repairs || 1,
            passed: action.type === "verify-pass",
            log: answer.message,
          },
        ],
        judgment: {
          status: action.type === "verify-pass" ? "Met" : "Unmet",
          summary: r.state.agentJudgment,
        },
      };
    }
    save();
    return details(r);
  }
  function settings(pid) {
    return {
      settings: db.settings[pid] || {
        version: 0,
        baseBranch: "",
        agentID: "",
        agentVersion: 0,
        model: "",
        allowedPaths: [],
        checks: [],
        repairLimit: 3,
        timeoutMinutes: 30,
      },
      branches: [
        { name: "main" },
        { name: "develop" },
        { name: "pilot/injected-storagepath" },
      ],
      executors: [{ worker_id: "原型模拟执行器", last_seen: now() }],
      permissions: projectPermissions(pid),
      agents: access(pid).manage
        ? [
            {
              id: "demo-coding-agent",
              name: "Coding Agent（演示）",
              publishedVersion: 1,
            },
          ]
        : [],
    };
  }
  function snapshot(id) {
    const t = tenant(id),
      admin = tenantAdmin(id);
    if (
      !t ||
      !db.members.some(
        (m) =>
          m.tenant_id === id &&
          m.user_id === user().id &&
          m.status === "active",
      ) ||
      (!admin && t.status !== "active")
    )
      throw Error("租户不存在或无访问权限。");
    const active = t.status === "active",
      belongs = (x) => x.tenant_id === id;
    return {
      tenant: t,
      permissions: {
        viewSettings: admin,
        manageMembers: admin && active,
        manageProjects: admin && active,
        viewAudit: admin,
        viewSync: admin,
      },
      members: db.members.filter(
        (m) => belongs(m) && (admin || m.user_id === user().id),
      ),
      teams: admin
        ? db.teams.filter(belongs).map((t) => ({
            ...t,
            member_count: db.members.filter(
              (m) =>
                m.status === "active" && m.teams?.some((x) => x.id === t.id),
            ).length,
          }))
        : [],
      projects: db.projects
        .filter((p) => belongs(p) && projectPermissions(p.id).viewProject)
        .map((p) => ({ ...p, permissions: projectPermissions(p.id) })),
      grants: db.grants
        .filter(
          (g) =>
            belongs(g) &&
            (admin ||
              access(g.project_id).manage ||
              db.members.find((m) => m.id === g.membership_id)?.user_id ===
                user().id),
        )
        .map((g) => ({
          ...g,
          direct_role: roleName(g.direct_level || 0),
          sources: grantSources(g.project_id, g.membership_id),
          desired_role: roleName(g.desired_level),
          observed_role: roleName(g.observed_level),
          effective_role: roleName(
            active
              ? Math.min(g.desired_level, g.observed_level, g.effective_level)
              : 0,
          ),
        })),
      operations: admin ? db.operations.filter(belongs) : [],
      audit: admin ? db.audit.filter(belongs) : [],
    };
  }

  function grantSources(pid, mid) {
    const direct =
      db.grants.find((g) => g.project_id === pid && g.membership_id === mid)
        ?.direct_level || 0;
    const m = db.members.find((m) => m.id === mid);
    const sources = direct
      ? [{ kind: "direct", id: mid, name: "直接分配", role: roleName(direct) }]
      : [];
    for (const g of db.teamGrants.filter(
      (g) => g.project_id === pid && m?.teams?.some((t) => t.id === g.team_id),
    )) {
      const t = db.teams.find((t) => t.id === g.team_id);
      sources.push({
        kind: "team",
        id: t.id,
        name: t.name,
        role: roleName(g.level),
      });
    }
    return sources;
  }
  const roleLevel = (role) =>
    ({ reviewer: 20, developer: 30, admin: 40 })[role] || 0;
  function recomputeGrants(tid) {
    for (const p of db.projects.filter((p) => p.tenant_id === tid))
      for (const m of db.members.filter((m) => m.tenant_id === tid)) {
        const sources = grantSources(p.id, m.id),
          desired =
            m.status === "active"
              ? Math.max(0, ...sources.map((s) => roleLevel(s.role)))
              : 0;
        let g = db.grants.find(
          (g) => g.project_id === p.id && g.membership_id === m.id,
        );
        if (!g && desired) {
          g = {
            tenant_id: tid,
            project_id: p.id,
            membership_id: m.id,
            name: m.name,
            member_status: m.status,
            direct_level: 0,
          };
          db.grants.push(g);
        }
        if (g)
          Object.assign(g, {
            desired_level: desired,
            observed_level: desired,
            effective_level: desired,
            checked_at: now(),
          });
      }
  }
  function permissionReport(tid, mid) {
    const m = db.members.find(
      (m) =>
        m.tenant_id === tid &&
        (mid ? m.id === mid : m.user_id === user().id) &&
        m.status !== "removed",
    );
    if (!m || (!tenantAdmin(tid) && m.user_id !== user().id))
      throw Error("不能查看此成员权限。");
    const admin = m.role === "admin" && m.status === "active",
      active = tenant(tid).status === "active" && m.status === "active";
    return {
      member: {
        ...m,
        user_status: "active",
        tenant_status: tenant(tid).status,
        operator: !!users.find((u) => u.id === m.user_id)?.operator,
      },
      teams: m.teams || [],
      tenantPermissions: {
        manageMembers: admin && active,
        manageProjects: admin && active,
        viewSettings: admin,
        viewAudit: admin,
        viewSync: admin,
      },
      projects: db.projects
        .filter(
          (p) =>
            p.tenant_id === tid &&
            (admin ||
              db.grants.some(
                (g) => g.project_id === p.id && g.membership_id === m.id,
              )),
        )
        .map((p) => {
          const g = db.grants.find(
              (g) => g.project_id === p.id && g.membership_id === m.id,
            ),
            n = level(p.id, m.user_id);
          return {
            id: p.id,
            name: p.name,
            desiredRole: roleName(g?.desired_level || 0),
            effectiveRole: roleName(n),
            reason: !active
              ? "租户或成员未激活"
              : n
                ? "已生效"
                : "未分配项目代码角色",
            sources: grantSources(p.id, m.id),
            permissions: {
              viewProject: admin || n >= 20,
              readCode: n >= 20,
              createTask: n >= 30,
              manageMembers: active && (admin || n >= 40),
              configureExecution: n >= 40,
            },
          };
        }),
    };
  }
  const connections = () => ({
    gitlab: {
      status: "available",
      version: "19.4.1",
      url: "原型中的私有 GitLab",
    },
    model: {
      status: "available",
      models: ["qwen3.8:27b-mlx", "deepseek-coder"],
    },
    identity: { status: "available", organization: "星河科技" },
  });
  async function request(path, options = {}) {
    const method = options.method || "GET",
      b = options.body ? JSON.parse(options.body) : {},
      parts = path.split("/").filter(Boolean);
    let result;
    if (path === "/api/v1/roles") return { items: roleDefinitions };
    if (path === "/api/v1/me")
      return {
        user: user(),
        csrf_token: "explicit-demo-token",
        permissions: { managePlatform: user().operator },
      };
    if (path.startsWith("/api/v1/platform/")) {
      if (!user().operator) throw Error("需要平台管理权限。");
      if (path === "/api/v1/platform/connections") return connections();
      if (path === "/api/v1/platform/users") return { items: users };
      if (path === "/api/v1/platform/tenants" && method === "GET")
        return { items: db.tenants };
      if (parts[3] === "tenants" && parts[4] && method === "PATCH") {
        const t = tenant(parts[4]);
        if (!t) throw Error("租户不存在");
        t.status = b.status;
        if (b.status === "suspended")
          db.tasks
            .filter((r) => r.tenant_id === t.id)
            .forEach((r) => apply(r, { type: "revoke" }));
        t.version++;
        save();
        return { tenant_id: t.id };
      }
    }
    if (path === "/api/v1/tenants" && method === "GET")
      return {
        items: db.tenants.filter((t) =>
          db.members.some(
            (m) =>
              m.tenant_id === t.id &&
              m.user_id === user().id &&
              m.status === "active",
          ),
        ),
      };
    if (path === "/api/v1/platform/tenants" && method === "POST") {
      if (!user().operator) throw Error("需要平台运营权限。");
      const admin = users.find((u) => u.id === b.admin_user_id);
      if (!admin) throw Error("请选择首位租户管理员。");
      const id = "t-" + crypto.randomUUID();
      db.tenants.push({
        id,
        name: b.name,
        slug: b.slug,
        status: "active",
        version: 1,
        sync_status: "succeeded",
        member_count: 1,
        project_count: 0,
      });
      db.members.push({
        id: "m-" + crypto.randomUUID(),
        tenant_id: id,
        user_id: admin.id,
        name: admin.name,
        email: admin.email,
        role: "admin",
        status: "active",
        gitlab_id: 1,
        teams: [],
      });
      save();
      return { tenant_id: id, message: "原型企业已创建" };
    }
    if (parts[2] !== "tenants") throw Error("原型暂未提供此操作。");
    const tid = parts[3];
    const tenantSnapshot = snapshot(tid);
    if (parts.length === 4 && method === "GET") return tenantSnapshot;
    if (parts[4] === "permissions" && parts[5] === "me")
      return permissionReport(tid);
    if (parts[4] === "members" && parts[6] === "permissions")
      return permissionReport(tid, parts[5]);
    if (parts[4] === "teams" && parts[6] === "members") {
      if (!tenantSnapshot.permissions.manageMembers)
        throw Error("需要租户管理权限。");
      const t = db.teams.find((t) => t.tenant_id === tid && t.id === parts[5]),
        m = db.members.find(
          (m) =>
            m.tenant_id === tid && m.id === parts[7] && m.status === "active",
        );
      if (!t || !m) throw Error("团队或已激活成员不存在。");
      m.teams = m.teams.filter((x) => x.id !== t.id);
      if (method !== "DELETE") m.teams.push({ id: t.id, name: t.name });
      recomputeGrants(tid);
      tenant(tid).version++;
      save();
      return { team_id: t.id };
    }
    if (parts[4] === "projects" && parts[5]) {
      const pid = parts[5],
        a = access(pid);
      if (
        !a.read &&
        !["grants", "grant-candidates", "team-grants"].includes(parts[6])
      )
        throw Error("没有项目访问权限。");
      if (parts[6] === "team-grants") {
        if (!projectPermissions(pid).manageMembers)
          throw Error("需要项目成员管理权限。");
        if (method === "GET")
          return {
            items: db.teams
              .filter((t) => t.tenant_id === tid)
              .map((t) => ({
                ...t,
                role: roleName(
                  db.teamGrants.find(
                    (g) => g.project_id === pid && g.team_id === t.id,
                  )?.level || 0,
                ),
                member_count: db.members.filter(
                  (m) =>
                    m.status === "active" &&
                    m.teams?.some((x) => x.id === t.id),
                ).length,
              })),
          };
        const t = db.teams.find(
          (t) => t.tenant_id === tid && t.id === parts[7],
        );
        if (!t) throw Error("团队不存在。");
        db.teamGrants = db.teamGrants.filter(
          (g) => !(g.project_id === pid && g.team_id === t.id),
        );
        if (method !== "DELETE")
          db.teamGrants.push({
            tenant_id: tid,
            project_id: pid,
            team_id: t.id,
            level: roleLevel(b.role),
          });
        recomputeGrants(tid);
        tenant(tid).version++;
        save();
        return { team_id: t.id };
      }
      if (parts[6] === "access") return a;
      if (parts[6] === "people")
        return {
          items: db.members
            .filter(
              (m) =>
                m.tenant_id === tid &&
                m.status === "active" &&
                level(pid, m.user_id) >= 20,
            )
            .map((m) => ({
              id: m.user_id,
              name: m.name,
              canReview: true,
              canOwn: level(pid, m.user_id) >= 30,
            })),
        };
      if (parts[6] === "coding-settings") {
        if (method === "GET") return settings(pid);
        if (!a.manage) throw Error("需要项目管理员权限。");
        if (parts[7] === "check") {
          if (!db.settings[pid]?.agentID) throw Error("请先填写执行配置。");
          db.settings[pid].checkedAt = now();
          result = { message: "原型接入检查通过" };
        } else {
          if (b.version !== settings(pid).settings.version)
            throw Error("配置已更新，请刷新。");
          if (
            !b.agentID ||
            b.agentVersion !== 1 ||
            !b.allowedPaths.length ||
            !b.checks.length ||
            b.repairLimit < 1 ||
            b.repairLimit > 3 ||
            b.timeoutMinutes < 1 ||
            b.timeoutMinutes > 30
          )
            throw Error("请填写修改范围、检查命令及有效执行上限。");
          db.settings[pid] = {
            ...b,
            model: "qwen3.8:27b-mlx",
            version: b.version + 1,
            checkedAt: null,
          };
          db.tasks
            .filter((r) => r.projectId === pid)
            .forEach((r) =>
              apply(r, {
                type: "config",
                version: b.version + 1,
                ready: false,
              }),
            );
          result = { message: "配置已保存，请重新检查接入" };
        }
      } else if (parts[6] === "tasks") {
        if (parts.length === 7 && method === "GET")
          return {
            items: db.tasks.filter((r) => r.projectId === pid).map(task),
          };
        if (parts[7] === "new") {
          if (!a.write) throw Error("需要项目写权限。");
          if (!db.settings[pid].checkedAt) throw Error("请先检查项目配置。");
          const old = db.tasks.find(
            (r) => r.requestKey === options.headers?.["Idempotency-Key"],
          );
          if (old) return task(old);
          const id = String(142 + db.tasks.length),
            state = TaskFlow.create({
              id,
              title: b.title,
              owner: user().name,
              creator: user().name,
              reviewers: b.reviewerIds.map(
                (uid) => users.find((u) => u.id === uid)?.name || uid,
              ),
              base: b.baseBranch,
              description: b.description,
              reproduce: b.reproduce,
              criteria: b.criteria,
              constraint: b.constraints,
              reference: b.reference,
              branch: "agent/fix-" + id,
              head: "demo-base-" + id,
              configVersion: db.settings[pid].version,
            });
          const r = {
            state,
            projectId: pid,
            tenant_id: tid,
            apiVersion: 1,
            synthetic: !!b.synthetic,
            createdAt: now(),
            updatedAt: now(),
            runs: [],
            events: [
              {
                type: "TaskCreated",
                actor_id: user().id,
                created_at: now(),
                detail: { text: "任务已创建并进入执行队列" },
              },
            ],
            requestKey: options.headers?.["Idempotency-Key"],
          };
          db.tasks.unshift(r);
          result = task(r);
        } else {
          const r = db.tasks.find(
            (r) => r.state.id === parts[7] && r.projectId === pid,
          );
          if (!r) throw Error("任务不存在。");
          if (
            method === "GET" &&
            parts[8] === "runs" &&
            parts[10]?.startsWith("trace")
          )
            return { run: null, events: [], nextSeq: 0, hasMore: false };
          if (method === "GET" && parts[8] === "diff") {
            const t = task(r);
            return {
              mrIid: t.mrIid,
              base: "demo-base",
              head: t.head,
              start: "demo-base",
              sourceBranch: t.branch,
              targetBranch: t.targetBranch,
              patch: t.mrIid
                ? 'diff --git a/internal/params.go b/internal/params.go\n--- a/internal/params.go\n+++ b/internal/params.go\n@@ -0,0 +1,2 @@\n+// 演示 MR 的完整差异\n+if input == "" { return ErrInvalidInput }\n'
                : "",
            };
          }
          if (method === "GET") return details(r);
          if (parts[8] === "sync") return details(r);
          if (b.version !== r.apiVersion)
            throw Error("任务已变化，请刷新后再操作。");
          const map = {
            Intervene: "intervene",
            Resume: "resume",
            Feedback: "feedback",
            Approve: "approve",
            Transfer: "transfer",
            Cancel: "cancel",
            Continue: "continue",
            ReconfirmFeedback: "reconfirm-feedback",
            NextFeedback: "next-batch",
            Answer: "answer",
          };
          if (b.action === "Transfer" && level(pid, b.ownerId) < 30)
            throw Error("新负责人需要项目写权限。");
          if (["Resume", "Continue", "NextFeedback"].includes(b.action)) {
            r.state.configReady = !!db.settings[pid].checkedAt;
            r.state.configVersion = db.settings[pid].version;
          }
          result = apply(r, {
            type: map[b.action],
            commit: b.head,
            text: b.text,
            owner: users.find((u) => u.id === b.ownerId)?.name,
          });
        }
      } else if (parts[6] === "grant-candidates") {
        if (!projectPermissions(pid).manageMembers)
          throw Error("需要项目成员管理权限。");
        return {
          items: db.members.filter(
            (m) => m.tenant_id === tid && m.status === "active",
          ),
        };
      } else if (parts[6] === "grants") {
        if (!snapshot(tid).permissions.manageMembers && !a.manage)
          throw Error("需要项目或企业管理员权限。");
        const mid = parts[7],
          v =
            method === "DELETE"
              ? 0
              : { admin: 40, developer: 30, reviewer: 20 }[b.role];
        let g = db.grants.find(
          (g) => g.project_id === pid && g.membership_id === mid,
        );
        if (!g) {
          g = {
            tenant_id: tid,
            project_id: pid,
            membership_id: mid,
            name: db.members.find((m) => m.id === mid)?.name,
            member_status: "active",
          };
          db.grants.push(g);
        }
        g.direct_level = v;
        recomputeGrants(tid);
        result = { message: "原型项目授权已更新" };
      }
    } else {
      if (!snapshot(tid).permissions.manageMembers)
        throw Error("需要企业管理员权限。");
      if (parts[4] === "teams") {
        db.teams.push({
          tenant_id: tid,
          id: "team-" + crypto.randomUUID(),
          name: b.name,
        });
        result = { message: "团队已创建" };
      } else if (parts[4] === "members") {
        let m = db.members.find((m) => m.id === parts[5]);
        if (method === "POST" && !m) {
          m = {
            tenant_id: tid,
            id: "m-" + crypto.randomUUID(),
            user_id: "u-" + crypto.randomUUID(),
            name: b.name,
            email: b.email,
            role: b.role,
            status: "invited",
            gitlab_id: null,
            teams: [],
          };
          db.members.push(m);
          result = {
            invitation_url: "https://prototype.invalid/invitation/" + m.id,
            invitation_id: m.id,
          };
        } else if (method === "DELETE") {
          m.status = "removed";
          m.teams = [];
          db.grants
            .filter((g) => g.membership_id === m.id)
            .forEach((g) => {
              g.direct_level = 0;
              g.desired_level = 0;
              g.effective_level = 0;
              g.observed_level = 0;
            });
          result = { message: "成员已移除" };
        } else if (method === "PATCH") {
          Object.assign(m, b);

          result = { message: "成员设置已更新" };
        } else
          result = {
            invitation_url: "https://prototype.invalid/invitation/" + m.id,
            invitation_id: m.id,
          };
      } else if (parts[4] === "projects" && method === "POST") {
        const pid = "p-" + crypto.randomUUID();
        db.projects.push({
          tenant_id: tid,
          id: pid,
          name: b.name,
          path: tenant(tid).slug + "/" + b.path,
          gitlab_id: db.projects.length + 1,
        });
        db.grants.push({
          tenant_id: tid,
          project_id: pid,
          membership_id: db.members.find(
            (m) =>
              m.tenant_id === tid &&
              m.user_id === user().id &&
              m.status === "active",
          ).id,
          name: user().name,
          member_status: "active",
          direct_level: 40,
          desired_level: 40,
          observed_level: 40,
          effective_level: 40,
          checked_at: now(),
        });
        db.settings[pid] = {
          version: 0,
          baseBranch: "",
          agentID: "",
          agentVersion: 0,
          model: "",
          allowedPaths: [],
          checks: [],
          repairLimit: 3,
          timeoutMinutes: 30,
        };
        result = { message: "原型项目已接入，请配置执行规则" };
      } else if (parts[4] === "operations")
        result = { message: "原型同步已完成" };
    }
    if (!result) throw Error("原型暂未提供此操作。");
    db.tenants.forEach((t) => {
      t.member_count = db.members.filter(
        (m) => m.tenant_id === t.id && m.status !== "removed",
      ).length;
      t.project_count = db.projects.filter((p) => p.tenant_id === t.id).length;
      t.version++;
    });
    db.audit.unshift({
      tenant_id: tid,
      created_at: now(),
      actor_id: user().id,
      action: "prototype_change",
      detail: { method, path },
      target: tid,
    });
    save();
    return result;
  }
  const transport = {
    users,
    user,
    request,
    acceptInvitation: (id) => {
      const m = db.members.find((m) => m.id === id);
      m.status = "active";
      m.gitlab_id = 100 + db.members.length;
      save();
    },
    setUser: (id) => {
      db.userId = id;
      save();
    },
    reset: () => {
      db = seed();
      save();
    },
    simulate: async (id, type) => {
      const r = db.tasks.find((r) => r.state.id === id);
      if (!r) throw Error("任务不存在。");
      r.state.configReady = !!db.settings[r.projectId].checkedAt;
      r.state.configVersion = db.settings[r.projectId].version;
      return apply(r, { type });
    },
  };
  save();
  return transport;
}
