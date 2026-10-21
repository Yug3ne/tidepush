// Runs synchronously before the app bundle so a saved light/dark override never flashes.
(() => {
  var t;
  try {
    t = localStorage.getItem("tidepush.theme");
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  } catch {}
})();
