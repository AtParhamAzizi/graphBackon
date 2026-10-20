(() => {
  const root = document.documentElement;
  const button = document.getElementById("theme-toggle");
  let saved = null;
  try { saved = localStorage.getItem("pyarch-theme"); } catch {}
  const preference = window.matchMedia("(prefers-color-scheme: light)");
  const validTheme = saved === "light" || saved === "dark" ? saved : null;
  const apply = (theme, remember = false) => {
    root.dataset.theme = theme;
    const light = theme === "light";
    button.querySelector("use").setAttribute("href", light ? "#icon-moon" : "#icon-sun");
    button.querySelector(".theme-label").textContent = light ? "Light" : "Dark";
    button.setAttribute("aria-label", `Switch to ${light ? "dark" : "light"} mode`);
    button.title = `Switch to ${light ? "dark" : "light"} mode`;
    if (remember) {
      saved = theme;
      try { localStorage.setItem("pyarch-theme", theme); } catch {}
    }
  };
  apply(validTheme || (preference.matches ? "light" : "dark"));
  button.addEventListener("click", () => apply(root.dataset.theme === "light" ? "dark" : "light", true));
  preference.addEventListener("change", () => {
    if (saved !== "light" && saved !== "dark") apply(preference.matches ? "light" : "dark");
  });
})();
