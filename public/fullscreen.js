/* Fullscreen is optional: the ordinary page and home-screen launch work without it. */
(() => {
  const button = document.getElementById('fullscreenToggle');
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  const enabled = document.fullscreenEnabled ?? document.webkitFullscreenEnabled;
  if (!button || !request || !exit || enabled === false) return;

  const current = () => document.fullscreenElement || document.webkitFullscreenElement;
  const update = () => {
    const active = !!current();
    button.textContent = active ? 'Exit fullscreen' : 'Fullscreen';
    button.setAttribute('aria-pressed', String(active));
    button.title = active ? 'Exit fullscreen' : 'Show CZone fullscreen';
  };
  button.hidden = false;
  update();
  document.addEventListener('fullscreenchange', update);
  document.addEventListener('webkitfullscreenchange', update);
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      // Invoke directly in the tap handler; browsers require user activation.
      if (current()) await exit.call(document);
      else await request.call(root);
    } catch (error) {
      console.warn('[CZone UI] Fullscreen unavailable', error);
      alert('Fullscreen is unavailable in this browser or embedded view. Try opening CZone directly in a browser, or adding it to your home screen.');
    } finally {
      button.disabled = false;
      update();
    }
  });
})();
