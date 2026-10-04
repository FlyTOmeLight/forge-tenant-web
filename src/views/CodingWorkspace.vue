<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from "vue";
import { api, message } from "../api";
import { demo } from "../prototype";
import type {
  Access,
  Connections,
  Field,
  Project,
  SettingsResponse,
  Snapshot,
  Task,
  User,
} from "../types";
import FormDialog from "../components/FormDialog.vue";
import StatusBadge from "../components/StatusBadge.vue";
import TaskDetailView from "./TaskDetailView.vue";
const props = defineProps<{
  snapshot: Snapshot;
  user: User;
  view: string;
  refreshVersion: number;
}>();
const emit = defineEmits<{ navigate: [path: string]; addProject: [] }>();
type CodeProject = Project & { access: Access };
const projects = ref<CodeProject[]>([]),
  tasks = ref<Task[]>([]),
  config = ref<SettingsResponse>(),
  connections = ref<Connections>();
const busy = ref(false),
  error = ref(""),
  notice = ref(""),
  search = ref(""),
  filter = ref("all"),
  scope = ref("all");
const layout = ref(localStorage.getItem("forge-layout") || "A"),
  selected = ref("");
watch(layout, (value) => localStorage.setItem("forge-layout", value));
const tid = computed(() => props.snapshot.tenant.id);
const pid = computed(() => props.view.split("/")[1] || "");
const taskRoute = computed(() => props.view.split("/"));
const writeProjects = computed(() =>
  projects.value.filter((p) => p.access.write),
);
const owner = (id: string) =>
  props.snapshot.members.find((m) => m.user_id === id)?.name || id;
const projectName = (id: string) =>
  projects.value.find((p) => p.id === id)?.name || id;
const ended = (t: Task) =>
  ["Completed", "Canceled", "Undelivered"].includes(t.status);
const filtered = computed(() =>
  tasks.value.filter((t) => {
    if (
      props.view === "reviews" &&
      (!t.reviewerIds.includes(props.user.id) ||
        ended(t) ||
        t.approvalHead === t.head)
    )
      return false;
    if (scope.value !== "all" && t.projectId !== scope.value) return false;
    if (
      !`${t.title} ${t.id} ${projectName(t.projectId)}`
        .toLowerCase()
        .includes(search.value.toLowerCase())
    )
      return false;
    return (
      filter.value === "all" ||
      (filter.value === "mine" && t.ownerId === props.user.id) ||
      (filter.value === "review" &&
        t.reviewerIds.includes(props.user.id) &&
        !ended(t)) ||
      (filter.value === "running" &&
        ["Queued", "Running"].includes(t.status)) ||
      (filter.value === "attention" &&
        ["Failed", "Waiting", "Canceling"].includes(t.status))
    );
  }),
);
const preview = computed(
  () =>
    filtered.value.find((t) => t.id === selected.value) || filtered.value[0],
);
const lanes = [
  { title: "待执行", states: ["Queued"] },
  { title: "处理中", states: ["Running", "Waiting", "Canceling"] },
  { title: "待审查", states: ["Review"] },
  { title: "需关注", states: ["Failed", "Canceled", "Undelivered"] },
  { title: "已完成", states: ["Completed"] },
];
function open(t: Task) {
  emit("navigate", `task/${tid.value}/${t.projectId}/${t.id}`);
}
function base(project: string) {
  return `/api/v1/tenants/${tid.value}/projects/${project}`;
}
let generation = 0;
async function refresh() {
  const ticket = ++generation;
  busy.value = true;
  error.value = "";
  try {
    const all = await Promise.all(
      props.snapshot.projects.map(async (p) => ({
        ...p,
        access: await api<Access>(base(p.id) + "/access"),
      })),
    );
    const readable = all.filter((p) => p.access.read);
    let loaded: Task[] = [];
    let settings: SettingsResponse | undefined,
      connected: Connections | undefined;
    if (["tasks", "reviews", "spaces"].includes(props.view))
      loaded = (
        await Promise.all(
          readable.map(
            async (p) =>
              (await api<{ items: Task[] }>(base(p.id) + "/tasks")).items,
          ),
        )
      )
        .flat()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (props.view.startsWith("project/"))
      [settings, connected] = await Promise.all([
        api<SettingsResponse>(base(pid.value) + "/coding-settings"),
        api<Connections>("/api/v1/coding/connections"),
      ]);
    if (props.view === "connections")
      connected = await api<Connections>("/api/v1/coding/connections");
    if (ticket !== generation) return;
    projects.value = readable;
    tasks.value = loaded;
    config.value = settings;
    connections.value = connected;
  } catch (e) {
    if (ticket === generation) error.value = message(e);
  } finally {
    if (ticket === generation) busy.value = false;
  }
}
watch(
  () => [props.view, props.snapshot],
  () => {
    if (!dialog.value) void refresh();
  },
  { deep: false },
);
onUnmounted(() => generation++);
interface Dialog {
  title: string;
  fields: Field[];
  text?: string;
  submitLabel?: string;
  reviewers?: boolean;
  submit: (values: Record<string, string>) => Promise<void>;
}
const dialog = shallowRef<Dialog>(),
  reviewers = ref<string[]>([]),
  reviewerCandidates = ref<{ id: string; name: string }[]>([]);
const field = (
  name: string,
  label: string,
  value = "",
  type = "text",
  required = true,
): Field => ({ name, label, value, type, required });
function form(spec: Dialog) {
  dialog.value = {
    ...spec,
    submit: async (values) => {
      await spec.submit(values);
      dialog.value = undefined;
      await refresh();
    },
  };
}
async function create(projectID?: string) {
  try {
    if (!projectID) {
      if (writeProjects.value.length === 1)
        return create(writeProjects.value[0]!.id);
      dialog.value = {
        title: "选择任务项目",
        fields: [
          {
            name: "project",
            label: "项目",
            options: writeProjects.value.map((p) => ({
              value: p.id,
              label: p.name,
            })),
          },
        ],
        submitLabel: "下一步",
        submit: async (v) => {
          dialog.value = undefined;
          await create(v.project);
        },
      };
      return;
    }
    const selectedProject = projectID,
      path = base(projectID),
      { settings, branches, executors } = await api<SettingsResponse>(
        path + "/coding-settings",
      );
    if (!settings.checkedAt) {
      notice.value = "请先保存项目执行配置并检查接入。";
      emit("navigate", "project/" + projectID);
      return;
    }
    const eligible = new Set(
      props.snapshot.grants
        .filter(
          (g) =>
            g.project_id === projectID &&
            g.member_status === "active" &&
            Math.min(g.desired_level, g.observed_level, g.effective_level) >=
              20,
        )
        .map((g) => g.membership_id),
    );
    reviewerCandidates.value = props.snapshot.members
      .filter((m) => eligible.has(m.id))
      .map((m) => ({ id: m.user_id, name: m.name }));
    reviewers.value = reviewerCandidates.value.some(
      (m) => m.id === props.user.id,
    )
      ? [props.user.id]
      : [];
    const idempotencyKey = crypto.randomUUID();
    form({
      title: "新建修复任务",
      reviewers: true,
      text: `配置 v${settings.version} · ${executors.length} 个在线执行器 · 最多 ${settings.repairLimit} 次修复 / ${settings.timeoutMinutes} 分钟。产生有效修改后创建 Draft MR。`,
      submitLabel: "创建并加入队列",
      fields: [
        field("title", "任务名称"),
        {
          name: "baseBranch",
          label: "基准分支",
          value: settings.baseBranch,
          options: branches.map((b) => ({ value: b.name, label: b.name })),
        },
        field("description", "问题描述", "", "textarea"),
        field("reproduce", "复现步骤", "", "textarea"),
        field("criteria", "验收条件", "", "textarea"),
        field("constraints", "修改约束", "", "textarea", false),
        field("reference", "参考资料", "", "textarea", false),
        {
          name: "synthetic",
          label: "案例类型",
          options: [
            { value: "false", label: "真实业务问题" },
            { value: "true", label: "人工注入联调案例" },
          ],
        },
      ],
      submit: async (values) => {
        if (!reviewers.value.length) throw Error("请至少选择一位审查者。");
        const task = await api<Task>(path + "/tasks/new", {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({
            ...values,
            reviewerIds: reviewers.value,
            synthetic: values.synthetic === "true",
          }),
        });
        emit("navigate", `task/${tid.value}/${selectedProject}/${task.id}`);
      },
    });
  } catch (e) {
    error.value = message(e);
  }
}
function associate() {
  form({
    title: "关联修复任务",
    text: "关联当前项目已有的开放 MR，保持人工控制。恢复 Agent 前需检查项目执行配置。",
    submitLabel: "关联任务",
    fields: [
      {
        name: "project",
        label: "项目",
        options: writeProjects.value.map((p) => ({
          value: p.id,
          label: p.name,
        })),
      },
      field("title", "任务名称"),
      field("description", "问题与复现", "", "textarea"),
      field("criteria", "验收条件", "", "textarea"),
      field("mrIid", "已有 MR 编号", "", "number"),
      {
        name: "synthetic",
        label: "案例类型",
        options: [
          { value: "false", label: "真实业务问题" },
          { value: "true", label: "人工注入联调案例" },
        ],
      },
    ],
    submit: async (v) => {
      const task = await api<Task>(base(v.project!) + "/tasks", {
        method: "POST",
        body: JSON.stringify({
          ...v,
          mrIid: Number(v.mrIid),
          synthetic: v.synthetic === "true",
        }),
      });
      emit("navigate", `task/${tid.value}/${v.project}/${task.id}`);
    },
  });
}
function editConfig() {
  const response = config.value;
  if (!response) return;
  const s = response.settings,
    path = base(pid.value);
  const models = [
    ...new Set([
      ...(connections.value?.model.models || []),
      ...(s.model ? [s.model] : []),
    ]),
  ];
  form({
    title: "编辑项目执行配置",
    text: "保存后需要重新检查接入。已开始的轮次保留其配置快照。",
    fields: [
      {
        name: "baseBranch",
        label: "基准分支",
        value: s.baseBranch,
        options: response.branches.map((b) => ({
          value: b.name,
          label: b.name,
        })),
      },
      models.length
        ? {
            name: "model",
            label: "模型",
            value: s.model,
            options: models.map((m) => ({ value: m, label: m })),
          }
        : field("model", "模型名称", s.model),
      field(
        "allowedPaths",
        "允许修改范围（每行一项）",
        s.allowedPaths.join("\n"),
        "textarea",
      ),
      field("checks", "检查命令（每行一项）", s.checks.join("\n"), "textarea"),
      field(
        "repairLimit",
        "修复次数上限（1–3）",
        String(s.repairLimit),
        "number",
      ),
      field(
        "timeoutMinutes",
        "执行时间上限（1–30 分钟）",
        String(s.timeoutMinutes),
        "number",
      ),
    ],
    submit: async (values) => {
      await api(path + "/coding-settings", {
        method: "PUT",
        body: JSON.stringify({
          ...values,
          version: s.version,
          allowedPaths: values
            .allowedPaths!.split("\n")
            .map((v) => v.trim())
            .filter(Boolean),
          checks: values
            .checks!.split("\n")
            .map((v) => v.trim())
            .filter(Boolean),
          repairLimit: Number(values.repairLimit),
          timeoutMinutes: Number(values.timeoutMinutes),
        }),
      });
      notice.value = "配置已保存，请重新检查接入。";
    },
  });
}
async function checkConfig() {
  try {
    await api(base(pid.value) + "/coding-settings/check", {
      method: "POST",
      body: "{}",
    });
    notice.value = "接入检查通过，可以创建任务。";
    await refresh();
  } catch (e) {
    error.value = message(e);
  }
}
void refresh();
</script>
<template>
  <div class="coding-workspace" :aria-busy="busy">
    <p v-if="error" class="notice danger" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <TaskDetailView
      v-if="view.startsWith('task/') && taskRoute[1] === tid"
      :key="view"
      :refresh-version="refreshVersion"
      :tenant-id="tid"
      :project-id="taskRoute[2]!"
      :task-id="taskRoute[3]!"
      :members="snapshot.members"
      @navigate="emit('navigate', $event)"
    />
    <p v-else-if="view.startsWith('task/')" class="notice">
      该任务不属于当前企业，请在对应企业打开。
    </p>
    <template v-else-if="view === 'tasks' || view === 'reviews'">
      <div class="task-heading">
        <div>
          <h1>{{ view === "reviews" ? "待我审查" : "任务工作台" }}</h1>
          <p class="muted">
            从问题描述到代码交付，跟进每轮执行、检查与人工审查。
          </p>
        </div>
        <button
          v-if="writeProjects.length && !demo"
          class="btn"
          @click="associate"
        >
          关联修复任务</button
        ><button
          v-if="writeProjects.length"
          class="btn primary"
          @click="create()"
        >
          新建修复任务
        </button>
      </div>
      <div class="coding-stats">
        <div>
          <strong>{{
            tasks.filter((t) => t.ownerId === user.id && !ended(t)).length
          }}</strong
          >我的待办
        </div>
        <div>
          <strong>{{
            tasks.filter((t) => ["Queued", "Running"].includes(t.status)).length
          }}</strong
          >排队与执行
        </div>
        <div>
          <strong>{{
            tasks.filter((t) => t.status === "Review").length
          }}</strong
          >待审查
        </div>
        <div>
          <strong>{{
            tasks.filter((t) =>
              ["Failed", "Waiting", "Canceling"].includes(t.status),
            ).length
          }}</strong
          >需关注
        </div>
      </div>
      <section class="panel">
        <div class="toolbar coding-toolbar">
          <input
            v-model="search"
            class="search"
            type="search"
            aria-label="搜索修复任务"
            placeholder="搜索任务或项目"
          /><select v-model="scope" aria-label="筛选项目">
            <option value="all">全部项目</option>
            <option v-for="p in projects" :key="p.id" :value="p.id">
              {{ p.name }}
            </option></select
          ><select v-model="filter" aria-label="筛选任务">
            <option value="all">全部任务</option>
            <option value="mine">我的任务</option>
            <option value="review">我参与审查</option>
            <option value="running">执行中</option>
            <option value="attention">需要关注</option>
          </select>
          <div class="row" aria-label="工作台布局">
            <button
              v-for="[id, label] in [
                ['A', '表格'],
                ['B', '看板'],
                ['C', '双栏'],
              ]"
              :key="id"
              class="btn small"
              :aria-pressed="layout === id"
              @click="layout = id!"
            >
              {{ label }}
            </button>
          </div>
        </div>
        <div v-if="!filtered.length" class="empty">
          暂无符合条件的任务。选择项目并创建一项修复任务。
        </div>
        <div v-else-if="layout === 'A'" class="table-wrap">
          <table class="task-list">
            <thead>
              <tr>
                <th>任务 / 项目</th>
                <th>状态与控制</th>
                <th>检查 / Agent 判断 / 人工审查</th>
                <th>交付与负责人</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in filtered" :key="t.id">
                <td>
                  <button :data-open="t.id" @click="open(t)">
                    <strong>{{ t.title }}</strong></button
                  ><span class="sub"
                    >{{ projectName(t.projectId) }} ·
                    {{ t.head.slice(0, 12) }}</span
                  >
                </td>
                <td>
                  <StatusBadge :status="t.status" /><span class="sub"
                    ><StatusBadge :status="t.control"
                  /></span>
                </td>
                <td>
                  <StatusBadge :status="t.checks" /><span class="sub"
                    >Agent：<StatusBadge
                      :status="t.agentJudgment?.status || 'Unknown'" /></span
                  ><span class="sub">{{
                    t.approvalHead === t.head ? "当前版本已认可" : "待人工审查"
                  }}</span>
                </td>
                <td>
                  {{ t.mrIid ? "MR !" + t.mrIid : "产生修改后创建 MR"
                  }}<span class="sub"
                    >{{ owner(t.ownerId) }} · 第 {{ t.round }} 轮</span
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else-if="layout === 'B'" class="coding-board">
          <section v-for="lane in lanes" :key="lane.title" class="coding-lane">
            <h2>{{ lane.title }}</h2>
            <button
              v-for="t in filtered.filter((t) =>
                lane.states.includes(t.status),
              )"
              :key="t.id"
              class="coding-card"
              @click="open(t)"
            >
              <strong>{{ t.title }}</strong
              ><span class="sub"
                >{{ projectName(t.projectId) }} · {{ owner(t.ownerId) }}</span
              ><StatusBadge :status="t.status" />
            </button>
          </section>
        </div>
        <div v-else class="coding-split">
          <div class="coding-list">
            <button
              v-for="t in filtered"
              :key="t.id"
              class="coding-card"
              :aria-pressed="preview?.id === t.id"
              @click="selected = t.id"
            >
              <strong>{{ t.title }}</strong
              ><span class="sub">{{ projectName(t.projectId) }}</span
              ><StatusBadge :status="t.status" />
            </button>
          </div>
          <article v-if="preview" class="coding-preview">
            <StatusBadge :status="preview.status" />
            <h2>{{ preview.title }}</h2>
            <p class="task-copy">{{ preview.description }}</p>
            <h3>验收条件</h3>
            <p class="task-copy">{{ preview.criteria }}</p>
            <p>{{ owner(preview.ownerId) }} · {{ preview.branch }}</p>
            <button class="btn primary" @click="open(preview)">
              打开任务详情
            </button>
          </article>
        </div>
      </section>
    </template>
    <template v-else-if="view === 'spaces'"
      ><div class="task-heading">
        <div>
          <h1>项目空间</h1>
          <p class="muted">项目代码权限决定任务与配置的可见范围。</p>
        </div>
        <button
          v-if="snapshot.can_manage"
          class="btn primary"
          @click="emit('addProject')"
        >
          接入项目
        </button>
      </div>
      <div class="coding-projects">
        <article v-for="p in projects" :key="p.id" class="panel coding-project">
          <h2>{{ p.name }}</h2>
          <p class="mono">{{ p.path }}</p>
          <p>
            {{ tasks.filter((t) => t.projectId === p.id && !ended(t)).length }}
            项未完成任务 ·
            {{
              p.access.manage
                ? "项目管理员"
                : p.access.write
                  ? "开发者"
                  : "审查者"
            }}
          </p>
          <button class="btn" @click="emit('navigate', 'project/' + p.id)">
            执行配置</button
          ><button
            class="btn"
            @click="
              scope = p.id;
              emit('navigate', 'tasks');
            "
          >
            查看任务
          </button>
        </article>
      </div>
      <p v-if="!projects.length" class="empty">
        当前企业没有可访问的代码项目。
      </p></template
    >
    <template v-else-if="view.startsWith('project/') && config"
      ><div class="task-heading">
        <div>
          <h1>{{ projectName(pid) }} · 执行配置</h1>
          <p class="muted">每轮任务使用开始时的配置快照。</p>
        </div>
        <div class="row">
          <button v-if="config.canManage" class="btn" @click="editConfig">
            编辑执行配置</button
          ><button
            v-if="config.canManage"
            class="btn primary"
            @click="checkConfig"
          >
            检查接入
          </button>
        </div>
      </div>
      <section class="panel coding-project">
        <p class="notice">
          配置 v{{ config.settings.version }} ·
          {{ config.settings.checkedAt ? "接入已检查" : "等待配置或重新检查" }}
          · {{ config.executors.length }} 个在线执行器
        </p>
        <dl class="config-grid">
          <dt>基准分支</dt>
          <dd>{{ config.settings.baseBranch || "尚未配置" }}</dd>
          <dt>模型</dt>
          <dd>{{ config.settings.model || "尚未配置" }}</dd>
          <dt>允许修改范围</dt>
          <dd>
            <pre>{{
              config.settings.allowedPaths.join("\n") || "尚未配置"
            }}</pre>
          </dd>
          <dt>检查命令</dt>
          <dd>
            <pre>{{ config.settings.checks.join("\n") || "尚未配置" }}</pre>
          </dd>
          <dt>执行上限</dt>
          <dd>
            {{ config.settings.repairLimit }} 次修复 /
            {{ config.settings.timeoutMinutes }} 分钟
          </dd>
        </dl>
        <button
          v-if="projects.find((p) => p.id === pid)?.access.write"
          class="btn"
          @click="create(pid)"
        >
          新建修复任务
        </button>
      </section></template
    >
    <template v-else-if="view === 'connections'"
      ><h1>服务连接</h1>
      <p class="muted">凭据由服务端管理；身份状态表示当前登录已接入。</p>
      <div v-if="connections" class="coding-projects">
        <article class="panel coding-project">
          <h2>GitLab CE</h2>
          <p>{{ connections.gitlab.status }}</p>
          <p>{{ connections.gitlab.url }}</p>
        </article>
        <article class="panel coding-project">
          <h2>模型服务</h2>
          <p>{{ connections.model.status }}</p>
          <p>{{ connections.model.models?.join("、") || "未发现模型" }}</p>
        </article>
        <article class="panel coding-project">
          <h2>统一身份</h2>
          <p>{{ connections.identity.status }}</p>
          <p>{{ connections.identity.organization }}</p>
        </article>
      </div></template
    >
  </div>
  <FormDialog
    v-if="dialog"
    :key="dialog.title"
    :title="dialog.title"
    :fields="dialog.fields"
    :submit="dialog.submit"
    :submit-label="dialog.submitLabel"
    wide
    @close="dialog = undefined"
    ><p v-if="dialog.text" class="notice">{{ dialog.text }}</p>
    <template #after-fields="{ busy: submitting }"
      ><fieldset v-if="dialog.reviewers" :disabled="submitting">
        <legend>审查者（至少一位）</legend>
        <label
          v-for="m in reviewerCandidates"
          :key="m.id"
          class="reviewer-option"
          ><input v-model="reviewers" type="checkbox" :value="m.id" />{{
            m.name
          }}</label
        >
      </fieldset></template
    ></FormDialog
  >
</template>
