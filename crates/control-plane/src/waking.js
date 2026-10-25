(() => {
  const started = Date.now();
  async function checkReadiness() {
    try {
      const response = await fetch(location.href, {
        method: "HEAD",
        headers: { "X-Local-Paas-Wake-Check": "1" },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (response.status === 204 && response.headers.get("X-Local-Paas-Wake-Status") === "ready") {
        location.reload();
        return;
      }
    } catch {
      // Keep waiting through transient network failures.
    }
    if (Date.now() - started >= 60000) {
      document.querySelectorAll("[data-waking-status]").forEach((element) => {
        element.textContent = "This is taking longer than usual. We’ll keep checking automatically.";
      });
    }
    setTimeout(checkReadiness, 5000);
  }
  setTimeout(checkReadiness, 5000);
})();
