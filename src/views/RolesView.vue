<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, message } from "../api";
import type { RoleDefinition } from "../types";
const roles = ref<RoleDefinition[]>([]),
  error = ref("");
const scopeNames: Record<string, string> = {
  platform: "平台范围",
  tenant: "租户范围",
  project: "项目范围",
};
onMounted(async () => {
  try {
    roles.value = (
      await api<{ items: RoleDefinition[] }>("/api/v1/roles")
    ).items;
  } catch (e) {
    error.value = message(e);
  }
});
</script>
<template>
  <section>
    <p class="notice">
      角色是一组操作权限。租户角色在“成员与团队”分配；项目角色在“项目 →
      成员与权限”分配给个人或团队。这里展示系统内置角色。
    </p>
    <p v-if="error" class="notice danger" role="alert">{{ error }}</p>
    <div
      v-for="scope in ['platform', 'tenant', 'project']"
      :key="scope"
      class="role-section"
    >
      <h2>{{ scopeNames[scope] }}</h2>
      <div class="role-grid">
        <article
          v-for="r in roles.filter((r) => r.scope === scope)"
          :key="r.id"
          class="panel role-card"
        >
          <h3>{{ r.name }}</h3>
          <ul>
            <li v-for="p in r.permissions" :key="p">{{ p }}</li>
          </ul>
          <p v-for="c in r.conditions" :key="c" class="muted">{{ c }}</p>
        </article>
      </div>
    </div>
  </section>
</template>
