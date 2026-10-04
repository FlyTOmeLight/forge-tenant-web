<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { api, mutate, message, setCSRF } from "../api";
import type { User, Tenant, Snapshot, Field, Mutation } from "../types";
import StatusBadge from "../components/StatusBadge.vue";
import FormDialog from "../components/FormDialog.vue";
import PlatformView from "./PlatformView.vue";
import CodingWorkspace from "./CodingWorkspace.vue";
import { demo } from "../prototype";
const navs = [
  ["tasks", "我的任务"],
  ["reviews", "待我审查"],
  ["spaces", "项目"],
  ["members", "成员与团队"],
  ["sync", "权限同步"],
  ["audit", "审计记录"],
  ["platform/tenants", "租户管理"],
  ["platform/connections", "全局服务连接"],
];
const platformPermissions = ref({ managePlatform: false });
const platformMode = computed(() => view.value.startsWith("platform/"));
const workspaceNavs = computed(() => navs.slice(0, 3));
const settingsNavs = computed(() =>
  navs
    .slice(3, 6)
    .filter(([id]) =>
      id === "members"
        ? data.value?.permissions.viewSettings
        : id === "sync"
          ? data.value?.permissions.viewSync
          : data.value?.permissions.viewAudit,
    ),
);
const visibleNavs = computed(() =>
  platformMode.value
    ? platformPermissions.value.managePlatform
      ? navs.slice(6)
      : []
    : [...workspaceNavs.value, ...settingsNavs.value],
);
const allowedView = computed(() =>
  platformMode.value
    ? platformPermissions.value.managePlatform
    : visibleNavs.value.some(([id]) => id === view.value) ||
      /^(task|project)\//.test(view.value),
);
const companyRoles = [
  { value: "member", label: "普通成员" },
  { value: "admin", label: "企业管理员" },
];
const user = ref<User>(),
  tenants = ref<Tenant[]>([]),
  data = ref<Snapshot>(),
  current = ref(sessionStorage.getItem("forge-tenant") || "");
const defaultView = "tasks";
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
const manage = computed(() => !!data.value?.permissions.manageMembers);
const tenant = computed(() => data.value?.tenant);
const members = computed(() => data.value?.members || []);
const operations = computed(() => data.value?.operations || []);
const coding = computed(() =>
  ["tasks", "reviews", "spaces", "task", "project"].includes(
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
const filteredMembers = computed(() =>
  members.value.filter((m) => matches(m.name, m.email, m.team_name)),
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
let refreshGeneration = 0;
async function refresh() {
  const ticket = ++refreshGeneration;
  loading.value = true;
  try {
    const items = (await api<{ items: Tenant[] }>("/api/v1/tenants")).items;
    if (ticket !== refreshGeneration) return;
    tenants.value = items;
    if (!items.some((t) => t.id === current.value)) {
      current.value = items[0]?.id || "";
      data.value = undefined;
    }
    const snapshot = current.value
      ? await api<Snapshot>("/api/v1/tenants/" + current.value)
      : undefined;
    if (ticket !== refreshGeneration) return;
    data.value = snapshot;
    sessionStorage.setItem("forge-tenant", current.value);
    status.value = "最近刷新 " + new Date().toLocaleTimeString("zh-CN");
  } catch (e) {
    if (ticket !== refreshGeneration) return;
    data.value = undefined;
    status.value = message(e);
    notify(message(e));
  } finally {
    if (ticket === refreshGeneration) loading.value = false;
  }
}
function navigate(value: string) {
  view.value = value;
  query.value = "";
  location.hash = value;
  sidebar.value = false;
}
async function enter(id: string) {
  data.value = undefined;
  current.value = id;
  navigate("tasks");
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
interface Dialog {
  key: number;
  title: string;
  text?: string;
  fields?: Field[];
  submitLabel?: string;
  submit?: (values: Record<string, string>) => Promise<void>;
  wide?: boolean;
  invitation?: string;
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
  if (kind === "retry")
    edit(
      "重试当前目标？",
      "请先修复凭证、资源归属或继承权限冲突。",
      [],
      "提交重试",
      () => update(`/operations/${id}/retry`, "POST"),
    );
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
    const info = await api<{
      user: User;
      csrf_token: string;
      permissions: { managePlatform: boolean };
    }>("/api/v1/me");
    user.value = info.user;
    platformPermissions.value = info.permissions;
    setCSRF(info.csrf_token);
    await refresh();
  } catch (e) {
    status.value = message(e);
  }
  poll = setInterval(() => {
    if (
      user.value &&
      !loading.value &&
      !document.hidden &&
      !dialog.value &&
      document.activeElement?.id !== "search"
    )
      void refresh();
  }, 5000);
});
onUnmounted(() => {
  refreshGeneration++;
  clearInterval(poll);
  clearTimeout(toastTimer);
  window.removeEventListener("hashchange", hashChanged);
});
async function switchDemo(id: string) {
  refreshGeneration++;
  data.value = undefined;
  tenants.value = [];
  demo?.setUser(id);
  const info = await api<{
    user: User;
    csrf_token: string;
    permissions: { managePlatform: boolean };
  }>("/api/v1/me");
  user.value = info.user;
  platformPermissions.value = info.permissions;
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
    <template v-if="!platformMode"
      ><label class="switch-label" for="tenant-switch">当前租户</label
      ><select
        id="tenant-switch"
        v-model="current"
        class="tenant-switch"
        aria-label="当前企业"
        :disabled="!!dialog || loading"
        @change="
          query = '';
          data = undefined;
          refresh();
        "
      >
        <option v-if="!tenants.length" value="">尚无企业</option>
        <option v-for="t in tenants" :key="t.id" :value="t.id">
          {{ t.name }}
        </option>
      </select>
    </template>
    <div class="nav-label">{{ platformMode ? "平台管理" : "研发工作" }}</div>
    <nav id="nav">
      <template v-for="[id, label] in visibleNavs" :key="id">
        <div v-if="id === 'members'" class="nav-label tenant-settings-label">
          租户设置
        </div>
        <button
          class="nav"
          :class="{
            active:
              view === id || (id === 'spaces' && view.startsWith('project/')),
          }"
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
      </template>
    </nav>
    <div class="side-bottom">
      <button
        v-if="platformPermissions.managePlatform && !platformMode"
        class="nav platform-entry"
        @click="navigate('platform/tenants')"
      >
        平台管理 ↗</button
      ><button
        v-if="platformMode"
        class="nav platform-entry"
        @click="navigate('tasks')"
      >
        ← 返回工作区
      </button>
      <div class="operator">
        <span id="avatar" class="avatar">{{
          user?.name.slice(0, 1) || "F"
        }}</span>
        <div>
          <span id="operator-name">{{ user?.name }}</span>
          <div id="operator-role" class="muted small-text">
            {{
              platformMode
                ? "平台管理员"
                : data?.permissions.viewSettings
                  ? "当前租户管理员"
                  : "租户成员"
            }}
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
          {{ platformMode ? "平台管理" : tenant?.name || "工作区" }} /
          <strong id="crumb">{{ heading }}</strong>
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
      <div v-if="!coding && !platformMode && allowedView" class="heading">
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
          v-if="view === 'members' && manage"
          class="btn primary"
          @click="action('invite')"
        >
          邀请成员
        </button>
      </div>
      <div
        v-if="!platformMode && tenant?.status === 'suspended'"
        class="notice danger"
      >
        企业已停用，平台访问资格已撤销；GitLab 撤权结果见同步记录。
      </div>
      <div v-if="!allowedView" class="empty">
        <h2>你没有此页面的访问权限</h2>
        <button class="btn" @click="navigate('tasks')">返回工作台</button>
      </div>
      <PlatformView
        v-else-if="platformMode"
        :view="view"
        :workspaces="tenants"
        :refresh-version="refreshVersion"
        @enter="enter"
        @changed="refresh"
      />
      <div v-else-if="!data" class="empty">
        <h3>尚未加入企业</h3>
        <p>请接受租户管理员发来的邀请。平台管理员可从独立入口管理租户。</p>
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
        @changed="refresh"
      />
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
      <section
        v-else-if="view === 'sync' && data?.permissions.viewSync"
        class="panel"
      >
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
      <section
        v-else-if="view === 'audit' && data?.permissions.viewAudit"
        class="panel"
      >
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
  </FormDialog>
  <div id="toast" class="toast" role="status" aria-live="polite">
    {{ toast }}
  </div>
</template>
