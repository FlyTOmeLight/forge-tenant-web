<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from "vue";
import { api, setCSRF, message } from "../api";
import type {
  User,
  Tenant,
  Snapshot,
  Project,
  Member,
  Task,
  TaskDetail,
  Field,
} from "../types";
import FormDialog from "../components/FormDialog.vue";
import StatusBadge from "../components/StatusBadge.vue";
const user = ref<User>(),
  tenants = ref<Tenant[]>([]),
  projects = ref<Project[]>([]),
  members = ref<Member[]>([]);
const tenant = ref(sessionStorage.getItem("forge-task-tenant") || ""),
  project = ref(sessionStorage.getItem("forge-task-project") || ""),
  items = ref<Task[]>([]),
  detail = ref<TaskDetail>();
const tab = ref("overview"),
  status = ref("正在读取项目授权…"),
  toast = ref(""),
  loading = ref(false),
  sidebar = ref(false);
const task = computed(() => detail.value?.task),
  permission = computed(() => detail.value?.permissions);
const ended = computed(() =>
  ["Completed", "Canceled", "Undelivered"].includes(task.value?.status || ""),
);
const idle = computed(
  () => !task.value?.activeRun && task.value?.stopConfirmed,
);
const stopLate = computed(
  () =>
    !!task.value?.stopRequestedAt &&
    !task.value?.stopConfirmed &&
    Date.now() - Date.parse(task.value!.stopRequestedAt!) > 60000,
);
const path = () =>
  `/api/v1/tenants/${tenant.value}/projects/${project.value}/tasks`;
const labels: Record<string, string> = {
  Intervene: "人工介入",
  Resume: "恢复 Agent",
  Transfer: "转交任务",
  Cancel: "取消任务",
  Continue: "继续任务",
  Approve: "认可当前代码版本",
  Feedback: "提交整合后的修改要求",
  NextFeedback: "开始下一条正式要求",
};
const tabs = [
  ["overview", "任务概览"],
  ["comments", "代码评论"],
  ["checks", "验证与审查"],
  ["logs", "执行记录"],
];
const notes = computed(() =>
  (task.value?.discussions || []).flatMap((d) =>
    (d.notes || [])
      .filter((n) => !n.system)
      .map((n) => ({ ...n, discussionId: d.id })),
  ),
);
const feedback = computed(() =>
  (detail.value?.feedback || []).filter((f) => f.status !== "Consumed"),
);
const actionButtons = computed(() => {
  const result: string[] = [];
  const p = permission.value,
    t = task.value;
  if (!p || !t) return result;
  if (p.write && !ended.value && t.control !== "Human")
    result.push("Intervene");
  if (p.manage && !ended.value && t.control === "Human" && idle.value)
    result.push("Resume");
  if (p.manage) result.push("Transfer");
  if (p.manage && !ended.value) result.push("Cancel");
  if (p.manage && ["Canceled", "Undelivered"].includes(t.status) && idle.value)
    result.push("Continue");
  return result;
});
const date = (v: string) => new Date(v).toLocaleString("zh-CN");
let poll: ReturnType<typeof setInterval>,
  timer: ReturnType<typeof setTimeout>,
  serial = 0;
function notify(v: string) {
  toast.value = v;
  clearTimeout(timer);
  timer = setTimeout(() => (toast.value = ""), 5000);
}
interface Dialog {
  key: number;
  title: string;
  text: string;
  fields: Field[];
  submitLabel: string;
  submit: (values: Record<string, string>) => Promise<void>;
}
const dialog = shallowRef<Dialog>();
async function refresh() {
  if (loading.value) return;
  loading.value = true;
  try {
    if (!project.value) {
      status.value =
        "当前企业没有可访问的代码项目。企业角色不会自动授予代码权限。";
      return;
    }
    items.value = (await api<{ items: Task[] }>(path())).items;
    if (detail.value)
      detail.value = await api<TaskDetail>(path() + "/" + detail.value.task.id);
    status.value = "数据已更新 · " + new Date().toLocaleTimeString("zh-CN");
  } catch (e) {
    status.value = message(e);
  } finally {
    loading.value = false;
  }
}
async function selectTenant() {
  detail.value = undefined;
  items.value = [];
  projects.value = [];
  if (!tenant.value) {
    project.value = "";
    return;
  }
  loading.value = true;
  try {
    const snapshot = await api<Snapshot>("/api/v1/tenants/" + tenant.value);
    members.value = snapshot.members || [];
    const allowed = await Promise.all(
      (snapshot.projects || []).map(async (p) =>
        (
          await api<{ read: boolean }>(
            `/api/v1/tenants/${tenant.value}/projects/${p.id}/access`,
          )
        ).read
          ? p
          : null,
      ),
    );
    projects.value = allowed.filter((p): p is Project => p !== null);
    if (!projects.value.some((p) => p.id === project.value))
      project.value = projects.value[0]?.id || "";
    remember();
  } catch (e) {
    status.value = message(e);
    project.value = "";
  } finally {
    loading.value = false;
  }
  await refresh();
}
function remember() {
  sessionStorage.setItem("forge-task-tenant", tenant.value);
  sessionStorage.setItem("forge-task-project", project.value);
}
async function selectProject() {
  detail.value = undefined;
  remember();
  await refresh();
}
async function open(id: string) {
  try {
    detail.value = await api<TaskDetail>(path() + "/" + id);
    tab.value = "overview";
  } catch (e) {
    notify(message(e));
  }
}
async function sync() {
  try {
    await api(path() + "/" + task.value!.id + "/sync", {
      method: "POST",
      body: "{}",
    });
    await refresh();
    notify("GitLab 状态和评论已同步");
  } catch (e) {
    notify(message(e));
  }
}
function show(
  title: string,
  text: string,
  fields: Field[],
  submitLabel: string,
  fn: (values: Record<string, string>) => Promise<void>,
) {
  dialog.value = {
    key: ++serial,
    title,
    text,
    fields,
    submitLabel,
    submit: async (values) => {
      await fn(values);
      dialog.value = undefined;
      await refresh();
      notify("操作已保存");
    },
  };
}
function create() {
  const base = path();
  show(
    "关联修复任务",
    "仅可关联当前项目的开放 MR。关联后默认人工处理，不自动启动。",
    [
      { name: "title", label: "任务名称" },
      { name: "description", label: "问题与复现", type: "textarea" },
      { name: "criteria", label: "验收条件", type: "textarea" },
      { name: "mrIid", label: "已有 MR 编号", type: "number" },
      {
        name: "synthetic",
        label: "案例类型",
        options: [
          { value: "false", label: "真实业务问题" },
          { value: "true", label: "人工注入联调案例" },
        ],
      },
    ],
    "关联任务",
    async (values) => {
      const result = await api<Task>(base, {
        method: "POST",
        body: JSON.stringify({
          ...values,
          mrIid: Number(values.mrIid),
          synthetic: values.synthetic === "true",
        }),
      });
      detail.value = await api<TaskDetail>(base + "/" + result.id);
    },
  );
}
function action(kind: string) {
  const t = task.value!;
  const base = path() + "/" + t.id;
  const version = t.version,
    head = t.head;
  const texts: Record<string, string> = {
    Intervene: "立即禁止自动写入，并请求执行器停止。停止确认前不能恢复 Agent。",
    Cancel: "停止继续处理任务，保留分支与 MR。",
    Approve: "认可只针对当前代码版本，不代表任务完成。",
    Continue: "重新开启任务处理资格，保持人工处理。",
    Resume: "将以当前代码版本执行新一轮，并重新验证。",
    Feedback: "评论不会自动执行。请整合相互冲突的意见后正式提交。",
    Transfer:
      "只改变处理责任，保留当前控制权、分支与 MR。后端核对新负责人的项目写权限。",
  };
  const fields: Field[] = [];
  if (["Resume", "Feedback"].includes(kind))
    fields.push({
      name: "text",
      label: "本轮已整合的修改要求",
      type: "textarea",
    });
  if (kind === "Transfer")
    fields.push({
      name: "ownerId",
      label: "新负责人",
      options: members.value
        .filter((m) => m.status === "active")
        .map((m) => ({ value: m.user_id, label: m.name })),
    });
  show(
    labels[kind] || kind,
    (texts[kind] || "") + "\n当前版本 " + head,
    fields,
    kind === "Resume"
      ? "恢复并开始本轮"
      : kind === "Feedback"
        ? "正式提交"
        : "确认",
    async (values) => {
      await api(base + "/actions", {
        method: "POST",
        body: JSON.stringify({ action: kind, version, head, ...values }),
      });
    },
  );
}
async function reconfirm(id: string) {
  const t = task.value!;
  try {
    await api(path() + "/" + t.id + "/actions", {
      method: "POST",
      body: JSON.stringify({
        action: "ReconfirmFeedback",
        feedbackId: id,
        version: t.version,
        head: t.head,
      }),
    });
    await refresh();
  } catch (e) {
    notify(message(e));
  }
}
async function logout() {
  try {
    await api("/auth/logout", { method: "POST", body: "{}" });
    location.assign("/auth/login");
  } catch (e) {
    notify(message(e));
  }
}
onMounted(async () => {
  document.title = "Forge · 代码修复";
  try {
    const info = await api<{ user: User; csrf_token: string }>("/api/v1/me");
    user.value = info.user;
    setCSRF(info.csrf_token);
    tenants.value = (await api<{ items: Tenant[] }>("/api/v1/tenants")).items;
    if (!tenants.value.some((t) => t.id === tenant.value))
      tenant.value = tenants.value.find((t) => t.status === "active")?.id || "";
    await selectTenant();
  } catch (e) {
    status.value = message(e);
  }
  poll = setInterval(() => {
    if (user.value && !document.hidden && !dialog.value) void refresh();
  }, 5000);
});
onUnmounted(() => {
  clearInterval(poll);
  clearTimeout(timer);
});
const eventNames: Record<string, string> = {
  TaskAssociated: "已关联任务",
  Intervene: "人工介入",
  Resume: "显式恢复 Agent",
  Transfer: "任务转交",
  Cancel: "任务取消",
  Approve: "认可代码版本",
  GitLabSync: "同步 GitLab 状态",
  ExecutionStarted: "执行器已启动",
  ExecutionStopped: "执行停止已确认",
  ExecutionPassed: "自动检查通过",
  ExecutionFailed: "执行失败",
  Feedback: "正式反馈已提交",
  Continue: "显式继续任务",
};
</script>
<template>
  <a class="skip" href="#main">跳到任务内容</a>
  <aside
    id="sidebar"
    class="sidebar"
    :class="{ open: sidebar }"
    aria-label="项目导航"
  >
    <div class="brand"><span class="mark" aria-hidden="true">F</span>Forge</div>
    <label class="switch-label" for="tenant">当前企业</label
    ><select
      id="tenant"
      v-model="tenant"
      class="tenant-switch"
      :disabled="!!dialog || loading"
      @change="selectTenant"
    >
      <option v-for="t in tenants" :key="t.id" :value="t.id">
        {{ t.name }}{{ t.status === "suspended" ? "（已停用）" : "" }}
      </option></select
    ><label class="switch-label space-top" for="project">代码项目</label
    ><select
      id="project"
      v-model="project"
      class="tenant-switch"
      :disabled="!!dialog || loading"
      @change="selectProject"
    >
      <option v-for="p in projects" :key="p.id" :value="p.id">
        {{ p.name }}
      </option>
    </select>
    <nav class="task-nav">
      <a class="nav-item" href="/">组织与访问</a
      ><a class="nav-item active" href="/tasks" aria-current="page">代码修复</a>
    </nav>
    <div class="side-bottom">
      <div class="operator">
        <span id="avatar" class="avatar">{{
          user?.name.slice(0, 1) || "F"
        }}</span
        ><span id="user">{{ user?.name }}</span>
      </div>
      <button id="logout" class="btn link" @click="logout">退出登录</button>
    </div>
  </aside>
  <div class="workspace">
    <header class="topbar">
      <button
        id="menu"
        class="mobile-menu"
        aria-label="展开项目导航"
        :aria-expanded="sidebar"
        aria-controls="sidebar"
        @click="sidebar = !sidebar"
      >
        ☰</button
      ><span class="breadcrumb">Forge / <strong>代码修复</strong></span>
      <div class="top-links">
        <button
          id="refresh"
          class="btn small"
          :disabled="loading"
          @click="refresh"
        >
          刷新
        </button>
      </div>
    </header>
    <div id="status" class="status-banner" role="status">{{ status }}</div>
    <main id="main" class="content" tabindex="-1" :aria-busy="loading">
      <div v-if="!project" class="task-empty">
        <h1>先选择可访问的代码项目</h1>
        <p>管理员授予项目权限后，修复任务会显示在这里。</p>
        <a class="btn" href="/">查看组织与访问</a>
      </div>
      <template v-else-if="!detail"
        ><div class="task-heading">
          <div>
            <h1>代码修复</h1>
            <p class="muted">每项任务对应一个分支和 MR，人工操作随时优先。</p>
          </div>
          <button class="btn primary" data-action="create" @click="create">
            关联修复任务
          </button>
        </div>
        <section class="panel">
          <div v-if="items.length" class="table-wrap">
            <table class="task-list">
              <thead>
                <tr>
                  <th>任务 / 代码版本</th>
                  <th>状态与控制</th>
                  <th>验证 / 审查</th>
                  <th>交付</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="t in items" :key="t.id">
                  <td>
                    <button :data-open="t.id" @click="open(t.id)">
                      <strong>{{ t.title }}</strong>
                    </button>
                    <div class="task-commit">
                      {{ t.head.slice(0, 12) }} · {{ t.branch }}
                    </div>
                    <span v-if="t.synthetic" class="sub">人工注入联调</span>
                  </td>
                  <td>
                    <StatusBadge :status="t.status" /><span class="sub"
                      ><StatusBadge :status="t.control"
                    /></span>
                  </td>
                  <td>
                    <StatusBadge :status="t.checks" /><span class="sub">{{
                      t.approvalHead === t.head
                        ? "当前版本已认可"
                        : "等待人工审查"
                    }}</span>
                  </td>
                  <td>
                    MR !{{ t.mrIid
                    }}<span class="sub">第 {{ t.round }} 轮</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="task-empty">
            <h2>将待处理 MR 关联为修复任务</h2>
            <p class="muted">
              填写复现和验收条件后，可审查评论、人工处理或显式恢复 Agent。
            </p>
          </div>
        </section></template
      >
      <template v-else-if="task"
        ><button
          class="btn link task-back"
          data-action="back"
          @click="detail = undefined"
        >
          返回任务列表
        </button>
        <div class="task-heading">
          <div>
            <StatusBadge :status="task.status" /><span
              v-if="task.synthetic"
              class="badge"
              >人工注入联调</span
            >
            <h1>{{ task.title }}</h1>
            <div class="task-commit">{{ task.branch }} · {{ task.head }}</div>
          </div>
          <div class="row wrap">
            <button
              v-for="kind in actionButtons"
              :key="kind"
              class="btn"
              :class="{ primary: ['Intervene', 'Resume'].includes(kind) }"
              :data-action="kind"
              @click="action(kind)"
            >
              {{ labels[kind] }}
            </button>
          </div>
        </div>
        <div class="task-control">
          <div class="row">
            <h2><StatusBadge :status="task.control" /></h2>
            <span class="badge" :class="task.stopConfirmed ? 'good' : 'warn'">{{
              task.control === "Agent"
                ? task.activeRun
                  ? "正在执行"
                  : "当前未执行"
                : task.stopConfirmed
                  ? "停止已确认"
                  : "停止尚未确认"
            }}</span>
          </div>
          <p v-if="task.control === 'Human'">
            自动写入已禁止。你可以在 GitLab 直接修改并提交；恢复 Agent
            需要重新确认当前代码版本。
          </p>
          <p v-else-if="task.control === 'Stopping'">
            自动写入已禁止，正在等待执行器确认停止。确认前不能恢复 Agent。
          </p>
          <p v-else>
            Agent
            仅执行本轮正式要求。评论同步不会触发新一轮，也不会替代人工审查。
          </p>
          <p v-if="stopLate" class="task-warning">
            请求已超过 60 秒，停止仍未确认。请联系负责人检查执行器。
          </p>
        </div>
        <div class="task-grid">
          <section class="panel">
            <div class="task-tabs" role="tablist" aria-label="任务详情">
              <button
                v-for="[key, label] in tabs"
                :id="'tab-' + key"
                :key="key"
                role="tab"
                :data-tab="key"
                :aria-selected="tab === key"
                aria-controls="task-body"
                @click="tab = key!"
              >
                {{ label }}
              </button>
            </div>
            <div id="task-body" role="tabpanel" :aria-labelledby="'tab-' + tab">
              <template v-if="tab === 'overview'"
                ><h2>问题与复现</h2>
                <p class="task-copy">{{ task.description }}</p>
                <h2>验收条件</h2>
                <p class="task-copy">{{ task.criteria }}</p></template
              >
              <template v-else-if="tab === 'comments'"
                ><div class="row spread">
                  <h2>GitLab 行级评论</h2>
                  <button class="btn" data-action="sync" @click="sync">
                    同步评论
                  </button>
                </div>
                <p class="muted">
                  评论保留具体位置与代码版本。意见冲突由审查者整合后正式提交。
                </p>
                <article v-for="note in notes" :key="note.id" class="task-note">
                  <div class="task-note-title">
                    <strong>{{ note.author?.name || "审查意见" }}</strong
                    ><small>{{
                      note.position?.head_sha === task.head
                        ? "当前版本"
                        : "历史讨论"
                    }}</small>
                  </div>
                  <span v-if="note.position" class="position"
                    >{{ note.position.new_path || note.position.old_path }}:{{
                      note.position.new_line || note.position.old_line
                    }}
                    · {{ note.position.head_sha?.slice(0, 12) }}</span
                  >
                  <p>{{ note.body }}</p>
                  <span class="task-commit">讨论 {{ note.discussionId }}</span>
                </article>
                <p v-if="!notes.length" class="muted">尚未同步到审查评论。</p>
                <button
                  v-if="permission?.review && !ended"
                  class="btn primary"
                  data-action="Feedback"
                  @click="action('Feedback')"
                >
                  提交整合后的修改要求
                </button>
                <h2>待处理修改要求</h2>
                <article v-for="f in feedback" :key="f.id" class="task-note">
                  <strong>{{
                    f.status === "NeedsReconfirmation"
                      ? "等待核对新版本"
                      : "等待本轮结束"
                  }}</strong>
                  <p>{{ f.requirements }}</p>
                  <span class="task-commit">{{ f.head }}</span
                  ><button
                    v-if="permission?.review"
                    class="btn"
                    :data-reconfirm="f.id"
                    @click="reconfirm(f.id)"
                  >
                    核对当前版本
                  </button>
                </article>
                <button
                  v-if="
                    permission?.manage &&
                    task.control === 'Agent' &&
                    !task.activeRun &&
                    feedback.length
                  "
                  class="btn"
                  data-action="NextFeedback"
                  @click="action('NextFeedback')"
                >
                  开始下一条正式要求
                </button></template
              >
              <template v-else-if="tab === 'checks'"
                ><h2>自动检查</h2>
                <p>
                  <StatusBadge :status="task.checks" /><span
                    v-if="task.checkedHead"
                    class="task-commit"
                    >绑定 {{ task.checkedHead }}</span
                  ><span v-else>等待本轮执行器提交验证证据</span>
                </p>
                <h2>人工审查</h2>
                <p>
                  {{
                    task.approvalHead === task.head
                      ? "当前版本已经认可，仍需在 GitLab 人工合入。"
                      : "审查代码和验证证据后，记录对当前版本的认可。"
                  }}
                </p>
                <button
                  v-if="permission?.review && !ended"
                  class="btn primary"
                  data-action="Approve"
                  @click="action('Approve')"
                >
                  认可当前代码版本
                </button>
                <details
                  v-for="(run, index) in detail.runs"
                  :key="run.id"
                  class="task-run"
                  :open="index === 0"
                >
                  <summary>
                    <StatusBadge :status="run.status" />
                    {{ date(run.created_at) }}
                  </summary>
                  <p class="task-copy">{{ run.requirements }}</p>
                  <p v-if="run.output?.summary">{{ run.output.summary }}</p>
                  <p v-if="run.output?.durationSeconds" class="muted">
                    执行 {{ run.output.durationSeconds }} 秒
                  </p>
                  <p v-if="run.output?.checksCommit" class="task-commit">
                    验证版本 {{ run.output.checksCommit }}
                  </p>
                  <p v-if="run.output?.error" class="task-warning task-copy">
                    {{ run.output.error }}
                  </p>
                  <div
                    v-for="check in run.output?.checks"
                    :key="check.attempt"
                    class="task-check"
                  >
                    <strong
                      >第 {{ check.attempt }} 次检查 ·
                      {{ check.passed ? "通过" : "未通过" }}</strong
                    >
                    <pre class="task-code">{{ check.log }}</pre>
                  </div>
                  <p v-if="run.output?.stopConfirmed" class="muted">
                    执行器已确认停止。
                  </p>
                  <details v-if="run.output?.patch">
                    <summary>查看本轮代码差异</summary>
                    <pre class="task-code">{{ run.output.patch }}</pre>
                  </details>
                </details></template
              >
              <template v-else
                ><article
                  v-for="event in detail.events"
                  :key="event.id"
                  class="task-event"
                >
                  <strong>{{ eventNames[event.type] || event.type }}</strong
                  ><small
                    >{{ date(event.created_at) }} · {{ event.actor_id }}</small
                  >
                  <pre>{{ JSON.stringify(event.detail, null, 2) }}</pre>
                </article>
                <p v-if="!detail.events.length" class="muted">
                  尚无执行记录。
                </p></template
              >
            </div>
          </section>
          <aside class="panel task-side">
            <h2>交付与责任</h2>
            <dl>
              <dt>MR</dt>
              <dd>!{{ task.mrIid }}</dd>
              <dt>目标分支</dt>
              <dd class="task-commit">{{ task.targetBranch }}</dd>
              <dt>负责人</dt>
              <dd>
                {{
                  members.find((m) => m.user_id === task?.ownerId)?.name ||
                  task.ownerId
                }}
              </dd>
              <dt>执行轮次</dt>
              <dd>第 {{ task.round }} 轮</dd>
              <dt>当前检查</dt>
              <dd><StatusBadge :status="task.checks" /></dd>
              <dt>审查认可</dt>
              <dd>
                {{
                  task.approvalHead === task.head
                    ? "当前版本已认可"
                    : "待人工审查"
                }}
              </dd>
            </dl>
            <div class="task-links">
              <button class="btn" data-action="sync" @click="sync">
                同步 GitLab 状态</button
              ><a
                class="btn"
                :href="detail.gitlabUrl"
                target="_blank"
                rel="noopener"
                >打开 GitLab MR</a
              >
            </div>
            <p class="muted small-text">
              人工审查通过不结束任务；任务以 MR 合入为完成条件。
            </p>
          </aside>
        </div>
      </template>
    </main>
  </div>
  <FormDialog
    v-if="dialog"
    :key="dialog.key"
    :title="dialog.title"
    :fields="dialog.fields"
    :submit="dialog.submit"
    :submit-label="dialog.submitLabel"
    @close="dialog = undefined"
    ><p class="task-copy">{{ dialog.text }}</p></FormDialog
  >
  <div id="toast" class="toast" role="status" aria-live="polite">
    {{ toast }}
  </div>
</template>
