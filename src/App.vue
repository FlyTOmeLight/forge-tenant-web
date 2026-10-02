<script setup lang="ts">
import ConsoleView from "./views/ConsoleView.vue";
import LoginView from "./views/LoginView.vue";
import InvitationView from "./views/InvitationView.vue";
import TasksView from "./views/TasksView.vue";
const path = window.location.pathname;
</script>
<template>
  <LoginView v-if="path === '/login/oauth/authorize'" />
  <InvitationView v-else-if="path === '/invite'" />
  <TasksView v-else-if="path === '/tasks'" />
  <ConsoleView v-else />
</template>
