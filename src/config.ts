/**
 * ID do cliente OAuth do Google (é público: aparece no navegador de qualquer forma).
 * Criado no Google Cloud do dono, com o endereço do app como origem autorizada.
 * Também pode vir da variável VITE_GOOGLE_CLIENT_ID no build.
 */
export const GOOGLE_CLIENT_ID: string =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || '902687953951-9oqtf22u0o3li55msmcd3hgcpblrj9im.apps.googleusercontent.com';
