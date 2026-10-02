<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, APIError, message } from "../api";
const token =
  location.hash.slice(1) || sessionStorage.getItem("forge-invitation");
if (location.hash) {
  sessionStorage.setItem("forge-invitation", token!);
  history.replaceState(null, "", "/invite");
}
const description = ref("正在检查邀请…"),
  error = ref(""),
  password = ref(""),
  fresh = ref(false),
  ready = ref(false),
  busy = ref(false),
  accepted = ref(false),
  needLogin = ref(false);
onMounted(async () => {
  document.title = "Forge · 接受企业邀请";
  try {
    if (!token) throw Error("请通过管理员发给你的邀请链接进入。");
    const info = await api<{
      name: string;
      email: string;
      tenant: string;
      new_identity: boolean;
    }>(
      "/api/v1/invitations/inspect",
      { method: "POST", body: JSON.stringify({ token }) },
      false,
    );
    description.value = `${info.name}（${info.email}），你受邀加入 ${info.tenant}。`;
    fresh.value = info.new_identity;
    if (!fresh.value) await api("/api/v1/me", {}, false);
    ready.value = true;
  } catch (e) {
    if (e instanceof APIError && e.status === 401) needLogin.value = true;
    else error.value = message(e);
  }
});
async function accept() {
  busy.value = true;
  error.value = "";
  try {
    const result = await api<{ username: string }>(
      "/api/v1/invitations/accept",
      {
        method: "POST",
        body: JSON.stringify({ token, password: password.value }),
      },
      false,
    );
    password.value = "";
    sessionStorage.removeItem("forge-invitation");
    accepted.value = true;
    description.value = `已加入企业。你的登录账号是 ${result.username}，GitLab 身份正在同步。`;
  } catch (e) {
    error.value = message(e);
    if (e instanceof APIError && e.status === 401) needLogin.value = true;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <main class="auth-shell">
    <div class="brand"><span class="mark" aria-hidden="true">F</span>Forge</div>
    <section class="auth-card">
      <h1>加入企业工作空间</h1>
      <p id="description" class="subtitle">{{ description }}</p>
      <form v-if="!accepted" id="invite-form" @submit.prevent="accept">
        <label v-if="fresh" id="password-field" class="field"
          >设置登录密码<input
            id="password"
            v-model="password"
            name="password"
            type="password"
            minlength="12"
            maxlength="128"
            required
            autocomplete="new-password"
          /><small>至少 12 个字符。密码不会同步到 GitLab。</small></label
        >
        <div id="invite-error" class="status-block" role="alert">
          {{ error }}
        </div>
        <button id="accept" class="btn primary full" :disabled="!ready || busy">
          {{ busy ? "正在接受…" : "接受邀请" }}
        </button>
      </form>
      <a
        v-if="needLogin || accepted"
        id="login"
        class="btn full space-top"
        :href="accepted ? '/auth/login' : '/auth/login?return=/invite'"
        >{{ accepted ? "登录企业控制台" : "使用受邀账号登录" }}</a
      >
    </section>
  </main>
</template>
