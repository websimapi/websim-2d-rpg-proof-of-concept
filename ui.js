/* ...existing code... */
export const UI = (function(){
  let stateRef = null;
  const msgEl = document.getElementById('msg');

  function init(state) {
    stateRef = state;
    // show initial HP
    document.getElementById('hp-val').textContent = state.player.hp;
  }

  function showMessage(text) {
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.style.opacity = '1';
    setTimeout(()=> {
      if (msgEl.textContent === text) msgEl.style.opacity = '0.7';
    }, 2000);
  }

  return { init, showMessage };
})();
/* ...existing code... */

