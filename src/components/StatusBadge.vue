<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ status: string }>();
const names: Record<string, string> = {
  pending: "等待同步",
  running: "同步中",
  retrying: "自动重试中",
  failed: "同步失败",
  conflict: "权限或资源冲突",
  succeeded: "已同步",
  superseded: "已被新版本替代",
  active: "已启用",
  suspended: "已停用",
  invited: "待接受",
  removed: "已移除",
  Review: "待审查",
  Queued: "排队中",
  Running: "正在执行",
  Failed: "执行失败",
  Canceling: "正在取消",
  Canceled: "已取消",
  Undelivered: "未交付",
  Completed: "已完成",
  Human: "人工处理",
  Agent: "Agent 处理",
  Stopping: "正在停止",
  Passed: "检查通过",
  NotRun: "尚未验证",
  Stopped: "已停止",
};
const tone = computed(() =>
  ["active", "succeeded", "Passed", "Completed"].includes(props.status)
    ? "good"
    : ["failed", "conflict", "Failed"].includes(props.status)
      ? "bad"
      : ["pending", "running", "retrying", "invited", "Stopping"].includes(
            props.status,
          )
        ? "warn"
        : "",
);
</script>
<template>
  <span class="badge" :class="tone">{{ names[status] || status }}</span>
</template>
