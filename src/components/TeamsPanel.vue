<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import { mutate } from "../api";
import type { Field, Snapshot, Team, Member } from "../types";
import FormDialog from "./FormDialog.vue";
const props = defineProps<{ snapshot: Snapshot }>();
const emit = defineEmits<{ changed: []; create: [] }>();
const selected = ref("");
const team = computed(() =>
  props.snapshot.teams.find((t) => t.id === selected.value),
);
const members = computed(() =>
  props.snapshot.members.filter((m) =>
    m.teams.some((t) => t.id === selected.value),
  ),
);
const dialog = shallowRef<{
  title: string;
  fields: Field[];
  submit: (v: Record<string, string>) => Promise<void>;
}>();
function edit(t: Team, m?: Member) {
  const tid = props.snapshot.tenant.id,
    version = props.snapshot.tenant.version;
  dialog.value = {
    title: m ? "将 " + m.name + " 移出 " + t.name : "添加成员到 " + t.name,
    fields: m
      ? []
      : [
          {
            name: "member",
            label: "租户成员",
            options: [
              { value: "", label: "选择已激活成员" },
              ...props.snapshot.members
                .filter(
                  (m) =>
                    m.status === "active" &&
                    !m.teams.some((x) => x.id === t.id),
                )
                .map((m) => ({ value: m.id, label: m.name + " · " + m.email })),
            ],
          },
        ],
    submit: async (v) => {
      await mutate(
        `/api/v1/tenants/${tid}/teams/${t.id}/members/${m?.id || v.member}`,
        m ? "DELETE" : "PUT",
        {},
        version,
      );
      dialog.value = undefined;
      emit("changed");
    },
  };
}
</script>
<template>
  <section class="panel">
    <div class="panel-head">
      <h2>团队目录</h2>
      <button
        v-if="snapshot.permissions.manageMembers"
        class="btn"
        @click="emit('create')"
      >
        创建团队
      </button>
    </div>
    <p class="permission-body muted">
      一个成员可以加入多个团队。团队的项目角色在“项目 → 成员与权限”中分配。
    </p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>团队</th>
            <th>成员数</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in snapshot.teams" :key="t.id">
            <td>{{ t.name }}</td>
            <td>{{ t.member_count }}</td>
            <td>
              <button class="btn small" @click="selected = t.id">
                查看成员
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!snapshot.teams.length" class="empty">
      创建团队后，可统一分配项目角色。
    </p>
  </section>
  <section v-if="team" class="panel permission-project">
    <div class="panel-head">
      <h2>{{ team.name }} · 团队成员</h2>
      <button
        v-if="snapshot.permissions.manageMembers"
        class="btn"
        @click="edit(team)"
      >
        添加团队成员
      </button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>成员</th>
            <th>邮箱</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in members" :key="m.id">
            <td>{{ m.name }}</td>
            <td>{{ m.email }}</td>
            <td>
              <button
                v-if="snapshot.permissions.manageMembers"
                class="btn small danger"
                @click="edit(team, m)"
              >
                移出团队
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!members.length" class="empty">团队暂无成员。</p>
  </section>
  <FormDialog
    v-if="dialog"
    :title="dialog.title"
    :fields="dialog.fields"
    :submit="dialog.submit"
    @close="dialog = undefined"
    ><p class="notice">
      成员会获得团队已有的项目角色。移出团队后仅撤销该团队带来的权限，其他团队和直接授权保留。
    </p></FormDialog
  >
</template>
