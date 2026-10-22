export const features = {
  coding: { enabled: true },
  agent: { enabled: true },
};

export async function loadRuntimeConfig() {
  const response = await fetch("/runtime-config.json", { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取应用配置，请刷新重试。");
  const config = await response.json();
  if (
    typeof config.coding?.enabled !== "boolean" ||
    typeof config.agent?.enabled !== "boolean"
  )
    throw new Error("应用配置无效，请联系管理员。");
  features.coding.enabled = config.coding.enabled;
  features.agent.enabled = config.agent.enabled;
}
