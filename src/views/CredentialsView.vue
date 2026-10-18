<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { api, message } from "../api";
import type { Credential } from "../types";
import FormDialog from "../components/FormDialog.vue";

const props = defineProps<{ refreshVersion: number }>();
const items = ref<Credential[]>([]);
const loading = ref(true),
  loadError = ref(""),
  busy = ref(false),
  creating = ref(false),
  revoking = ref<Credential>(),
  name = ref(""),
  days = ref(90),
  token = ref(""),
  copyNotice = ref("");
let active = true,
  generation = 0;
const endpoint = "/api/v1/credentials";
const date = (value: string) => new Date(value).toLocaleString("zh-CN");
const status = (item: Credential) =>
  item.revoked_at
    ? "已撤销"
    : Date.parse(item.expires_at) <= Date.now()
      ? "已过期"
      : "有效";

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const result = await api<{ items: Credential[] }>(endpoint);
    if (active) items.value = result.items;
  } catch (e) {
    if (active) loadError.value = message(e);
  } finally {
    if (active) loading.value = false;
  }
}
function openCreate() {
  name.value = "";
  days.value = 90;
  creating.value = true;
}
async function create() {
  if (busy.value) return;
  const trimmed = name.value.trim();
  if (!trimmed || [...trimmed].length > 80)
    throw new Error("名称须为 1–80 个字符");
  if (!Number.isInteger(days.value) || days.value < 1 || days.value > 365)
    throw new Error("有效期须为 1–365 天的整数");
  busy.value = true;
  const ticket = generation;
  try {
    const issued = await api<Credential & { token: string }>(endpoint, {
      method: "POST",
      body: JSON.stringify({
        name: trimmed,
        expires_at: new Date(Date.now() + days.value * 86400000).toISOString(),
      }),
    });
    if (!active || ticket !== generation) return;
    creating.value = false;
    token.value = issued.token;
    copyNotice.value = "";
    await load();
  } finally {
    busy.value = false;
  }
}
async function revoke() {
  if (busy.value || !revoking.value) return;
  busy.value = true;
  try {
    await api(endpoint + "/" + encodeURIComponent(revoking.value.id), {
      method: "DELETE",
    });
    if (!active) return;
    revoking.value = undefined;
    await load();
  } finally {
    busy.value = false;
  }
}
function clearToken() {
  token.value = "";
  copyNotice.value = "";
}
function leave() {
  generation++;
  clearToken();
  creating.value = false;
  revoking.value = undefined;
}
async function copyToken() {
  try {
    await navigator.clipboard.writeText(token.value);
    if (token.value) copyNotice.value = "已复制，请保存在安全的位置。";
  } catch {
    if (token.value) copyNotice.value = "复制失败，请手动选择并复制密钥。";
  }
}
watch(
  () => props.refreshVersion,
  () => {
    if (!loading.value && !busy.value) void load();
  },
);
onMounted(() => {
  window.addEventListener("pagehide", leave);
  void load();
});
onUnmounted(() => {
  active = false;
  leave();
  window.removeEventListener("pagehide", leave);
});
</script>

<template>
  <div class="heading">
    <div>
      <h1>API 密钥</h1>
      <p class="subtitle">管理当前账号的 API 访问凭据，无需加入企业。</p>
    </div>
    <button class="btn primary" :disabled="busy || loading" @click="openCreate">
      创建 API 密钥
    </button>
  </div>
  <p class="notice">
    密钥使用当前账号的实时权限。企业或项目权限变化会立即影响密钥可访问的资源。
  </p>
  <section class="panel" :aria-busy="loading" aria-label="API 密钥列表">
    <div v-if="loading" class="empty" role="status">正在加载 API 密钥…</div>
    <div v-else-if="loadError" class="empty">
      <p class="form-error" role="alert">{{ loadError }}</p>
      <button class="btn" @click="load">重新加载</button>
    </div>
    <div v-else-if="!items.length" class="empty">
      <h2>尚无 API 密钥</h2>
      <p>创建后可用于脚本或 API 客户端访问。</p>
    </div>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>名称</th>
            <th>状态</th>
            <th>创建时间</th>
            <th>到期时间</th>
            <th>撤销时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id">
            <td>{{ item.name }}</td>
            <td>{{ status(item) }}</td>
            <td>{{ date(item.created_at) }}</td>
            <td>{{ date(item.expires_at) }}</td>
            <td>{{ item.revoked_at ? date(item.revoked_at) : "—" }}</td>
            <td>
              <button
                v-if="!item.revoked_at"
                class="btn small"
                :disabled="busy"
                @click="revoking = item"
              >
                撤销
              </button>
              <span v-else class="muted">已撤销</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <FormDialog
    v-if="creating"
    title="创建 API 密钥"
    submit-label="创建密钥"
    :submit="create"
    @close="creating = false"
  >
    <div class="field">
      <label for="credential-name">名称</label>
      <input
        id="credential-name"
        v-model="name"
        name="name"
        required
        maxlength="80"
        autocomplete="off"
        :disabled="busy"
      />
    </div>
    <div class="field">
      <label for="credential-days">有效期（天）</label>
      <input
        id="credential-days"
        v-model.number="days"
        name="days"
        type="number"
        min="1"
        max="365"
        step="1"
        required
        :disabled="busy"
      />
      <small>默认 90 天，最长 365 天。</small>
    </div>
  </FormDialog>
  <FormDialog v-if="token" title="API 密钥已创建" @close="clearToken">
    <p class="notice">
      完整密钥仅显示这一次。关闭或离开页面后无法再次查看，请立即复制并妥善保存。
    </p>
    <div class="field">
      <label for="credential-token">完整密钥</label>
      <input
        id="credential-token"
        :value="token"
        readonly
        autocomplete="off"
        spellcheck="false"
        @focus="($event.target as HTMLInputElement).select()"
      />
    </div>
    <button class="btn" type="button" @click="copyToken">复制密钥</button>
    <p role="status">{{ copyNotice }}</p>
  </FormDialog>
  <FormDialog
    v-if="revoking"
    title="撤销 API 密钥？"
    submit-label="确认撤销"
    :submit="revoke"
    @close="revoking = undefined"
  >
    <p>
      确认撤销“{{ revoking.name }}”？使用这把密钥的调用将立即失效，无法恢复。
    </p>
  </FormDialog>
</template>
