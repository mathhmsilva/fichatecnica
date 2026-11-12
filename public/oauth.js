// Volta do login Google: entrega o token à janela do app (mesmo endereço) e fecha.
(function () {
  var params = new URLSearchParams(location.hash.slice(1));
  var msg = {
    state: params.get('state'),
    accessToken: params.get('access_token'),
    expiresIn: Number(params.get('expires_in') || '0'),
    error: params.get('error'),
  };
  history.replaceState(null, '', location.pathname); // tira o token da barra de endereço
  try {
    var ch = new BroadcastChannel('ficharedonda-oauth');
    ch.postMessage(msg);
    ch.close();
  } catch (e) {
    /* navegador sem BroadcastChannel */
  }
  document.getElementById('msg').textContent = msg.error ? 'Login cancelado. Pode fechar esta janela.' : 'Conectado. Pode fechar esta janela.';
  setTimeout(function () { window.close(); }, 300);
})();
