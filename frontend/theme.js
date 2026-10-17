(() => {
  const root = document.documentElement;
  const button = document.getElementById("theme-toggle");
  const icon = button.querySelector(".theme-icon");
  const label = button.querySelector(".theme-label");
  const saved = localStorage.getItem("pyarch-theme");
  const initial = saved || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");

  const apply = (theme) => {
    root.dataset.theme = theme;
    const light = theme === "light";
    icon.textContent = light ? "☀" : "☾";
    label.textContent = light ? "Light" : "Dark";
    button.setAttribute("aria-label", `Switch to ${light ? "dark" : "light"} mode`);
    localStorage.setItem("pyarch-theme", theme);
  };

  apply(initial);
  button.addEventListener("click", () => apply(root.dataset.theme === "light" ? "dark" : "light"));
})();
