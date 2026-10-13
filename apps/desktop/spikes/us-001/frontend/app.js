const button = document.querySelector('#run');
const status = document.querySelector('#status');
const report = document.querySelector('#report');
let running = false;

async function run() {
  if (running) return;
  running = true;
  button.disabled = true;
  status.textContent = 'Verificando cofre, chave e restauração…';
  try {
    const result = await window.__TAURI__.core.invoke('run_synthetic_demo');
    status.textContent = result.passed
      ? 'Demonstração concluída.'
      : 'Demonstração falhou.';
    report.textContent = JSON.stringify(result, null, 2);
  } catch {
    status.textContent =
      'A demonstração falhou. Consulte o resultado dos testes nativos.';
  } finally {
    button.disabled = false;
    running = false;
  }
}

button.addEventListener('click', run);
window.runSmoke = async () => {
  if (running) return;
  await run();
  await window.__TAURI__.core.invoke('finish_smoke');
};
