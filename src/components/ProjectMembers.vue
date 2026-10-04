<script setup lang="ts">
import { computed, ref, shallowRef, watch, onUnmounted } from "vue";
import { api, mutate, message } from "../api";
import type { Field, Grant, Project, Snapshot, TeamGrant } from "../types";
import FormDialog from "./FormDialog.vue";
const props = defineProps<{ snapshot: Snapshot; project: Project }>();
const emit = defineEmits<{ changed: [] }>();
const grants = computed(() =>
  props.snapshot.grants.filter((g) => g.project_id === props.project.id),
);
const names: Record<string, string> = {
  none: "无权限",
  reviewer: "审查者",
  developer: "开发者",
  admin: "项目管理员",
};
const error = ref("");
const teamGrants = ref<TeamGrant[]>([]);
let generation = 0;
watch(
  () => [props.snapshot, props.project],
  async () => {
    const ticket = ++generation;
    if (!props.project.permissions.manageMembers) {
      teamGrants.value = [];
      return;
    }
    try {
      const result = await api<{ items: TeamGrant[] }>(
        `/api/v1/tenants/${props.snapshot.tenant.id}/projects/${props.project.id}/team-grants`,
      );
      if (ticket === generation) teamGrants.value = result.items;
    } catch (e) {
      if (ticket === generation) error.value = message(e);
    }
  },
  { immediate: true },
);
onUnmounted(() => generation++);
const dialog = shallowRef<{
  title: string;
  fields: Field[];
  submit: (v: Record<string, string>) => Promise<void>;
}>();
async function edit(g?: Grant) {
  try {
    const path = `/api/v1/tenants/${props.snapshot.tenant.id}/projects/${props.project.id}`,
      version = props.snapshot.tenant.version;
    const candidates = (
      await api<{ items: { id: string; name: string; email: string }[] }>(
        path + "/grant-candidates",
      )
    ).items;
    dialog.value = {
      title: g ? "修改直接分配角色" : "添加项目成员",
      fields: [
        {
          name: "member",
          label: "租户成员",
          value: g?.membership_id || "",
          options: [
            { value: "", label: "选择已接受邀请的成员" },
            ...candidates.map((m) => ({
              value: m.id,
              label: m.name + " · " + m.email,
            })),
          ],
        },
        {
          name: "role",
          label: "项目角色",
          value:
            g?.direct_role === "none"
              ? "reviewer"
              : g?.direct_role || "reviewer",
          options: ["reviewer", "developer", "admin"].map((value) => ({
            value,
            label: names[value]!,
          })),
        },
      ],
      submit: async (v) => {
        await mutate(
          path + "/grants/" + v.member,
          "PUT",
          { role: v.role },
          version,
        );
        dialog.value = undefined;
        emit("changed");
      },
    };
  } catch (e) {
    error.value = message(e);
  }
}
function revoke(g: Grant) {
  const path = `/api/v1/tenants/${props.snapshot.tenant.id}/projects/${props.project.id}/grants/${g.membership_id}`,
    version = props.snapshot.tenant.version;
  dialog.value = {
    title: "撤销 " + g.name + " 的直接授权",
    fields: [],
    submit: async () => {
      await mutate(path, "DELETE", {}, version);
      dialog.value = undefined;
      emit("changed");
    },
  };
}
function editTeam(t?: TeamGrant, remove = false) {
  const path = `/api/v1/tenants/${props.snapshot.tenant.id}/projects/${props.project.id}/team-grants`,
    version = props.snapshot.tenant.version;
  dialog.value = {
    title: remove ? "撤销 " + t!.name + " 的团队授权" : "分配团队项目角色",
    fields: remove
      ? []
      : [
          {
            name: "team",
            label: "团队",
            value: t?.id || "",
            options: [
              { value: "", label: "选择团队" },
              ...teamGrants.value.map((t) => ({
                value: t.id,
                label: t.name + " · " + t.member_count + " 位成员",
              })),
            ],
          },
          {
            name: "role",
            label: "项目角色",
            value: t?.role === "none" ? "reviewer" : t?.role || "reviewer",
            options: ["reviewer", "developer", "admin"].map((value) => ({
              value,
              label: names[value]!,
            })),
          },
        ],
    submit: async (v) => {
      await mutate(
        path + "/" + (remove ? t!.id : v.team),
        remove ? "DELETE" : "PUT",
        { role: v.role },
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
      <h2>项目成员与权限</h2>
      <button
        v-if="project.permissions.manageMembers"
        class="btn primary"
        @click="edit()"
      >
        添加项目成员
      </button>
    </div>
    <p v-if="error" class="notice danger" role="alert">{{ error }}</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>成员</th>
            <th>目标角色 / 来源</th>
            <th>当前有效角色</th>
            <th>GitLab 同步</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in grants" :key="g.membership_id">
            <td>{{ g.name }}</td>
            <td>
              {{ names[g.desired_role]
              }}<span
                v-for="source in g.sources"
                :key="source.kind + source.id"
                class="sub"
                >{{ source.kind === "team" ? "团队 · " : ""
                }}{{ source.name }}：{{ names[source.role] }}</span
              >
            </td>
            <td>{{ names[g.effective_role] }}</td>
            <td>
              {{ g.desired_level === g.observed_level ? "已核验" : "待同步"
              }}<span class="sub">{{
                g.checked_at
                  ? new Date(g.checked_at).toLocaleString("zh-CN")
                  : "尚未核验"
              }}</span>
            </td>
            <td>
              <div
                v-if="project.permissions.manageMembers"
                class="cell-actions"
              >
                <button class="btn small" @click="edit(g)">
                  {{
                    g.direct_role === "none" ? "添加直接授权" : "修改直接角色"
                  }}</button
                ><button
                  v-if="g.direct_role !== 'none'"
                  class="btn link danger"
                  @click="revoke(g)"
                >
                  撤销直接授权
                </button>
              </div>
              <span v-else>—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!grants.length" class="empty">尚无项目成员。</p>
    <div class="footnote">
      新增权限等待 GitLab
      确认后生效。降级和撤销立即限制平台能力。租户管理员不自动获得代码权限。
    </div>
  </section>
  <section
    v-if="project.permissions.manageMembers"
    class="panel permission-project"
  >
    <div class="panel-head">
      <h2>团队项目角色</h2>
      <button class="btn" :disabled="!teamGrants.length" @click="editTeam()">
        分配团队角色
      </button>
    </div>
    <p class="permission-body muted">
      团队成员共同获得项目角色。移除团队授权不会影响直接授权或其他团队授权。
    </p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>团队</th>
            <th>成员数</th>
            <th>角色</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in teamGrants" :key="t.id">
            <td>{{ t.name }}</td>
            <td>{{ t.member_count }}</td>
            <td>{{ names[t.role] }}</td>
            <td>
              <div class="cell-actions">
                <button class="btn small" @click="editTeam(t)">分配角色</button
                ><button
                  v-if="t.role !== 'none'"
                  class="btn small danger"
                  @click="editTeam(t, true)"
                >
                  撤销团队授权
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!teamGrants.length" class="empty">请先由租户管理员创建团队。</p>
  </section>
  <FormDialog
    v-if="dialog"
    :key="dialog.title"
    :title="dialog.title"
    :fields="dialog.fields"
    :submit="dialog.submit"
    @close="dialog = undefined"
    ><p class="notice">
      个人有效能力可在“我的权限”查看。修改一条授权后，其他授权来源继续有效。
    </p></FormDialog
  >
</template>
