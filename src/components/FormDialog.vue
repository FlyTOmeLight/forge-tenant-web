<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, reactive, ref } from "vue";
import type { Field } from "../types";
import { APIError, message } from "../api";
const props = defineProps<{
  title: string;
  fields?: Field[];
  submitLabel?: string;
  wide?: boolean;
  submit?: (values: Record<string, string>) => Promise<void>;
}>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
const busy = ref(false),
  error = ref("");
const values = reactive<Record<string, string>>(
  Object.fromEntries(
    (props.fields || []).map((f) => [
      f.name,
      f.value ?? f.options?.[0]?.value ?? "",
    ]),
  ),
);
let previous: HTMLElement | null;
onMounted(async () => {
  previous = document.activeElement as HTMLElement;
  dialog.value?.showModal();
  await nextTick();
  dialog.value?.querySelector<HTMLElement>("input,textarea,select")?.focus();
});
onUnmounted(() => {
  if (previous?.isConnected) previous.focus();
  else document.getElementById("main")?.focus({ preventScroll: true });
});
async function submit() {
  if (!props.submit || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await props.submit(values);
  } catch (e) {
    error.value =
      e instanceof APIError && e.status === 412
        ? "企业数据已更新，请关闭弹窗、刷新数据后重新操作。"
        : message(e);
  } finally {
    busy.value = false;
  }
}
function close() {
  if (!busy.value) emit("close");
}
</script>
<template>
  <dialog
    ref="dialog"
    id="dialog"
    :class="{ wide }"
    aria-labelledby="dialog-title"
    @cancel.prevent="close"
  >
    <div class="modal-head">
      <h2 id="dialog-title">{{ title }}</h2>
      <button
        class="close"
        type="button"
        aria-label="关闭弹窗"
        :disabled="busy"
        @click="close"
      >
        ×
      </button>
    </div>
    <form id="modal-form" @submit.prevent="submit">
      <div class="modal-body">
        <div id="form-error" class="form-error" role="alert">{{ error }}</div>
        <slot />
        <label v-for="field in fields" :key="field.name" class="field"
          >{{ field.label }}
          <select
            v-if="field.options"
            v-model="values[field.name]"
            :name="field.name"
            :required="field.required !== false"
            :disabled="busy"
          >
            <option
              v-for="option in field.options"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
          <textarea
            v-else-if="field.type === 'textarea'"
            v-model="values[field.name]"
            :name="field.name"
            :required="field.required !== false"
            :disabled="busy"
          />
          <input
            v-else
            v-model="values[field.name]"
            :name="field.name"
            :type="field.type || 'text'"
            :required="field.required !== false"
            :disabled="busy"
            maxlength="120"
          />
          <small v-if="field.help">{{ field.help }}</small>
        </label>
      </div>
      <div class="modal-foot">
        <button class="btn" type="button" :disabled="busy" @click="close">
          {{ props.submit ? "取消" : "关闭" }}</button
        ><button
          v-if="props.submit"
          class="btn primary"
          type="submit"
          :disabled="busy"
        >
          {{ busy ? "正在保存…" : submitLabel || "保存" }}
        </button>
      </div>
    </form>
  </dialog>
</template>
