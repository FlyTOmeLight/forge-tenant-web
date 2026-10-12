<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { api, message } from "../api";
import type { Run, RunEvent, RunTrace } from "../types";
const props = defineProps<{
  taskPath: string;
  runs: Run[];
  expanded: boolean;
}>();
const selected = ref(""),
  followLatest = ref(true);
const round = computed(
  () => props.runs.find((r) => r.id === selected.value) || props.runs[0],
);
const trace = ref<RunTrace>(),
  events = ref<RunEvent[]>([]);
const error = ref(""),
  busy = ref(false),
  checkedAt = ref(""),
  now = ref(Date.now());
let timer: ReturnType<typeof setTimeout> | undefined;
let request: AbortController | undefined;
let cursor = 0;
watch(
  () => props.runs[0]?.id,
  (id) => {
    if (followLatest.value || !props.runs.some((r) => r.id === selected.value))
      selected.value = id || "";
  },
  { immediate: true },
);
function choose(event: Event) {
  selected.value = (event.target as HTMLSelectElement).value;
  followLatest.value = selected.value === props.runs[0]?.id;
}
const active = computed(() =>
  ["Queued", "Running", "Stopping"].includes(round.value?.status || ""),
);
const names: Record<string, string> = {
  checkout: "准备代码仓库",
  list_files: "列出目录",
  search: "搜索代码",
  read_file: "读取文件",
  edit_file: "修改文件",
  run_checks: "运行检查",
  get_diff: "查看代码差异",
  deliver: "提交交付结果",
};
const eventNames: Record<string, string> = {
  RunQueued: "执行已排队",
  RunStarted: "执行器已领取",
  ModelStarted: "模型开始生成下一步",
  ModelCompleted: "Agent 回复",
  ToolResultRestored: "恢复已保存的工具结果",
  RunRetry: "等待重试",
  RunCompleted: "本轮执行结束",
  RunCanceled: "执行已停止",
  RunFailed: "执行失败",
  RunNeedsReview: "执行暂停，需要人工处理",
  ClarificationRequested: "等待补充信息",
  RunResumed: "执行已恢复",
};
const phase = computed(() => {
  if (!round.value) return "尚未开始执行";
  if (error.value) return "运行记录更新中断";
  const run = trace.value?.run,
    latest = trace.value?.latestEvent;
  if (!run) return active.value ? "等待调度器提交执行" : "该轮没有运行时记录";
  if (run.status === "Queued")
    return latest?.kind === "RunRetry" ? "等待重试" : "等待执行器领取";
  if (run.status !== "Running")
    return (
      (
        {
          Completed: "本轮执行结束",
          Canceled: "执行已停止",
          Failed: "执行失败",
          NeedsReview: "等待人工处理",
          WaitingClarification: "等待补充信息",
        } as Record<string, string>
      )[run.status] || run.status
    );
  if (latest?.kind === "ToolStarted")
    return (
      "正在" +
      (names[latest.payload.name || ""] || "调用工具") +
      (latest.payload.name ? " · " + latest.payload.name : "")
    );
  if (latest?.kind === "ModelStarted") return "模型正在生成下一步";
  if (latest?.kind === "ModelCompleted") return "准备执行工具调用";
  return "正在准备下一步";
});
const elapsed = computed(() => {
  if (!round.value) return "";
  const end = active.value
    ? now.value
    : Date.parse(
        round.value.finished_at ||
          trace.value?.latestEvent?.createdAt ||
          round.value.created_at,
      );
  const seconds = Math.max(
    0,
    Math.floor((end - Date.parse(round.value.created_at)) / 1000),
  );
  if (!Number.isFinite(seconds)) return "";
  return seconds < 60
    ? seconds + " 秒"
    : Math.floor(seconds / 60) + " 分 " + (seconds % 60) + " 秒";
});
const timeline = computed(() =>
  events.value.filter(
    (e) =>
      e.kind !== "ToolCompleted" &&
      !(e.kind === "ModelCompleted" && !e.payload.output),
  ),
);
const results = computed(
  () =>
    new Map(
      events.value
        .filter((e) => e.kind === "ToolCompleted")
        .map((e) => [e.payload.stepID, e]),
    ),
);
function issue(event: RunEvent) {
  if (!event.payload.stepID) return undefined;
  return events.value.find(
    (e) =>
      e.seq > event.seq &&
      e.payload.waitingStep === event.payload.stepID &&
      ["RunNeedsReview", "RunFailed", "ClarificationRequested"].includes(
        e.kind,
      ),
  )?.payload.detail;
}
function resultIssue(event: RunEvent) {
  const text = results.value.get(event.payload.stepID)?.payload.result;
  if (!text) return "";
  try {
    const result = JSON.parse(text);
    return (
      result?.error?.message ||
      (typeof result?.error === "string" ? result.error : "")
    );
  } catch {
    return "";
  }
}
function toolStatus(event: RunEvent) {
  if (results.value.has(event.payload.stepID))
    return resultIssue(event) ? "需要修正" : "已返回";
  if (issue(event)) return "需人工处理";
  if (
    trace.value?.latestEvent?.kind === "ToolStarted" &&
    trace.value.run?.status === "Running" &&
    trace.value.latestEvent.payload.stepID === event.payload.stepID
  )
    return "执行中";
  return active.value ? "等待结果" : "未收到结果";
}
function toolTarget(event: RunEvent) {
  try {
    const args = JSON.parse(event.payload.arguments || "{}");
    return String(args.path || args.query || args.command || "").slice(0, 160);
  } catch {
    return "";
  }
}
const date = (value: string) => new Date(value).toLocaleString("zh-CN");
function pretty(value: string | undefined) {
  if (!value) return "";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
function duration(event: RunEvent) {
  const end = results.value.get(event.payload.stepID);
  return end
    ? Math.max(
        0,
        (Date.parse(end.createdAt) - Date.parse(event.createdAt)) / 1000,
      ).toFixed(1) + " 秒"
    : "";
}
async function refresh() {
  if (!round.value || busy.value) return;
  clearTimeout(timer);
  const id = round.value.id,
    path = props.taskPath;
  const controller = new AbortController();
  request = controller;
  busy.value = true;
  try {
    let more = true;
    while (more) {
      const page = await api<RunTrace>(
        `${path}/runs/${id}/trace?after=${cursor}`,
        { signal: controller.signal },
        false,
      );
      if (
        controller.signal.aborted ||
        round.value?.id !== id ||
        props.taskPath !== path
      )
        return;
      if (page.hasMore && page.nextSeq <= cursor)
        throw new Error("运行事件游标未推进");
      events.value.push(...page.events.filter((e) => e.seq > cursor));
      cursor = page.nextSeq;
      trace.value = page;
      more = page.hasMore;
    }
    error.value = "";
    checkedAt.value = new Date().toLocaleTimeString("zh-CN");
    now.value = Date.now();
  } catch (e) {
    if (!controller.signal.aborted) error.value = message(e);
  } finally {
    if (request === controller) {
      busy.value = false;
      if (
        active.value ||
        ["Queued", "Running", "NeedsReview", "WaitingClarification"].includes(
          trace.value?.run?.status || "",
        ) ||
        error.value
      )
        timer = setTimeout(refresh, error.value ? 5000 : 2000);
    }
  }
}
watch(
  [() => round.value?.id, () => props.taskPath],
  () => {
    request?.abort();
    clearTimeout(timer);
    busy.value = false;
    cursor = 0;
    events.value = [];
    trace.value = undefined;
    error.value = "";
    checkedAt.value = "";
    void refresh();
  },
  { immediate: true },
);
watch(
  () => round.value?.status,
  () => {
    if (!busy.value) void refresh();
  },
);
onUnmounted(() => {
  request?.abort();
  clearTimeout(timer);
});
</script>
<template>
  <section class="run-trace" aria-label="Agent 运行情况" data-run-trace>
    <div
      class="run-progress"
      :class="{ 'run-live': active && !error, 'run-disconnected': error }"
    >
      <div>
        <strong role="status" aria-live="polite" aria-atomic="true"
          >{{ selected === runs[0]?.id ? "最近一轮" : "历史轮次" }} ·
          {{ phase }}</strong
        >
        <p class="muted small-text">
          {{ elapsed ? "本轮耗时 " + elapsed + " · " : ""
          }}{{
            trace?.latestEvent
              ? "最后活动 " + date(trace.latestEvent.createdAt)
              : "尚无执行事件"
          }}<span v-if="checkedAt"> · 更新于 {{ checkedAt }}</span>
        </p>
      </div>
      <button class="btn small" :disabled="busy || !round" @click="refresh">
        {{ busy ? "读取中…" : "刷新记录" }}
      </button>
    </div>
    <p v-if="error" class="notice task-warning">
      {{ error }}。正在重试；下方保留上次读取的记录。
    </p>
    <p v-else-if="trace?.run?.error" class="notice task-warning">
      停止原因：{{ trace.run.error }}
    </p>
    <div
      v-if="expanded"
      id="run-timeline"
      role="tabpanel"
      aria-labelledby="tab-trace"
      class="run-timeline"
    >
      <div class="run-history">
        <h2>运行过程</h2>
        <label v-if="runs.length"
          >执行轮次
          <select :value="selected" @change="choose">
            <option v-for="r in runs" :key="r.id" :value="r.id">
              {{ date(r.created_at) }} · {{ r.requirements.slice(0, 60) }}
            </option>
          </select></label
        >
      </div>
      <p v-if="round" class="task-copy muted">
        本轮要求：{{ round.requirements }}
      </p>
      <p v-if="!runs.length" class="muted">任务尚无执行轮次。</p>
      <p v-else-if="!events.length && !error" class="muted">
        {{
          busy
            ? "正在读取运行事件…"
            : active
              ? "任务已排队，等待执行器开始。"
              : "该轮没有已保存的运行事件。"
        }}
      </p>
      <ol class="run-events">
        <li
          v-for="event in timeline"
          :key="event.seq"
          :data-event-seq="event.seq"
          :data-event-kind="event.kind"
        >
          <div class="run-event-heading">
            <strong>{{
              event.kind === "ToolStarted"
                ? names[event.payload.name || ""] || "调用工具"
                : eventNames[event.kind] || event.kind
            }}</strong
            ><code v-if="event.payload.name">{{ event.payload.name }}</code
            ><span
              v-if="event.kind === 'ToolStarted'"
              class="badge"
              :class="
                resultIssue(event) || issue(event)
                  ? 'warn'
                  : results.has(event.payload.stepID)
                    ? 'good'
                    : ''
              "
              >{{ toolStatus(event) }}</span
            ><small
              >{{ date(event.createdAt)
              }}{{ duration(event) ? " · " + duration(event) : "" }}</small
            >
          </div>
          <p v-if="toolTarget(event)" class="run-target">
            {{ toolTarget(event) }}
          </p>
          <p v-if="event.payload.output" class="task-copy">
            {{ event.payload.output
            }}<small v-if="event.payload.outputTruncated">（内容已截断）</small>
          </p>
          <p
            v-if="event.payload.detail || event.payload.error"
            class="task-copy task-warning"
          >
            {{ event.payload.detail || event.payload.error }}
          </p>
          <p
            v-if="issue(event) || resultIssue(event)"
            class="task-copy task-warning"
          >
            {{ issue(event) || resultIssue(event) }}
          </p>
          <details v-if="event.payload.arguments">
            <summary>调用参数</summary>
            <pre class="task-code">{{ pretty(event.payload.arguments) }}</pre>
            <p v-if="event.payload.argumentsTruncated" class="muted">
              参数预览已截断为 32 KiB。
            </p>
          </details>
          <details v-if="results.has(event.payload.stepID)">
            <summary>返回结果</summary>
            <pre class="task-code">{{
              pretty(results.get(event.payload.stepID)?.payload.result)
            }}</pre>
            <p
              v-if="results.get(event.payload.stepID)?.payload.resultTruncated"
              class="muted"
            >
              结果预览已截断为 32 KiB，完整结果仍保存在运行时。
            </p>
          </details>
        </li>
      </ol>
    </div>
  </section>
</template>
