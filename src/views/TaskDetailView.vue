<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { api, message } from "../api";
import { demo } from "../prototype";
import type { Member, TaskDetail, Field } from "../types";
import FormDialog from "../components/FormDialog.vue";
import StatusBadge from "../components/StatusBadge.vue";
const props = defineProps<{
  tenantId: string;
  projectId: string;
  taskId: string;
  refreshVersion: number;
  members: Member[];
}>();
const emit = defineEmits<{ navigate: [path: string] }>();
const detail = ref<TaskDetail>();
const tab = ref("overview"),
  status = ref("正在读取项目授权…"),
  toast = ref(""),
  loading = ref(false);
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
  `/api/v1/tenants/${props.tenantId}/projects/${props.projectId}/tasks`;
const labels: Record<string, string> = {
  Intervene: "人工介入",
  Resume: "恢复 Agent",
  Transfer: "转交任务",
  Cancel: "取消任务",
  Continue: "继续任务",
  Approve: "认可当前代码版本",
  Feedback: "提交整合后的修改要求",
  NextFeedback: "开始下一条正式要求",
  Answer: "提交澄清",
};
const tabs = [
  ["overview", "任务概览"],
  ["changes", "代码差异"],
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
    if (!props.projectId) {
      status.value =
        "当前企业没有可访问的代码项目。企业角色不会自动授予代码权限。";
      return;
    }
    detail.value = await api<TaskDetail>(path() + "/" + props.taskId);
    status.value = "数据已更新 · " + new Date().toLocaleTimeString("zh-CN");
  } catch (e) {
    status.value = message(e);
  } finally {
    loading.value = false;
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
  if (["Resume", "Feedback", "Answer"].includes(kind))
    fields.push({
      name: "text",
      label: "本轮已整合的修改要求",
      type: "textarea",
    });
  if (kind === "Transfer")
    fields.push({
      name: "ownerId",
      label: "新负责人",
      options: props.members
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
watch(
  () => props.taskId,
  () => {
    tab.value = "overview";
    detail.value = undefined;
    void refresh();
  },
  { immediate: true },
);
watch(
  () => props.refreshVersion,
  () => {
    if (!dialog.value) void refresh();
  },
);
onMounted(() => {
  poll = setInterval(() => {
    if (!document.hidden && !dialog.value) void refresh();
  }, 5000);
});
onUnmounted(() => {
  clearInterval(poll);
  clearTimeout(timer);
});
async function simulate(type: string) {
  try {
    await demo?.simulate(props.taskId, type);
    await refresh();
  } catch (e) {
    notify(message(e));
  }
}
const simulations = [
  ["start", "开始执行"],
  ["edit", "生成修改"],
  ["verify-pass", "检查通过"],
  ["verify-fail", "检查失败"],
  ["ask", "请求澄清"],
  ["comment-sync", "同步评论"],
  ["stop-confirm", "确认停止"],
  ["stop-timeout", "停止超时"],
  ["human-push", "人工提交"],
  ["merge", "合入 MR"],
  ["mr-close", "关闭 MR"],
  ["mr-reopen", "重开 MR"],
  ["remind", "催办"],
  ["conflict", "意见冲突"],
  ["resolve-conflict", "整合意见"],
  ["fail", "执行失败"],
  ["late-delivery", "迟到交付"],
];
function download() {
  const patch = detail.value?.runs.find((r) => r.output?.patch)?.output?.patch;
  if (!patch) return;
  const url = URL.createObjectURL(new Blob([patch], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = props.taskId + ".patch";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
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
  <div class="coding-detail">
    <p v-if="!task" role="status">{{ status }}</p>
    <div v-if="demo" class="prototype-events">
      <strong>模拟外部事件</strong
      ><button
        v-for="[type, label] in simulations"
        :key="type"
        class="btn small"
        @click="simulate(type!)"
      >
        {{ label }}
      </button>
    </div>
    <template v-if="task"
      ><button
        class="btn link task-back"
        data-action="back"
        @click="emit('navigate', 'tasks')"
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
            :disabled="loading"
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
          Agent 仅执行本轮正式要求。评论同步不会触发新一轮，也不会替代人工审查。
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
              <h2>复现步骤</h2>
              <p class="task-copy">{{ task.reproduce || "未单独填写" }}</p>
              <h2>约束</h2>
              <p class="task-copy">{{ task.constraints || "无" }}</p>
              <h2>参考资料</h2>
              <p class="task-copy">{{ task.reference || "无" }}</p>
              <button
                v-if="demo && task.status === 'Waiting'"
                class="btn"
                @click="action('Answer')"
              >
                回答澄清问题
              </button>
              <p v-if="task.question">{{ task.question }}</p>
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
                :disabled="loading"
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
              <h2>Agent 判断</h2>
              <p>
                <StatusBadge
                  :status="task.agentJudgment?.status || 'Unknown'"
                />
                ·
                {{ task.agentJudgment?.summary || "等待本轮判断" }}
              </p>
              <p class="muted">
                模型建议与自动检查分别记录，最终认可由审查者作出。
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
                :disabled="loading"
                @click="action('Approve')"
              >
                认可当前代码版本
              </button>
              <details
                v-for="(run, index) in detail!.runs"
                :key="run.id"
                class="task-run"
                :open="index === 0"
              >
                <summary>
                  <StatusBadge :status="run.status" />
                  {{ date(run.created_at) }}
                </summary>
                <p class="task-copy">{{ run.requirements }}</p>
                <details v-if="run.config_snapshot">
                  <summary>
                    本轮配置快照 · v{{ run.config_snapshot.version }}
                  </summary>
                  <pre class="task-code">{{
                    JSON.stringify(run.config_snapshot, null, 2)
                  }}</pre>
                </details>
                <p v-if="run.output?.judgment">
                  Agent 判断：{{ run.output.judgment.status }} ·
                  {{ run.output.judgment.summary }}
                </p>
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
            <template v-else-if="tab === 'changes'"
              ><h2>最近一轮代码差异</h2>
              <template
                v-for="run in detail!.runs
                  .filter((r) => r.output?.patch)
                  .slice(0, 1)"
                :key="run.id"
                ><p
                  v-if="run.output?.checksCommit !== task.head"
                  class="notice"
                >
                  历史执行差异，当前代码版本可能已变化。
                </p>
                <button class="btn" @click="download">下载补丁</button>
                <pre class="task-code">{{ run.output?.patch }}</pre>
              </template>
              <p
                v-if="!detail!.runs.some((r) => r.output?.patch)"
                class="muted"
              >
                暂无已保存的差异。
              </p></template
            >
            <template v-else
              ><article
                v-for="event in detail!.events"
                :key="event.id"
                class="task-event"
              >
                <strong>{{ eventNames[event.type] || event.type }}</strong
                ><small
                  >{{ date(event.created_at) }} · {{ event.actor_id }}</small
                >
                <pre>{{ JSON.stringify(event.detail, null, 2) }}</pre>
              </article>
              <p v-if="!detail!.events.length" class="muted">
                尚无执行记录。
              </p></template
            >
          </div>
        </section>
        <aside class="panel task-side">
          <h2>交付与责任</h2>
          <dl>
            <dt>MR</dt>
            <dd>{{ task.mrIid ? "!" + task.mrIid : "产生修改后创建" }}</dd>
            <dt>目标分支</dt>
            <dd class="task-commit">{{ task.targetBranch }}</dd>
            <dt>负责人</dt>
            <dd>
              {{
                members.find((m) => m.user_id === task?.ownerId)?.name ||
                task.ownerId
              }}
            </dd>
            <dt>审查者</dt>
            <dd>
              {{
                task.reviewerIds
                  .map(
                    (id) => members.find((m) => m.user_id === id)?.name || id,
                  )
                  .join("、")
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
          <button class="btn" @click="emit('navigate', 'project/' + projectId)">
            项目执行配置
          </button>
          <div class="task-links">
            <button class="btn" data-action="sync" @click="sync">
              同步 GitLab 状态</button
            ><a
              class="btn"
              :href="detail!.gitlabUrl"
              target="_blank"
              rel="noopener"
              >{{ task.mrIid ? "打开 GitLab MR" : "打开工作分支" }}</a
            >
          </div>
          <p class="muted small-text">
            人工审查通过不结束任务；任务以 MR 合入为完成条件。
          </p>
        </aside>
      </div>
    </template>
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
