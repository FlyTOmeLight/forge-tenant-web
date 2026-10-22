import { createApp } from "vue";
import App from "./App.vue";
import "./styles/app.css";
import "./styles/tasks.css";
import "./styles/coding.css";
import { loadRuntimeConfig } from "./runtime-config";
const config =
  document.body.dataset.mode === "prototype"
    ? Promise.resolve()
    : loadRuntimeConfig();
config
  .then(() => createApp(App).mount("#app"))
  .catch((error: Error) => {
    document.querySelector("#app")!.textContent = error.message;
  });
