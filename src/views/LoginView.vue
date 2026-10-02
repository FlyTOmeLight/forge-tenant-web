<script setup lang="ts">
import { onMounted, ref } from "vue";
import { message } from "../api";
const username = ref(""),
  password = ref(""),
  status = ref(""),
  ready = ref(false),
  busy = ref(false);
let application: { name: string; organization: string };
const source = new URLSearchParams(location.search),
  query = new URLSearchParams({ type: "code" });
for (const [from, to] of [
  ["client_id", "clientId"],
  ["response_type", "responseType"],
  ["redirect_uri", "redirectUri"],
  ["scope", "scope"],
  ["state", "state"],
  ["nonce", "nonce"],
  ["code_challenge", "code_challenge"],
  ["code_challenge_method", "code_challenge_method"],
])
  if (source.has(from!)) query.set(to!, source.get(from!)!);
onMounted(async () => {
  document.title = "Forge · 企业账号登录";
  try {
    if (
      !source.get("client_id") ||
      !source.get("redirect_uri") ||
      !source.get("state")
    )
      throw Error("请从研发平台发起登录。");
    const response = await fetch(`/api/get-app-login?${query}`),
      result = await response.json();
    if (!response.ok || result.status !== "ok" || !result.data?.name)
      throw Error("登录请求无效，请返回应用重新发起。");
    application = result.data;
    ready.value = true;
  } catch (e) {
    status.value = message(e);
  }
});
async function login() {
  if (!ready.value || busy.value) return;
  busy.value = true;
  status.value = "正在登录…";
  try {
    const response = await fetch(`/api/login?${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "code",
        application: application.name,
        organization: application.organization,
        username: username.value,
        password: password.value,
        signinMethod: "Password",
      }),
    });
    const result = await response.json();
    if (!response.ok || result.status !== "ok")
      throw Error(result.msg || "登录失败，请检查账号与密码。");
    if (
      typeof result.data !== "string" ||
      !result.data ||
      result.data2 ||
      result.data3
    )
      throw Error("此账号需要额外验证，请联系管理员。");
    const target = new URL(source.get("redirect_uri")!);
    if (
      target.origin !== location.origin ||
      target.pathname !== "/auth/callback"
    )
      throw Error("登录回调地址无效。");
    target.searchParams.set("code", result.data);
    target.searchParams.set("state", source.get("state")!);
    password.value = "";
    location.assign(target.href);
  } catch (e) {
    status.value = message(e);
    busy.value = false;
  }
}
</script>
<template>
  <main class="auth-shell">
    <div class="brand"><span class="mark" aria-hidden="true">F</span>Forge</div>
    <section class="auth-card">
      <h1>使用企业账号登录</h1>
      <p class="subtitle">统一身份，访问企业工作空间。</p>
      <form id="login-form" @submit.prevent="login">
        <label class="field"
          >企业账号<input
            id="username"
            v-model="username"
            name="username"
            required
            autocomplete="username" /></label
        ><label class="field"
          >密码<input
            id="password"
            v-model="password"
            name="password"
            type="password"
            required
            autocomplete="current-password"
        /></label>
        <div id="status" class="status-block" role="status" aria-live="polite">
          {{ status }}
        </div>
        <button class="btn primary full" id="submit" :disabled="!ready || busy">
          登录并继续
        </button>
      </form>
    </section>
  </main>
</template>
