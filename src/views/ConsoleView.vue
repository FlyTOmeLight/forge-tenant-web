<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { api, mutate, message, setCSRF } from "../api";
import type {
  User,
  Tenant,
  Snapshot,
  Project,
  Grant,
  Field,
  Mutation,
  Member,
} from "../types";
import StatusBadge from "../components/StatusBadge.vue";
import FormDialog from "../components/FormDialog.vue";
import CodingWorkspace from "./CodingWorkspace.vue";
import { demo } from "../prototype";
const navs = [
  ["tasks", "任务工作台"],
  ["reviews", "待我审查"],
  ["spaces", "项目空间"],
  ["connections", "服务连接"],
  ["tenants", "企业管理"],
  ["members", "成员与团队"],
  ["projects", "项目与权限"],
  ["sync", "接入与同步"],
  ["audit", "审计记录"],
];
const roleNames: Record<number, string> = {
  0: "无权限",
  20: "审查者",
  30: "开发者",
  40: "项目管理员",
};
const remoteNames: Record<number, string> = {
  0: "无权限",
  20: "Reporter · 20",
  30: "Developer · 30",
  40: "Maintainer · 40",
};
const companyRoles = [
  { value: "member", label: "普通成员" },
  { value: "admin", label: "企业管理员" },
];
const projectRoles = [
  { value: "developer", label: "开发者 · Developer" },
  { value: "reviewer", label: "审查者 · Reporter" },
  { value: "admin", label: "项目管理员 · Maintainer" },
];
const user = ref<User>(),
  tenants = ref<Tenant[]>([]),
  data = ref<Snapshot>(),
  current = ref(sessionStorage.getItem("forge-tenant") || "");
const defaultView =
  demo || location.pathname === "/tasks" ? "tasks" : "tenants";
const view = ref(location.hash.slice(1) || defaultView),
  query = ref(""),
  tab = ref("members"),
  loading = ref(false),
  sidebar = ref(false);
const status = ref("正在读取企业数据…"),
  toast = ref("");
let poll: ReturnType<typeof setInterval>,
  toastTimer: ReturnType<typeof setTimeout>;
const refreshVersion = ref(0);
function refreshAll() {
  refreshVersion.value++;
  void refresh();
}
const manage = computed(() => !!data.value?.can_manage);
const tenant = computed(() => data.value?.tenant);
const members = computed(() => data.value?.members || []),
  projects = computed(() => data.value?.projects || []),
  grants = computed(() => data.value?.grants || []);
const operations = computed(() => data.value?.operations || []);
const coding = computed(() =>
  ["tasks", "reviews", "spaces", "connections", "task", "project"].includes(
    view.value.split("/")[0]!,
  ),
);
const heading = computed(
  () =>
    navs.find((n) => n[0] === view.value)?.[1] ||
    (view.value.startsWith("task/")
      ? "任务详情"
      : view.value.startsWith("project/")
        ? "项目执行配置"
        : "企业管理"),
);
const matches = (...values: unknown[]) =>
  values.join(" ").toLowerCase().includes(query.value.toLowerCase());
const filteredTenants = computed(() =>
  tenants.value.filter((t) => matches(t.name, t.slug)),
);
const filteredMembers = computed(() =>
  members.value.filter((m) => matches(m.name, m.email, m.team_name)),
);
const filteredProjects = computed(() =>
  projects.value.filter((p) => matches(p.name, p.path)),
);
const filteredAudit = computed(() =>
  (data.value?.audit || []).filter((a) =>
    matches(a.action, a.target, JSON.stringify(a.detail)),
  ),
);
const date = (value: string) => new Date(value).toLocaleString("zh-CN");
function notify(value: string) {
  toast.value = value;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ""), 5000);
}
async function refresh() {
  if (loading.value) return;
  loading.value = true;
  try {
    tenants.value = (await api<{ items: Tenant[] }>("/api/v1/tenants")).items;
    if (!tenants.value.some((t) => t.id === current.value))
      current.value = tenants.value[0]?.id || "";
    data.value = current.value
      ? await api<Snapshot>("/api/v1/tenants/" + current.value)
      : undefined;
    sessionStorage.setItem("forge-tenant", current.value);
    status.value = "最近刷新 " + new Date().toLocaleTimeString("zh-CN");
  } catch (e) {
    status.value = message(e);
    notify(message(e));
  } finally {
    loading.value = false;
  }
}
function navigate(value: string) {
  view.value = value;
  query.value = "";
  location.hash = value;
  sidebar.value = false;
}
async function enter(id: string) {
  current.value = id;
  navigate("members");
  await refresh();
}
function hashChanged() {
  const next = location.hash.slice(1);
  view.value =
    navs.some((n) => n[0] === next) || /^(task|project)\//.test(next)
      ? next
      : defaultView;
  query.value = "";
}
watch(heading, (v) => (document.title = "Forge · " + v));
function localLevel(g: Grant) {
  return tenant.value?.status === "active" && g.member_status === "active"
    ? Math.min(g.desired_level, g.observed_level, g.effective_level)
    : 0;
}
function projectManage(p: Project) {
  const self = members.value.find((m) => m.user_id === user.value?.id);
  return (
    manage.value ||
    grants.value.some(
      (g) =>
        g.project_id === p.id &&
        g.membership_id === self?.id &&
        localLevel(g) >= 40,
    )
  );
}
const projectGrants = (id: string) =>
  grants.value.filter((g) => g.project_id === id);
function projectStatus(p: Project) {
  if (!p.gitlab_id) return "等待项目接入";
  return projectGrants(p.id).some(
    (g) =>
      g.observed_level !==
      (tenant.value?.status === "active" && g.member_status === "active"
        ? g.desired_level
        : 0),
  )
    ? "权限待确认"
    : "最近核验一致";
}
interface Dialog {
  key: number;
  title: string;
  text?: string;
  fields?: Field[];
  submitLabel?: string;
  submit?: (values: Record<string, string>) => Promise<void>;
  wide?: boolean;
  invitation?: string;
  project?: Project;
  connection?: Record<string, unknown>;
}
const dialog = shallowRef<Dialog>();
let dialogKey = 0;
function show(config: Omit<Dialog, "key">) {
  dialog.value = { ...config, key: ++dialogKey };
}
function edit(
  title: string,
  text: string,
  fields: Field[],
  submitLabel: string,
  execute: (values: Record<string, string>) => Promise<Mutation>,
  extra: Partial<Dialog> = {},
) {
  show({
    title,
    text,
    fields,
    submitLabel,
    ...extra,
    submit: async (values) => {
      const result = await execute(values);
      dialog.value = undefined;
      await refresh();
      if (result.invitation_url)
        show({
          title: "邀请已创建",
          text: "请将此链接交给受邀者，24 小时内有效且只能使用一次。重新邀请会使旧链接失效。",
          invitation: result.invitation_url,
        });
      else notify("已保存，正在同步目标状态");
    },
  });
}
function change(
  tail: string,
  method: string,
  body: unknown,
  tid: string,
  version: number,
) {
  return mutate<Mutation>(
    `/api/v1/tenants/${tid}${tail}`,
    method,
    body,
    version,
  );
}
function action(kind: string, id = "") {
  const tid = current.value,
    version = tenant.value?.version || 0;
  const update = (tail: string, method: string, body: unknown = {}) =>
    change(tail, method, body, tid, version);
  if (kind === "create-tenant")
    edit(
      "创建企业",
      "你将成为首位管理员。代码访问需单独授予。",
      [
        { name: "name", label: "企业名称" },
        {
          name: "slug",
          label: "企业标识",
          help: "2–40 位小写字母、数字或连字符；创建后不可修改。",
        },
      ],
      "创建企业",
      async (values) => {
        const result = await mutate<Mutation>(
          "/api/v1/tenants",
          "POST",
          values,
        );
        current.value = result.tenant_id!;
        navigate("members");
        return result;
      },
    );
  if (kind === "tenant-state") {
    const t = tenants.value.find((t) => t.id === id)!;
    const active = t.status === "active";
    edit(
      (active ? "停用" : "启用") + " " + t.name,
      active
        ? "立即撤销平台访问资格，并同步撤销企业内受管 GitLab 项目授权。保留统一账号和其他企业关系。"
        : "重新同步目标授权，不自动恢复 Agent 任务。",
      [],
      active ? "确认停用" : "确认启用",
      () =>
        change(
          "",
          "PATCH",
          { status: active ? "suspended" : "active" },
          t.id,
          t.version,
        ),
    );
  }
  if (kind === "invite")
    edit(
      "邀请企业成员",
      "同一邮箱复用统一账号；邀请通过一次性链接交付。",
      [
        { name: "name", label: "姓名" },
        { name: "email", label: "企业邮箱", type: "email" },
        { name: "role", label: "企业角色", options: companyRoles },
      ],
      "创建邀请",
      (values) => update("/members", "POST", values),
    );
  if (kind === "resend")
    edit(
      "重新邀请成员？",
      "创建新的 24 小时邀请链接，原邀请立即失效。",
      [],
      "重新邀请",
      () => update(`/members/${id}/invitation`, "POST"),
    );
  if (kind === "edit-member") {
    const m = members.value.find((m) => m.id === id)!;
    edit(
      m.name + " · 成员设置",
      "",
      [
        {
          name: "role",
          label: "企业角色",
          value: m.role,
          options: companyRoles,
        },
        {
          name: "team_id",
          label: "所属团队",
          value: m.team_id || "",
          required: false,
          options: [
            { value: "", label: "未分配" },
            ...(data.value?.teams || []).map((t) => ({
              value: t.id,
              label: t.name,
            })),
          ],
        },
      ],
      "保存成员设置",
      (values) => update(`/members/${id}`, "PATCH", values),
    );
  }
  if (kind === "remove-member")
    edit(
      "移除 " + members.value.find((m) => m.id === id)?.name + "？",
      "立即撤销当前企业的平台访问资格，再同步清理 GitLab 项目授权。保留统一账号和其他企业关系。",
      [],
      "确认移除",
      () => update(`/members/${id}`, "DELETE"),
    );
  if (kind === "create-team")
    edit(
      "创建团队",
      "仅管理组织归属，不自动授予项目权限。",
      [{ name: "name", label: "团队名称" }],
      "创建团队",
      (values) => update("/teams", "POST", values),
    );
  if (kind === "add-project")
    edit(
      "接入 GitLab 项目",
      "绑定时会检查所属 Group、私有可见性和共享情况。",
      [
        {
          name: "mode",
          label: "接入方式",
          options: [
            { value: "create", label: "创建新的私有项目" },
            { value: "bind", label: "绑定已有私有项目" },
          ],
        },
        { name: "name", label: "项目名称" },
        {
          name: "path",
          label: "项目路径后缀",
          help: `项目必须位于 ${tenant.value?.slug}/ 下。`,
        },
      ],
      "接入项目",
      (values) => update("/projects", "POST", values),
    );
  if (kind === "revoke") {
    const [pid, mid] = id.split(":");
    edit(
      "撤销项目权限？",
      "立即限制平台访问，GitLab 有效权限核验结果单独记录。",
      [],
      "确认撤销",
      () => update(`/projects/${pid}/grants/${mid}`, "DELETE"),
    );
  }
  if (kind === "retry")
    edit(
      "重试当前目标？",
      "请先修复凭证、资源归属或继承权限冲突。",
      [],
      "提交重试",
      () => update(`/operations/${id}/retry`, "POST"),
    );
}
async function permissions(p: Project) {
  const tid = current.value,
    version = tenant.value!.version,
    editable = projectManage(p);
  try {
    const candidates = editable
      ? (
          await api<{ items: Member[] }>(
            `/api/v1/tenants/${tid}/projects/${p.id}/grant-candidates`,
          )
        ).items
      : [];
    const fields: Field[] = editable
      ? [
          {
            name: "member",
            label: "企业成员",
            options: [
              { value: "", label: "请选择已接受邀请的成员" },
              ...candidates.map((m) => ({
                value: m.id,
                label: m.name + " · " + m.email,
              })),
            ],
          },
          { name: "role", label: "项目角色", options: projectRoles },
        ]
      : [];
    if (editable)
      edit(
        p.name + " · 项目权限",
        "新增权限等待 GitLab 确认。降级或撤销先限制平台能力。",
        fields,
        "保存项目授权",
        (values) =>
          change(
            `/projects/${p.id}/grants/${values.member}`,
            "PUT",
            { role: values.role },
            tid,
            version,
          ),
        { wide: true, project: p },
      );
    else show({ title: p.name + " · 项目权限", wide: true, project: p });
  } catch (e) {
    notify(message(e));
  }
}
async function connection() {
  try {
    show({
      title: "GitLab 接入检查",
      connection: await api<Record<string, unknown>>("/api/v1/connection"),
    });
  } catch (e) {
    notify(message(e));
  }
}
async function copyInvitation() {
  try {
    await navigator.clipboard.writeText(dialog.value!.invitation!);
    notify("邀请链接已复制");
  } catch {
    document.querySelector<HTMLTextAreaElement>("#invite-link")?.select();
    notify("请复制已选中的邀请链接");
  }
}
async function logout() {
  if (demo) return;
  try {
    await api("/auth/logout", { method: "POST", body: "{}" });
    location.assign("/auth/login");
  } catch (e) {
    notify(message(e));
  }
}
onMounted(async () => {
  hashChanged();
  window.addEventListener("hashchange", hashChanged);
  try {
    const info = await api<{ user: User; csrf_token: string }>("/api/v1/me");
    user.value = info.user;
    setCSRF(info.csrf_token);
    await refresh();
  } catch (e) {
    status.value = message(e);
  }
  poll = setInterval(() => {
    if (
      user.value &&
      !document.hidden &&
      !dialog.value &&
      document.activeElement?.id !== "search"
    )
      void refresh();
  }, 5000);
});
onUnmounted(() => {
  clearInterval(poll);
  clearTimeout(toastTimer);
  window.removeEventListener("hashchange", hashChanged);
});
async function switchDemo(id: string) {
  demo?.setUser(id);
  const info = await api<{ user: User; csrf_token: string }>("/api/v1/me");
  user.value = info.user;
  await refresh();
}
async function acceptDemo(id: string) {
  demo?.acceptInvitation(id);
  await refresh();
}
async function resetDemo() {
  demo?.reset();
  current.value = "";
  navigate("tasks");
  await switchDemo(demo!.user().id);
}
const actionNames: Record<string, string> = {
  create_tenant: "创建企业",
  update_tenant: "变更企业状态",
  invite_member: "邀请成员",
  accept_invitation: "接受邀请",
  update_member: "修改成员",
  remove_member: "移除成员",
  resend_invitation: "重新邀请",
  create_team: "创建团队",
  add_project: "接入项目",
  set_grant: "设置项目授权",
  revoke_grant: "撤销项目授权",
  retry_sync: "重试同步",
  sync_succeeded: "同步完成",
};
</script>
<template>
  <a
    class="skip"
    href="#main"
    @click.prevent="($refs.main as HTMLElement)?.focus()"
    >跳到主要内容</a
  >
  <aside
    id="sidebar"
    class="sidebar"
    :class="{ open: sidebar }"
    aria-label="管理导航"
  >
    <div class="brand"><span class="mark" aria-hidden="true">F</span>Forge</div>
    <label class="switch-label" for="tenant-switch">当前企业</label
    ><select
      id="tenant-switch"
      v-model="current"
      class="tenant-switch"
      aria-label="当前企业"
      :disabled="!!dialog || loading"
      @change="
        query = '';
        refresh();
      "
    >
      <option v-if="!tenants.length" value="">尚无企业</option>
      <option v-for="t in tenants" :key="t.id" :value="t.id">
        {{ t.name }}
      </option>
    </select>
    <div class="nav-label">研发与组织</div>
    <nav id="nav">
      <button
        v-for="[id, label] in navs"
        :key="id"
        class="nav"
        :class="{ active: view === id }"
        :aria-current="view === id ? 'page' : undefined"
        @click="navigate(id!)"
      >
        {{ label
        }}<span
          v-if="
            id === 'sync' &&
            operations.some((o) => ['failed', 'conflict'].includes(o.status))
          "
          class="count"
          >!</span
        >
      </button>
    </nav>
    <div class="side-bottom">
      <div class="operator">
        <span id="avatar" class="avatar">{{
          user?.name.slice(0, 1) || "F"
        }}</span>
        <div>
          <span id="operator-name">{{ user?.name }}</span>
          <div id="operator-role" class="muted small-text">
            {{ user?.operator ? "平台运营管理员" : "企业账号" }}
          </div>
        </div>
      </div>
      <button v-if="!demo" id="logout" class="btn link" @click="logout">
        退出登录
      </button>
    </div>
  </aside>
  <div class="workspace">
    <header class="topbar">
      <div class="row">
        <button
          id="menu"
          class="mobile-menu"
          aria-label="展开导航"
          :aria-expanded="sidebar"
          aria-controls="sidebar"
          @click="sidebar = !sidebar"
        >
          ☰
        </button>
        <div class="breadcrumb">
          Forge 控制台 / <strong id="crumb">{{ heading }}</strong>
        </div>
      </div>
      <div class="top-links">
        <button
          id="refresh"
          class="btn small"
          :disabled="loading"
          @click="refreshAll"
        >
          刷新数据
        </button>
      </div>
    </header>
    <div v-if="demo" class="prototype-banner">
      <strong>交互原型 · 数据仅保存在本机，不连接 GitLab 或模型</strong
      ><label
        >体验角色
        <select
          :value="user?.id"
          @change="switchDemo(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="u in demo.users" :key="u.id" :value="u.id">
            {{ u.name }} · {{ u.roleLabel }}
          </option>
        </select></label
      ><button class="btn small" @click="resetDemo">重置演示</button>
    </div>
    <div id="status" class="status-banner" role="status">{{ status }}</div>
    <main
      id="main"
      ref="main"
      class="content"
      tabindex="-1"
      :aria-busy="loading"
    >
      <div v-if="!coding" class="heading">
        <div>
          <h1>{{ heading }}</h1>
          <p class="subtitle">
            {{
              view === "tenants"
                ? "统一管理企业空间、成员关系与项目权限。"
                : tenant?.name
            }}
          </p>
        </div>
        <button
          v-if="view === 'tenants' && user?.operator"
          class="btn primary"
          @click="action('create-tenant')"
        >
          创建企业</button
        ><button
          v-if="view === 'members' && manage"
          class="btn primary"
          @click="action('invite')"
        >
          邀请成员</button
        ><button
          v-if="view === 'projects' && manage"
          class="btn primary"
          @click="action('add-project')"
        >
          接入项目</button
        ><button
          v-if="view === 'sync' && user?.operator"
          class="btn"
          @click="connection"
        >
          检查接入
        </button>
      </div>
      <div
        v-if="view !== 'tenants' && tenant?.status === 'suspended'"
        class="notice danger"
      >
        企业已停用，平台访问资格已撤销；GitLab 撤权结果见同步记录。
      </div>
      <div v-if="view !== 'tenants' && !data" class="empty">
        <h3>尚未加入企业</h3>
        <p>请创建企业，或接受管理员发来的邀请。</p>
      </div>
      <CodingWorkspace
        v-else-if="coding && data && user"
        :key="current + user.id"
        :snapshot="data"
        :refresh-version="refreshVersion"
        :user="user"
        :view="view"
        @navigate="navigate"
        @add-project="action('add-project')"
      />
      <section v-else-if="view === 'tenants'" class="panel">
        <div class="toolbar">
          <input
            id="search"
            v-model="query"
            class="search"
            type="search"
            aria-label="搜索企业名称或标识"
            placeholder="搜索企业名称或标识"
          />
        </div>
        <div v-if="filteredTenants.length" class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>企业 / 标识</th>
                <th>成员 / 项目</th>
                <th>状态</th>
                <th>GitLab 同步</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in filteredTenants" :key="t.id">
                <td>
                  <span class="name">{{ t.name }}</span
                  ><span class="sub mono">{{ t.slug }}</span>
                </td>
                <td>
                  {{ t.member_count }} 位成员<span class="sub"
                    >{{ t.project_count }} 个项目</span
                  >
                </td>
                <td><StatusBadge :status="t.status" /></td>
                <td><StatusBadge :status="t.sync_status" /></td>
                <td>
                  <div class="cell-actions">
                    <button
                      class="btn link"
                      :disabled="loading"
                      @click="enter(t.id)"
                    >
                      进入企业</button
                    ><button
                      v-if="user?.operator"
                      class="btn small"
                      :class="{ danger: t.status === 'active' }"
                      @click="action('tenant-state', t.id)"
                    >
                      {{ t.status === "active" ? "停用" : "启用" }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="empty">
          <h3>还没有匹配的企业空间</h3>
          <p>创建企业并邀请成员，或调整搜索条件。</p>
        </div>
        <div class="footnote">
          统一账号可以加入多个企业。企业管理员默认不获得代码访问权。
        </div>
      </section>
      <template v-else-if="view === 'members'"
        ><div v-if="manage" class="tabs">
          <button
            class="tab"
            :class="{ active: tab === 'members' }"
            @click="tab = 'members'"
          >
            企业成员</button
          ><button
            class="tab"
            :class="{ active: tab === 'teams' }"
            @click="tab = 'teams'"
          >
            团队
          </button>
        </div>
        <section v-if="tab === 'teams' && manage" class="panel">
          <div class="panel-head">
            <h2>团队目录</h2>
            <button class="btn" @click="action('create-team')">创建团队</button>
          </div>
          <div v-if="data?.teams.length" class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>成员数</th>
                  <th>权限</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="team in data.teams" :key="team.id">
                  <td>{{ team.name }}</td>
                  <td>
                    {{ members.filter((m) => m.team_id === team.id).length }}
                  </td>
                  <td>仅组织归属，不隐含项目授权</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="empty">
            还没有团队。创建团队后，在成员设置中分配归属。
          </div>
        </section>
        <section v-else class="panel">
          <div class="toolbar">
            <input
              id="search"
              v-model="query"
              class="search"
              type="search"
              aria-label="搜索姓名、邮箱或团队"
              placeholder="搜索姓名、邮箱或团队"
            />
          </div>
          <div v-if="filteredMembers.length" class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>成员</th>
                  <th>企业角色</th>
                  <th>团队</th>
                  <th>身份状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="m in filteredMembers" :key="m.id">
                  <td>
                    <span class="name">{{ m.name }}</span
                    ><span class="sub">{{ m.email }}</span>
                  </td>
                  <td>
                    <span
                      class="badge"
                      :class="{ purple: m.role === 'admin' }"
                      >{{
                        m.role === "admin" ? "企业管理员" : "普通成员"
                      }}</span
                    >
                  </td>
                  <td>{{ m.team_name || "未分配" }}</td>
                  <td>
                    <span v-if="m.status === 'active'" class="badge good"
                      >已接受</span
                    ><StatusBadge v-else :status="m.status" /><span
                      class="sub"
                      >{{
                        m.gitlab_id ? "GitLab 身份已绑定" : "GitLab 身份待配置"
                      }}</span
                    >
                  </td>
                  <td>
                    <div v-if="manage" class="cell-actions">
                      <button
                        v-if="demo && m.status === 'invited'"
                        class="btn small"
                        @click="acceptDemo(m.id)"
                      >
                        模拟接受邀请
                      </button>
                      <button
                        v-if="m.status === 'invited'"
                        class="btn link"
                        @click="action('resend', m.id)"
                      >
                        重新邀请</button
                      ><button
                        class="btn small"
                        @click="action('edit-member', m.id)"
                      >
                        设置</button
                      ><button
                        class="btn link danger"
                        @click="action('remove-member', m.id)"
                      >
                        移除
                      </button>
                    </div>
                    <span v-else>—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="empty">
            没有匹配的成员。调整搜索条件，或邀请新的企业成员。
          </div>
          <div class="footnote">
            移除只撤销当前企业权限，保留统一账号与其他企业关系。邀请不自动发送邮件。
          </div>
        </section>
      </template>
      <section v-else-if="view === 'projects'" class="panel">
        <div class="toolbar">
          <input
            id="search"
            v-model="query"
            type="search"
            class="search"
            aria-label="搜索项目名称或路径"
            placeholder="搜索项目名称或路径"
          />
        </div>
        <div v-if="filteredProjects.length" class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>项目 / GitLab 路径</th>
                <th>目标授权</th>
                <th>同步情况</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in filteredProjects" :key="p.id">
                <td>
                  <span class="name">{{ p.name }}</span
                  ><span class="sub mono">{{ p.path }}</span>
                </td>
                <td>
                  {{
                    projectGrants(p.id).filter((g) => g.desired_level > 0)
                      .length
                  }}
                  位成员
                </td>
                <td>
                  <span
                    class="badge"
                    :class="
                      projectStatus(p) === '最近核验一致' ? 'good' : 'warn'
                    "
                    >{{ projectStatus(p) }}</span
                  >
                </td>
                <td>
                  <button class="btn link" @click="permissions(p)">
                    {{ projectManage(p) ? "管理权限" : "查看权限" }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="empty">
          <h3>还没有可访问的项目</h3>
          <p>
            {{
              manage
                ? "接入企业项目，再授予成员权限。"
                : "请联系企业或项目管理员授予项目权限。"
            }}
          </p>
        </div>
        <div class="footnote">
          项目管理员 → Maintainer；开发者 → Developer；审查者 → Reporter。
        </div>
      </section>
      <section v-else-if="view === 'sync' && manage" class="panel">
        <div class="panel-head">
          <h2>同步操作</h2>
          <span class="muted">当前目标版本 {{ tenant?.version }}</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>目标版本 / 时间</th>
                <th>状态</th>
                <th>尝试</th>
                <th>原因 / 操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in operations" :key="o.id">
                <td>
                  <strong>版本 {{ o.version }}</strong
                  ><span class="sub">{{ date(o.updated_at) }}</span
                  ><span class="sub mono">{{ o.id }}</span>
                </td>
                <td><StatusBadge :status="o.status" /></td>
                <td>{{ o.attempts }}</td>
                <td>
                  {{ o.error_message || "—"
                  }}<span v-if="o.error_code" class="sub mono">{{
                    o.error_code
                  }}</span
                  ><button
                    v-if="
                      ['failed', 'conflict'].includes(o.status) &&
                      o.version === tenant?.version
                    "
                    class="btn link"
                    @click="action('retry', o.id)"
                  >
                    重试当前目标</button
                  ><span v-if="o.status === 'retrying'" class="sub"
                    >下次尝试 {{ date(o.next_attempt_at) }}</span
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="!operations.length" class="empty">暂无同步操作</div>
        <div class="footnote">
          每 5 分钟核对成功版本；冲突需处理后重试。旧版本不会覆盖新目标。
        </div>
      </section>
      <section v-else-if="view === 'audit' && manage" class="panel">
        <div class="toolbar">
          <input
            id="search"
            v-model="query"
            type="search"
            class="search"
            aria-label="搜索动作、对象或变更内容"
            placeholder="搜索动作、对象或变更内容"
          />
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间 / 操作者</th>
                <th>动作</th>
                <th>详情</th>
                <th>关联同步</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in filteredAudit" :key="a.id">
                <td>
                  {{ date(a.created_at)
                  }}<span class="sub mono">{{ a.actor_id }}</span>
                </td>
                <td>{{ actionNames[a.action] || a.action }}</td>
                <td class="mono">{{ JSON.stringify(a.detail) }}</td>
                <td class="mono">{{ a.operation_id || "—" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="!filteredAudit.length" class="empty">暂无匹配的审计记录</div>
      </section>
      <div v-else class="empty">此页面由企业管理员管理。</div>
    </main>
  </div>
  <FormDialog
    v-if="dialog"
    :key="dialog.key"
    :title="dialog.title"
    :fields="dialog.fields"
    :wide="dialog.wide"
    :submit="dialog.submit"
    :submit-label="dialog.submitLabel"
    @close="dialog = undefined"
  >
    <p v-if="dialog.text" class="notice">{{ dialog.text }}</p>
    <template v-if="dialog.invitation"
      ><label class="field"
        >邀请链接<textarea
          id="invite-link"
          class="invite-link"
          readonly
          :value="dialog.invitation"
        /></label
      ><button type="button" class="btn primary" @click="copyInvitation">
        复制邀请链接
      </button>
      <p class="muted space-top">
        本次未发送邮件；链接由你自行交付。
      </p></template
    >
    <div v-if="dialog.project" class="table-wrap">
      <table class="grants">
        <thead>
          <tr>
            <th>成员</th>
            <th>目标角色</th>
            <th>GitLab 已确认</th>
            <th>平台当前能力</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="g in projectGrants(dialog.project.id)"
            :key="g.membership_id"
          >
            <td>{{ g.name }}</td>
            <td>{{ roleNames[g.desired_level] }}</td>
            <td>
              {{ remoteNames[g.observed_level] || g.observed_level
              }}<span class="sub">{{
                g.checked_at ? date(g.checked_at) : "尚未核验"
              }}</span>
            </td>
            <td>{{ roleNames[localLevel(g)] }}</td>
            <td>
              <button
                v-if="projectManage(dialog.project) && g.desired_level"
                type="button"
                class="btn link danger"
                @click="action('revoke', g.project_id + ':' + g.membership_id)"
              >
                撤销
              </button>
            </td>
          </tr>
          <tr v-if="!projectGrants(dialog.project.id).length">
            <td colspan="5">尚无项目授权</td>
          </tr>
        </tbody>
      </table>
    </div>
    <template v-if="dialog.connection"
      ><dl v-if="dialog.connection.connected" class="facts">
        <dt>连接</dt>
        <dd>可用</dd>
        <dt>版本</dt>
        <dd>
          {{ dialog.connection.version }}
          {{ dialog.connection.enterprise ? "EE" : "CE" }}
        </dd>
        <dt>服务地址</dt>
        <dd>{{ dialog.connection.url }}</dd>
        <dt>身份组织</dt>
        <dd>{{ dialog.connection.organization }}</dd>
      </dl>
      <p v-else class="notice danger">
        {{ dialog.connection.error }}
      </p></template
    >
  </FormDialog>
  <div id="toast" class="toast" role="status" aria-live="polite">
    {{ toast }}
  </div>
</template>
