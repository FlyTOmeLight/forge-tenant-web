<script setup lang="ts">
import { computed, ref } from "vue";
import { html, parse } from "diff2html";
import { ColorSchemeType } from "diff2html/lib/types";
import "diff2html/bundles/css/diff2html.min.css";

const props = defineProps<{ patch: string }>();
const layout = ref<"line-by-line" | "side-by-side">("line-by-line");
const files = computed(() => parse(props.patch));
const totals = computed(() =>
  files.value.reduce(
    (sum, file) => ({
      added: sum.added + file.addedLines,
      deleted: sum.deleted + file.deletedLines,
    }),
    { added: 0, deleted: 0 },
  ),
);
const rendered = computed(() =>
  files.value.map((file) => ({
    file,
    name: file.isDeleted ? file.oldName : file.newName,
    status: file.isNew
      ? "新增文件"
      : file.isDeleted
        ? "删除文件"
        : file.isRename
          ? "重命名"
          : "已修改",
    // diff2html escapes source text before generating its markup.
    markup: html([file], {
      drawFileList: false,
      outputFormat: layout.value,
      matching: "lines",
      diffStyle: "word",
      colorScheme: ColorSchemeType.LIGHT,
    }),
  })),
);
</script>

<template>
  <section class="code-diff" aria-label="代码差异阅读器">
    <div class="diff-toolbar">
      <div class="diff-totals">
        <strong>{{ files.length }} 个文件</strong>
        <span class="diff-added">+{{ totals.added }} 新增</span>
        <span class="diff-deleted">−{{ totals.deleted }} 删除</span>
      </div>
      <div class="diff-actions">
        <div class="diff-layout" role="group" aria-label="差异布局">
          <button
            type="button"
            :aria-pressed="layout === 'line-by-line'"
            @click="layout = 'line-by-line'"
          >
            合并视图
          </button>
          <button
            type="button"
            :aria-pressed="layout === 'side-by-side'"
            @click="layout = 'side-by-side'"
          >
            左右对比
          </button>
        </div>
        <slot name="actions" />
      </div>
    </div>
    <details
      v-for="(item, index) in rendered"
      :key="index + item.name"
      class="diff-file"
      open
    >
      <summary>
        <svg
          class="diff-file-icon"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path d="M9 1.5H3.5v13h9V5L9 1.5Z M9 1.5V5h3.5" />
        </svg>
        <span class="diff-path"
          >{{ item.file.isRename ? item.file.oldName + " → " : ""
          }}{{ item.name }}</span
        >
        <span class="diff-file-status">{{ item.status }}</span>
        <span class="diff-file-count"
          ><span
            class="diff-added"
            :aria-label="`新增 ${item.file.addedLines} 行`"
            >+{{ item.file.addedLines }}</span
          ><span
            class="diff-deleted"
            :aria-label="`删除 ${item.file.deletedLines} 行`"
            >−{{ item.file.deletedLines }}</span
          ></span
        >
      </summary>
      <div v-if="item.file.isBinary" class="diff-message">
        二进制文件已变化，无法逐行展示。
      </div>
      <div v-else-if="!item.file.blocks.length" class="diff-message">
        仅文件名或文件属性变化，没有文本行改动。
      </div>
      <template v-else>
        <div
          v-if="layout === 'side-by-side'"
          class="diff-columns"
          aria-hidden="true"
        >
          <span>修改前</span><span>修改后</span>
        </div>
        <div
          class="diff-content"
          tabindex="0"
          role="region"
          :aria-label="`${item.name} 代码差异`"
          v-html="item.markup"
        />
      </template>
    </details>
    <template v-if="!files.length">
      <p class="muted">此补丁无法按文件展示，以下为原始内容。</p>
      <pre class="task-code">{{ patch }}</pre>
    </template>
  </section>
</template>

<style scoped>
.code-diff {
  --diff-border: #d1d9e0;
  --diff-muted: #59636e;
  --diff-add: #116329;
  --diff-delete: #a40e26;
  min-width: 0;
  color: #1f2328;
}
.diff-toolbar,
.diff-actions,
.diff-totals,
.diff-file-count {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.diff-toolbar {
  justify-content: space-between;
  margin: 16px 0;
  gap: 12px;
  font-size: 13px;
}
.diff-added {
  color: var(--diff-add);
}
.diff-deleted {
  color: var(--diff-delete);
}
.diff-layout {
  display: flex;
  border: 1px solid var(--diff-border);
  border-radius: 6px;
  overflow: hidden;
}
.diff-layout button {
  min-height: 36px;
  padding: 6px 12px;
  border: 0;
  background: white;
  color: var(--diff-muted);
  font-size: 13px;
  cursor: pointer;
}
.diff-layout button + button {
  border-left: 1px solid var(--diff-border);
}
.diff-layout button[aria-pressed="true"] {
  background: #e9eef3;
  color: #1f2328;
  font-weight: 650;
  box-shadow: inset 0 -2px #59636e;
}
.diff-layout button:hover {
  background: #f0f3f6;
}
.diff-layout button:focus-visible {
  outline-offset: -3px;
}
.diff-file {
  border: 1px solid var(--diff-border);
  border-radius: 6px;
  overflow: hidden;
  margin: 0 0 16px;
}
.diff-file > summary {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: #f6f8fa;
  font-size: 12px;
  cursor: pointer;
  list-style: none;
}
.diff-file > summary::-webkit-details-marker {
  display: none;
}
.diff-file > summary::before {
  content: "›";
  font-size: 18px;
  width: 10px;
  line-height: 1;
}
.diff-file[open] > summary::before {
  transform: rotate(90deg);
}
.diff-file[open] > summary {
  border-bottom: 1px solid var(--diff-border);
}
.diff-file-icon {
  flex-shrink: 0;
  color: var(--diff-muted);
}
.diff-path {
  font:
    600 13px/1.5 ui-monospace,
    SFMono-Regular,
    Consolas,
    "Liberation Mono",
    monospace;
  overflow-wrap: anywhere;
}
.diff-file-status {
  color: var(--diff-muted);
  white-space: nowrap;
}
.diff-file-count {
  margin-left: auto;
  flex-wrap: nowrap;
  font:
    600 12px ui-monospace,
    monospace;
}
.diff-content {
  overflow: auto;
}
.diff-content:focus-visible,
.diff-file > summary:focus-visible {
  outline: 2px solid #8070dd;
  outline-offset: -2px;
}
.diff-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  background: #f6f8fa;
  color: var(--diff-muted);
  font-size: 12px;
  border-bottom: 1px solid var(--diff-border);
}
.diff-columns span {
  padding: 6px 16px;
}
.diff-columns span + span {
  border-left: 1px solid var(--diff-border);
}
.diff-message {
  padding: 20px;
  font-size: 13px;
  color: var(--diff-muted);
}
.code-diff :deep(.d2h-file-header) {
  display: none;
}
.code-diff :deep(.d2h-file-wrapper) {
  border: 0;
  border-radius: 0;
  margin: 0;
}
.code-diff :deep(.d2h-wrapper) {
  text-align: left;
}
.code-diff :deep(.d2h-diff-table) {
  font:
    13px/22px ui-monospace,
    SFMono-Regular,
    Consolas,
    "Liberation Mono",
    monospace;
  border-collapse: collapse;
  margin: 0;
}
.code-diff :deep(.d2h-diff-table td) {
  padding: 0;
  border-top: 0;
  border-bottom: 0;
}
.code-diff :deep(.d2h-code-line-ctn) {
  white-space: pre;
  tab-size: 4;
}
.code-diff :deep(.d2h-code-linenumber),
.code-diff :deep(.d2h-code-side-linenumber) {
  color: #59636e;
  background: #f6f8fa;
  border-color: #d1d9e0;
  user-select: none;
}
.code-diff :deep(.d2h-ins) {
  background: #e6ffec;
  border-color: #b7e8c5;
}
.code-diff :deep(.d2h-del) {
  background: #ffebe9;
  border-color: #ffc1ba;
}
.code-diff :deep(.d2h-code-linenumber.d2h-ins),
.code-diff :deep(.d2h-code-side-linenumber.d2h-ins) {
  background: #ccffd8;
}
.code-diff :deep(.d2h-code-linenumber.d2h-del),
.code-diff :deep(.d2h-code-side-linenumber.d2h-del) {
  background: #ffd7d5;
}
.code-diff :deep(ins) {
  background: #abf2bc;
  text-decoration: none;
}
.code-diff :deep(del) {
  background: #ffc0ba;
  text-decoration: none;
}
.code-diff :deep(.d2h-info) {
  background: #eef6ff;
  color: #59636e;
  border-color: #d1d9e0;
}
@media (max-width: 760px) {
  .diff-file-status,
  .diff-file-icon {
    display: none;
  }
  .diff-file > summary {
    padding: 10px;
    gap: 8px;
  }
  .diff-toolbar {
    align-items: flex-start;
  }
  .diff-layout button {
    min-height: 44px;
  }
}
</style>
