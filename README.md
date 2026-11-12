# Ficha Redonda

Ficha técnica, CMV e preço da pizzaria. Cada pizza tem a receita no Médio e no Grande, o custo sai dos insumos e dos preparos (massa, molho, pesto), e o app mostra a margem em cada canal (Salão, iFood, 99Food) e o preço que atinge a meta.

Feito sobre a base do Conta Redonda: os dados ficam **cifrados no próprio aparelho** (AES-256-GCM) e, se você entrar com o Google, sincronizam pelo seu Drive. Nenhum servidor guarda os dados.

## O que faz

- **Importar a planilha:** no Google Planilhas, *Arquivo → Fazer download → Microsoft Excel (.xlsx)*, e em Início (ou Ajustes → Planilha) escolha o arquivo. Pizzas, receitas, insumos, preparos, canais, compras e vendas entram de uma vez, com prévia dos números e das pendências antes de gravar. Importar de novo substitui o cadastro, mas mantém as compras e vendas lançadas no app.
- **Pizzas e fichas:** CMV da comida (Antes e Depois do forno) e da embalagem no Médio e no Grande, margem e preço sugerido por canal, troca de item no Grande (ex.: embalagem 35 cm), **modo cozinha** só com as quantidades, editar, duplicar e apagar.
- **Insumos:** preço pago, quantidade comprada, perda na limpeza; custo efetivo = preço ÷ quantidade ÷ (1 − perda). **Lançar compra** mostra antes quanto o CMV de cada pizza muda e atualiza o preço.
- **Preparos:** receita, rendimento e perda; o custo por quilo entra nas pizzas como um ingrediente.
- **Canais e preços:** comparativo de margem e de preço sugerido nos canais, comissão, taxa de pagamento, desconto, custos por pedido, embalagem só no delivery, impostos e CMV máximo.
  - Preço sugerido = (CMV + custos por pedido) ÷ (1 − % variáveis − margem-alvo).
- **Meio a meio:** CMV = média da comida dos dois sabores + embalagem (só no delivery); preço pelo maior ou pela média.
- **Vendas e cardápio:** quantidade vendida por mês, pizza, tamanho e canal, e a engenharia de cardápio (Estrela, Burro de carga, Quebra-cabeça, Cão).
- **Histórico de preços:** cada compra, a variação contra a anterior e o que mais subiu.
- **Pendências:** pizza sem receita, sem quantidade no Grande, preço igual no Médio e no Grande, ingrediente sem preço ou sem cadastro, margem abaixo da meta, preço de insumo antigo.
- **Cofre, PIN, códigos de recuperação, cópia de segurança (`.ficharedonda`), Drive e funcionamento sem internet:** iguais ao Conta Redonda.

## Sincronizar com o Google Drive

O cofre cifrado fica numa pasta "Ficha Redonda" no Drive, com o escopo `drive.file` (o app só enxerga o que ele mesmo criou).

O app já vem com o ID do cliente OAuth do Conta Redonda. Para usar o mesmo cliente, no Google Cloud (**Credenciais → o cliente OAuth do Conta Redonda**) adicione:

- em *Origens JavaScript autorizadas*: o endereço do Ficha Redonda (ex.: `https://ficharedonda.SEU-USUARIO.workers.dev`);
- em *URIs de redirecionamento autorizados*: o mesmo endereço + `/oauth.html` e + `/api/google/callback`.

Para um cliente separado, siga os mesmos passos do Conta Redonda e coloque o ID em `VITE_GOOGLE_CLIENT_ID` (build) e `GOOGLE_CLIENT_ID` (variável do Worker).

Opcional: o segredo `GOOGLE_CLIENT_SECRET` no Worker faz o login durar mais que 1 hora (renovação pelo servidor).

## Rodar no computador

Precisa do Node 22.

```bash
npm ci
npm run dev          # abre em http://localhost:5173
npm test             # testes de unidade
npm run build        # gera a pasta dist/
npx playwright test  # ponta a ponta (depois do build)
```

## Publicar no Cloudflare

O `wrangler.jsonc` publica um Worker que serve o app (`dist/`) e atende só `/api/google/*` (login).

1. Workers & Pages → Create → Import a repository → este repositório.
2. Build command: `npm run build`. Deploy command: `npx wrangler deploy`. Variável `NODE_VERSION=22`.
3. Em Settings → Variables and Secrets: `GOOGLE_CLIENT_ID` (texto) e, se quiser, `GOOGLE_CLIENT_SECRET` (segredo).

## Organização do código

| Pasta | O quê |
| --- | --- |
| `src/domain/ficha.ts` | tipos e todos os cálculos: custo, preparo, CMV, margem, sugerido, meio a meio, engenharia, pendências |
| `src/import` | leitura do .xlsx e da planilha de fichas técnicas |
| `src/crypto` | cofre: senha, códigos de recuperação, PIN do aparelho, cifragem |
| `src/store` | eventos encadeados por hash, estado, banco local cifrado (IndexedDB) |
| `src/sync` | Google Drive |
| `src/app` | `Session`: tudo que as telas podem fazer |
| `src/ui` | telas em React |
| `worker` | login do Google no Cloudflare |
