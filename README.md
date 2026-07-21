# PerspectiVôo

Visualizador web de fotos aéreas oblíquas (voo CM Oblíquo, Fortaleza) sobre um
mapa OpenStreetMap. Clique em um ponto do mapa e veja a foto capturada mais
próxima, em quatro direções oblíquas ou visão de topo (Nadir).

Site estático, sem build — `index.html` + `app.slim.js` + `app.css`, bibliotecas
via CDN ([OpenLayers](https://openlayers.org/) 9.2.4 e proj4js).

## Como usar

- **Clique no mapa**: carrega a foto mais próxima do ponto clicado.
- **Bússola** (canto superior direito): os quatro setores (N/L/S/O) giram o mapa
  e trocam a direção da foto exibida (Left/Backward/Right/Forward); o botão
  central alterna a visão **Nadir** (topo).
- **Setas de ciclagem** (abaixo da bússola): aparecem quando há 2 ou mais fotos
  próximas na direção atual, permitindo alternar entre as candidatas mais
  próximas do ponto clicado.
- **Link direto**: `?lat=<lat>&lon=<lon>&z=<zoom>&r=<rotação em graus>` abre já
  centralizado no ponto, como se tivesse sido clicado. A própria navegação
  (clique, zoom, rotação) atualiza a URL automaticamente para poder ser
  compartilhada.

## Dados

- Fotos (`.jpg`) vêm do servidor `servidor-interno.exemplo.com`;
  `obq_index.json` (local, neste repo) mapeia cada nome de imagem para sua
  subpasta e, idealmente, para `w`/`h`/`jgw` já extraídos — evitando um
  request extra por foto. Sem esses dados, a foto's `.jgw` é buscado e suas
  dimensões são obtidas sondando o próprio JPG.
- O footprint dos pontos (`OBQ-FOOTPRINT.geojson`, EPSG:4326) também vem desse
  servidor; a posição de cada foto vem do seu `.jgw` (EPSG:31984, SIRGAS 2000
  / UTM 24S), reprojetado para EPSG:3857 no carregamento.
- Para cada direção, as até 4 fotos mais próximas do ponto clicado ficam
  disponíveis para ciclagem (ver acima); apenas a foto exibida é carregada.
- Imagens grandes (~80MP) são baixadas e reduzidas no navegador
  (`createImageBitmap`) para uma versão leve usada em zoom out; a versão
  full-res só é decodificada quando o zoom exige.

## Deploy

Publicado via GitHub Pages (branch `main`, raiz do repo) — sem passo de build,
basta servir os arquivos estaticamente.

## Estrutura

| Arquivo | Descrição |
| --- | --- |
| `index.html` | Marcação da página, bússola e overlay de loading |
| `app.slim.js` | Lógica ativa (carregada pelo `index.html`) |
| `app.css` | Estilos da bússola e do botão Nadir |
| `obq_index.json` | Mapa `nome da imagem → subpasta` no servidor remoto |
| `app.js`, `app.jpg.js`, `pontos31984.geojson` | Protótipos anteriores, não usados em produção |

## Licença

Todos os direitos reservados — veja [LICENSE](LICENSE). Código público para
demonstração; uso, cópia ou redistribuição requerem permissão por escrito.
