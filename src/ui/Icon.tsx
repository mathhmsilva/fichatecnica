/** Ícones de traço, desenhados para o app (24×24, traço 1.8). */
const PATHS = {
  pizzas: 'M12 3a9 9 0 0 1 9 9H12zM12 3a9 9 0 1 0 9 9M8.5 9.5h.01M7.5 14h.01M11 16.5h.01',
  insumos: 'M5 9h14l-1.2 10.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8zM8 9V7a4 4 0 0 1 8 0v2',
  preparos: 'M4 11h16v2a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7zM9 7c0-1.5 1-2 1-3.5M14 7c0-1.5 1-2 1-3.5',
  canais: 'M4 19V9l8-5 8 5v10M9 19v-5h6v5M4 19h16',
  meio: 'M12 3v18M12 3a9 9 0 0 0 0 18M12 3a9 9 0 0 1 0 18',
  vendas: 'M4 19h16M7 15l3.5-4 3 2.5L18 8m0 0h-3.5M18 8v3.5',
  precos: 'M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4v4.5H8M12 7.5V12l3 2',
  pendencias: 'M12 4 2.8 19.5h18.4zM12 10v4.5m0 2.5h.01',
  inicio: 'M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z',
  revisar: 'M4.5 12.5 9.5 17.5 19.5 6.5',
  entrada: 'M4 13.5 6.5 5h11l2.5 8.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 13.5h4.5l1.5 2.5h4l1.5-2.5H20',
  importar: 'M12 15V4m0 0-4.5 4.5M12 4l4.5 4.5M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14',
  dre: 'M5 20V11m5 9V5m5 15v-7m5 7V8',
  caixa: 'M4 7.5h16v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM4 7.5 6 4h12l2 3.5M9.5 12h5',
  contas: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm0-12v4.5l3 2M9 2.5h6',
  lancamentos: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  fechar: 'M6 11V8a6 6 0 1 1 12 0v3M5 11h14v9H5zm4.5 4.5 2 2 3.5-3.5',
  ajustes: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4.9a7.5 7.5 0 0 0-2.6-1.5L14 2.4h-4l-.4 2.5A7.5 7.5 0 0 0 7 6.4l-2.4-.9-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-.9a7.5 7.5 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 2.6-1.5l2.4.9 2-3.4z',
  historico: 'M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4v4.5H8M12 7.5V12l3 2',
  mais: 'M5 12h.01M12 12h.01M19 12h.01',
  travar: 'M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13zM12 15v2',
  seta: 'M7 17 17 7m0 0H9m8 0v8',
  mais_um: 'M12 5v14M5 12h14',
  nuvem: 'M7 18.5h10.5a4 4 0 0 0 .7-7.94A6 6 0 0 0 6.6 9.3 4.6 4.6 0 0 0 7 18.5z',
  alerta: 'M12 4 2.8 19.5h18.4zM12 10v4.5m0 2.5h.01',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, className }: { name: IconName; size?: number; className?: string }) {
  const dots = name === 'mais' || name === 'lancamentos';
  return (
    <svg className={`icon${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={dots && name === 'mais' ? 3.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
