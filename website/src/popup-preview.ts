import "./popup-preview.css";

const control = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const status = document.querySelector<HTMLElement>(".status")!;
const heading = document.querySelector("h1")!;

control.addEventListener("change", () => {
  status.dataset.tone = control.checked ? "ready" : "neutral";
  heading.textContent = control.checked ? "已就绪" : "已关闭";
});
