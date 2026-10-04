<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue";
import { api, message } from "../api";
import type { PermissionReport } from "../types";
const props = defineProps<{
  tenantId: string;
  memberId?: string;
  refreshVersion?: number;
}>();
const report = ref<PermissionReport>(),
  error = ref(""),
  busy = ref(false);
const names: Record<string, string> = {
  none: "无代码权限",
  reviewer: "审查者",
  developer: "开发者",
  admin: "项目管理员",
};
const projectActions = [
  ["readCode", "读取代码与任务"],
  ["createTask", "创建修复任务"],
  ["manageMembers", "管理项目成员与团队授权"],
  ["configureExecution", "配置项目执行"],
] as const;
let generation = 0;
watch(
  () => [props.tenantId, props.memberId, props.refreshVersion],
  async () => {
    const ticket = ++generation;
    report.value = undefined;
    error.value = "";
    busy.value = true;
    try {
      const result = await api<PermissionReport>(
        `/api/v1/tenants/${props.tenantId}/${props.memberId ? "members/" + props.memberId + "/permissions" : "permissions/me"}`,
      );
      if (ticket === generation) report.value = result;
    } catch (e) {
      if (ticket === generation) error.value = message(e);
    } finally {
      if (ticket === generation) busy.value = false;
    }
  },
  { immediate: true },
);
onUnmounted(() => generation++);
</script>
<template>
  <div :aria-busy="busy" class="permission-details">
    <p v-if="busy" role="status">正在读取有效权限…</p>
    <p v-if="error" class="notice danger" role="alert">{{ error }}</p>
    <template v-if="report">
      <section class="panel permission-summary">
        <h2>{{ report.member.name }} · 权限概览</h2>
        <p>
          租户角色：<strong>{{
            report.member.role === "admin" ? "租户管理员" : "普通成员"
          }}</strong>
        </p>
        <p>
          所属团队：{{
            report.teams.map((t) => t.name).join("、") || "尚未加入团队"
          }}
        </p>
        <p v-if="report.member.operator">
          平台角色：平台管理员。租户和项目权限按下方授权生效。
        </p>
        <p>
          租户操作：{{
            report.tenantPermissions.manageMembers
              ? "管理成员与团队、接入项目、分配项目角色"
              : report.tenantPermissions.viewSettings
                ? "查看租户设置；当前状态禁止管理操作"
                : "查看自己的角色和权限"
          }}
        </p>
        <p v-if="report.tenantPermissions.viewAudit">
          可查看租户审计与权限同步。
        </p>
      </section>
      <p class="notice">
        同一项目取各授权来源中的最高角色。新增权限等待 GitLab
        确认；移除一个来源后，其他来源仍保留。任务控制还需负责人或项目管理资格，提交审查认可需被指定为该任务审查者。
      </p>
      <article
        v-for="p in report.projects"
        :key="p.id"
        class="panel permission-project"
      >
        <div class="panel-head">
          <h2>{{ p.name }}</h2>
          <span class="badge">当前有效：{{ names[p.effectiveRole] }}</span>
        </div>
        <div class="permission-body">
          <p>目标角色：{{ names[p.desiredRole] }} · {{ p.reason }}</p>
          <ul class="permission-actions">
            <li v-for="[key, label] in projectActions" :key="key">
              <strong
                :class="p.permissions[key] ? 'permission-allowed' : 'muted'"
                >{{ p.permissions[key] ? "允许" : "未授予" }}</strong
              >
              {{ label }}
            </li>
          </ul>
          <details open>
            <summary>授权来源（{{ p.sources.length }}）</summary>
            <ul v-if="p.sources.length">
              <li v-for="s in p.sources" :key="s.kind + s.id">
                {{ s.kind === "team" ? "团队 · " : "" }}{{ s.name }} →
                {{ names[s.role] }}
              </li>
            </ul>
            <p v-else class="muted">没有项目代码角色授权。</p>
            <p v-if="report.member.role === 'admin'">
              租户管理员身份提供项目成员管理能力，不包含代码读取与执行权限。
            </p>
          </details>
        </div>
      </article>
      <p v-if="!report.projects.length" class="empty">
        尚无项目授权。租户管理员可以直接分配角色，或将成员加入已获授权的团队。
      </p>
    </template>
  </div>
</template>
