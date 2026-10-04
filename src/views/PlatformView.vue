<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import { api, mutate, message } from "../api";
import type { Connections, Field, Tenant, User } from "../types";
import FormDialog from "../components/FormDialog.vue";
import StatusBadge from "../components/StatusBadge.vue";
const props = defineProps<{
  view: string;
  workspaces: Tenant[];
  refreshVersion: number;
}>();
const emit = defineEmits<{ enter: [id: string]; changed: [] }>();
const tenants = ref<Tenant[]>([]),
  connections = ref<Connections>(),
  query = ref(""),
  error = ref(""),
  busy = ref(false);
const filtered = computed(() =>
  tenants.value.filter((t) =>
    (t.name + " " + t.slug).toLowerCase().includes(query.value.toLowerCase()),
  ),
);
const dialog = shallowRef<{
  title: string;
  text: string;
  fields: Field[];
  submitLabel: string;
  submit: (v: Record<string, string>) => Promise<void>;
}>();
let generation = 0;
async function refresh() {
  const ticket = ++generation;
  busy.value = true;
  error.value = "";
  try {
    if (props.view === "platform/tenants") {
      const result = await api<{ items: Tenant[] }>("/api/v1/platform/tenants");
      if (ticket === generation) tenants.value = result.items;
    } else {
      const result = await api<Connections>("/api/v1/platform/connections");
      if (ticket === generation) connections.value = result;
    }
  } catch (e) {
    if (ticket === generation) error.value = message(e);
  } finally {
    if (ticket === generation) busy.value = false;
  }
}
watch(
  () => [props.view, props.refreshVersion],
  () => {
    if (!dialog.value) void refresh();
  },
  { immediate: true },
);
async function create() {
  try {
    const users = (await api<{ items: User[] }>("/api/v1/platform/users"))
      .items;
    dialog.value = {
      title: "创建租户",
      text: "指定首位租户管理员。平台管理身份不会自动加入该租户，也不会获得项目代码权限。",
      fields: [
        { name: "name", label: "租户名称" },
        {
          name: "slug",
          label: "租户标识",
          help: "2–40 位小写字母、数字或连字符。",
        },
        {
          name: "admin_user_id",
          label: "首位租户管理员",
          value: "",
          options: [
            { value: "", label: "请选择已激活账号" },
            ...users.map((u) => ({
              value: u.id,
              label: u.name + " · " + u.email,
            })),
          ],
        },
      ],
      submitLabel: "创建租户",
      submit: async (v) => {
        await mutate("/api/v1/platform/tenants", "POST", v);
        dialog.value = undefined;
        await refresh();
        emit("changed");
      },
    };
  } catch (e) {
    error.value = message(e);
  }
}
function setState(t: Tenant) {
  const active = t.status === "active";
  dialog.value = {
    title: (active ? "停用 " : "启用 ") + t.name,
    text: active
      ? "停用租户并同步撤销项目授权。保留账号、成员关系和业务记录。"
      : "重新核验项目授权。Agent 任务需要负责人显式恢复。",
    fields: [],
    submitLabel: active ? "确认停用" : "确认启用",
    submit: async () => {
      await mutate(
        "/api/v1/platform/tenants/" + t.id,
        "PATCH",
        { status: active ? "suspended" : "active" },
        t.version,
      );
      dialog.value = undefined;
      await refresh();
      emit("changed");
    },
  };
}
</script>
<template>
  <div :aria-busy="busy">
    <p v-if="error" class="notice danger" role="alert">{{ error }}</p>
    <template v-if="view === 'platform/tenants'"
      ><div class="heading">
        <div>
          <h1>租户管理</h1>
          <p class="subtitle">管理租户生命周期。租户工作区按成员身份开放。</p>
        </div>
        <button class="btn primary" @click="create">创建租户</button>
      </div>
      <section class="panel">
        <div class="toolbar">
          <input
            v-model="query"
            class="search"
            aria-label="搜索租户"
            placeholder="搜索租户名称或标识"
          />
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>租户</th>
                <th>成员 / 项目</th>
                <th>状态</th>
                <th>同步状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in filtered" :key="t.id">
                <td>
                  {{ t.name }}<span class="sub">{{ t.slug }}</span>
                </td>
                <td>
                  {{ t.member_count }} 位成员 · {{ t.project_count }} 个项目
                </td>
                <td><StatusBadge :status="t.status" /></td>
                <td><StatusBadge :status="t.sync_status" /></td>
                <td>
                  <div class="cell-actions">
                    <button
                      v-if="workspaces.some((w) => w.id === t.id)"
                      class="btn link"
                      @click="emit('enter', t.id)"
                    >
                      进入工作区</button
                    ><span v-else class="muted">未加入该租户</span
                    ><button class="btn small" @click="setState(t)">
                      {{ t.status === "active" ? "停用" : "启用" }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="!filtered.length" class="empty">暂无匹配的租户。</p>
      </section></template
    >
    <template v-else
      ><h1>全局服务连接</h1>
      <p class="subtitle">平台级 GitLab 与模型服务状态。凭据保存在服务端。</p>
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
    @close="dialog = undefined"
    ><p class="notice">{{ dialog.text }}</p></FormDialog
  >
</template>
