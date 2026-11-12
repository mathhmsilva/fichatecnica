/**
 * Marca do Ficha Redonda: um disco (a pizza, a moeda, o gráfico de pizza) com uma fatia
 * saindo. A fatia é o custo que você confere; o resto já está redondo.
 */
export function LogoMark({ size = 40, animated = false, title }: { size?: number; animated?: boolean; title?: string }) {
  return (
    <svg className={`logo-mark${animated ? ' animated' : ''}`} width={size} height={size} viewBox="0 0 100 100" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      {/* Disco com uma fatia de 60° faltando (de -90° a -30°). */}
      <path className="logo-disc" d="M50 50 L84.64 30 A40 40 0 1 1 50 10 Z" />
      {/* A fatia, deslocada para fora. */}
      <path className="logo-slice" d="M50 50 L50 10 A40 40 0 0 1 84.64 30 Z" />
      <circle className="logo-dot" cx="38" cy="62" r="5" />
      <circle className="logo-dot" cx="58" cy="70" r="3.6" />
      <circle className="logo-dot" cx="30" cy="44" r="3.2" />
    </svg>
  );
}

export function Wordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`wordmark wordmark-${size}`}>
      <LogoMark size={size === 'lg' ? 56 : size === 'md' ? 32 : 26} />
      <span className="wordmark-text">ficha<b>redonda</b></span>
    </span>
  );
}

/** Tela de abertura: a fatia se encaixa no disco enquanto o cofre abre. */
export function Splash({ message = 'Abrindo o cofre…' }: { message?: string }) {
  return (
    <div className="splash" role="status" aria-live="polite">
      <div className="splash-inner">
        <LogoMark size={96} animated />
        <div className="splash-name">ficha<b>redonda</b></div>
        <p className="splash-tag">Ficha técnica, CMV e preço: tudo redondo.</p>
      </div>
      <p className="splash-msg"><span className="splash-bar" aria-hidden="true" />{message}</p>
    </div>
  );
}
