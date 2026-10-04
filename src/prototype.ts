import { createPrototype } from "./prototype/data.js";
export const demo =
  location.pathname === "/prototype.html" ||
  location.pathname === "/prototype" ||
  document.body.dataset.mode === "prototype"
    ? createPrototype()
    : undefined;
